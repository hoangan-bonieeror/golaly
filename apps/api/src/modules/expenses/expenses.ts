import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import {
  balances,
  currencyDigits,
  expenseSchema,
  settleUp,
  settlementSchema,
  splitEqually,
  type ExpenseCategory,
  type ExpenseInput,
  type ExpensesView,
  type ExpenseView,
  type SettlementInput,
  type SettlementView,
  type UserSummary,
} from "@triply/shared";
import { ViewerId, requireUser } from "../../common/auth";
import { fromDate, toDate } from "../../common/dates";
import { AppError, Errors, ZodPipe } from "../../common/http";
import { lockTrip } from "../../common/locks";
import { toUserSummary, userSummarySelect } from "../../common/presenters";
import { PrismaService, type Tx } from "../../prisma/prisma.service";
import { TripEventsService } from "../activity/trip-events";
import { RealtimeService } from "../realtime/realtime";
import type { AccessTrip } from "../trips/trip-access.service";
import { TripAccessService } from "../trips/trip-access.service";
import { TripsModule } from "../trips/trips.controller";

const Uuid = new ParseUUIDPipe();
/** Expenses per trip (a soft guard). */
const MAX_EXPENSES = 2000;

const expenseInclude = {
  paidBy: { select: userSummarySelect },
  createdBy: { select: userSummarySelect },
  item: { select: { id: true, title: true } },
  shares: { include: { user: { select: userSummarySelect } }, orderBy: { amount: "desc" as const } },
} as const;

/**
 * The group's expenses (roadmap phase 3). Members only: never visible on a public trip, never
 * copied by a fork. Amounts are integers of the trip currency's smallest unit; shares always add up
 * to the expense (equal splits hand out leftover units one by one). Balances, the fewest repayments
 * to settle up, and totals are computed on read — the rows are the only state.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TripAccessService,
    private readonly realtime: RealtimeService,
    private readonly events: TripEventsService,
  ) {}

  private async trip(tripId: string, viewerId: string) {
    return this.access.require("expenses.manage", tripId, viewerId);
  }

  /** Payer and sharers must be on the trip — or, when editing, already part of this expense (someone who has left). */
  private shares(trip: AccessTrip, input: ExpenseInput, keep: Set<string> = new Set()) {
    const members = new Set([...trip.members.map((m) => m.userId), ...keep]);
    const shares = input.split.mode === "equal" ? splitEqually(input.amount, input.split.userIds) : input.split.shares.filter((s) => s.amount > 0);
    if (!shares.length) throw Errors.invalid("Choose who shares it.", { split: "Choose who shares it." });
    for (const id of [input.paidById, ...shares.map((s) => s.userId)])
      if (!members.has(id)) throw Errors.invalid("Everyone on an expense has to be on the trip.", { split: "Everyone on an expense has to be on the trip." });
    return shares;
  }

  private async assertItem(tx: Tx, tripId: string, itemId: string | null | undefined) {
    if (itemId && !(await tx.itineraryItem.findFirst({ where: { id: itemId, tripId }, select: { id: true } }))) throw Errors.invalid("That stop isn't on this trip.");
  }

  private canEdit(trip: AccessTrip, viewerId: string, row: { createdById: string; paidById: string }) {
    return trip.ownerId === viewerId || row.createdById === viewerId || row.paidById === viewerId;
  }

  async list(tripId: string, viewerId: string): Promise<ExpensesView> {
    const trip = await this.trip(tripId, viewerId);
    const [expenses, settlements, people] = await Promise.all([
      this.prisma.expense.findMany({ where: { tripId }, include: expenseInclude, orderBy: [{ spentOn: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }] }),
      this.prisma.settlement.findMany({
        where: { tripId },
        include: { from: { select: userSummarySelect }, to: { select: userSummarySelect }, createdBy: { select: userSummarySelect } },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.tripMember.findMany({ where: { tripId }, include: { user: { select: userSummarySelect } }, orderBy: { joinedAt: "asc" } }),
    ]);
    const n = (v: bigint) => Number(v);
    // Everyone on the trip, plus anyone on an expense who has since left.
    const users = new Map<string, UserSummary>();
    people.forEach((m) => users.set(m.userId, toUserSummary(m.user)));
    expenses.forEach((e) => {
      users.set(e.paidById, users.get(e.paidById) ?? toUserSummary(e.paidBy));
      e.shares.forEach((s) => users.set(s.userId, users.get(s.userId) ?? toUserSummary(s.user)));
    });
    settlements.forEach((s) => {
      users.set(s.fromId, users.get(s.fromId) ?? toUserSummary(s.from));
      users.set(s.toId, users.get(s.toId) ?? toUserSummary(s.to));
    });

    const sums = balances({
      expenses: expenses.map((e) => ({ paidById: e.paidById, amount: n(e.amount), shares: e.shares.map((s) => ({ userId: s.userId, amount: n(s.amount) })) })),
      settlements: settlements.map((s) => ({ fromId: s.fromId, toId: s.toId, amount: n(s.amount) })),
    });
    const net = new Map([...users.keys()].map((id) => [id, sums.get(id)?.net ?? 0]));
    const byCategory = new Map<ExpenseCategory, number>();
    const byDay = new Map<string, number>();
    for (const e of expenses) {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + n(e.amount));
      const d = fromDate(e.spentOn);
      if (d) byDay.set(d, (byDay.get(d) ?? 0) + n(e.amount));
    }

    return {
      currency: trip.currency,
      digits: currencyDigits(trip.currency),
      expenses: expenses.map((e) => this.toView(e, trip, viewerId)),
      settlements: settlements.map(
        (s): SettlementView => ({
          id: s.id,
          from: toUserSummary(s.from),
          to: toUserSummary(s.to),
          amount: n(s.amount),
          createdBy: toUserSummary(s.createdBy),
          createdAt: s.createdAt.toISOString(),
          canDelete: [s.createdById, s.fromId, s.toId, trip.ownerId].includes(viewerId),
        }),
      ),
      balances: [...users.entries()].map(([id, user]) => ({ user, paid: sums.get(id)?.paid ?? 0, owed: sums.get(id)?.owed ?? 0, net: net.get(id) ?? 0 })),
      transfers: settleUp(net).map((t) => ({ from: users.get(t.fromId)!, to: users.get(t.toId)!, amount: t.amount })),
      total: expenses.reduce((a, e) => a + n(e.amount), 0),
      byCategory: [...byCategory.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
      byDay: [...byDay.entries()].map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date)),
      budget: trip.estimatedBudget,
      currencyLocked: expenses.length + settlements.length > 0,
    };
  }

  private toView(e: Awaited<ReturnType<typeof this.prisma.expense.findMany<{ include: typeof expenseInclude }>>>[number], trip: AccessTrip, viewerId: string): ExpenseView {
    return {
      id: e.id,
      description: e.description,
      amount: Number(e.amount),
      category: e.category,
      paidBy: toUserSummary(e.paidBy),
      spentOn: fromDate(e.spentOn),
      item: e.item,
      shares: e.shares.map((s) => ({ user: toUserSummary(s.user), amount: Number(s.amount) })),
      createdBy: toUserSummary(e.createdBy),
      createdAt: e.createdAt.toISOString(),
      canEdit: this.canEdit(trip, viewerId, e),
    };
  }

  async create(tripId: string, viewerId: string, input: ExpenseInput) {
    const trip = await this.trip(tripId, viewerId);
    const shares = this.shares(trip, input);
    await this.prisma.transaction(async (tx) => {
      await lockTrip(tx, tripId);
      if ((await tx.expense.count({ where: { tripId } })) >= MAX_EXPENSES) throw Errors.invalid(`A trip can have up to ${MAX_EXPENSES} expenses.`);
      await this.assertItem(tx, tripId, input.itemId);
      const e = await tx.expense.create({
        data: {
          tripId,
          paidById: input.paidById,
          amount: BigInt(input.amount),
          description: input.description,
          category: input.category,
          spentOn: toDate(input.spentOn ?? null),
          itemId: input.itemId ?? null,
          createdById: viewerId,
          shares: { create: shares.map((s) => ({ userId: s.userId, amount: BigInt(s.amount) })) },
        },
      });
      await this.events.log({ tripId, actorId: viewerId, type: "expense.added", itemId: e.itemId, payload: { category: e.category, people: shares.length, split: input.split.mode } }, tx);
    });
    this.realtime.trip(tripId, viewerId, "trip.expenses.updated", tripId);
    return this.list(tripId, viewerId);
  }

  async update(expenseId: string, viewerId: string, input: ExpenseInput) {
    const row = await this.prisma.expense.findUnique({ where: { id: expenseId }, include: { shares: { select: { userId: true } } } });
    if (!row) throw Errors.notFound("That expense");
    const trip = await this.trip(row.tripId, viewerId);
    if (!this.canEdit(trip, viewerId, row)) throw new AppError(403, "Only whoever added or paid an expense, or the trip owner, can change it.");
    const shares = this.shares(trip, input, new Set([row.paidById, ...row.shares.map((s) => s.userId)]));
    await this.prisma.transaction(async (tx) => {
      await lockTrip(tx, row.tripId);
      await this.assertItem(tx, row.tripId, input.itemId);
      await tx.expenseShare.deleteMany({ where: { expenseId } });
      await tx.expense.update({
        where: { id: expenseId },
        data: {
          paidById: input.paidById,
          amount: BigInt(input.amount),
          description: input.description,
          category: input.category,
          spentOn: toDate(input.spentOn ?? null),
          itemId: input.itemId ?? null,
          shares: { create: shares.map((s) => ({ userId: s.userId, amount: BigInt(s.amount) })) },
        },
      });
      await this.events.log({ tripId: row.tripId, actorId: viewerId, type: "expense.updated", itemId: input.itemId ?? null, payload: { category: input.category, people: shares.length, split: input.split.mode } }, tx);
    });
    this.realtime.trip(row.tripId, viewerId, "trip.expenses.updated", row.tripId);
    return this.list(row.tripId, viewerId);
  }

  async remove(expenseId: string, viewerId: string) {
    const row = await this.prisma.expense.findUnique({ where: { id: expenseId } });
    if (!row) throw Errors.notFound("That expense");
    const trip = await this.trip(row.tripId, viewerId);
    if (!this.canEdit(trip, viewerId, row)) throw new AppError(403, "Only whoever added or paid an expense, or the trip owner, can change it.");
    await this.prisma.transaction(async (tx) => {
      await tx.expense.delete({ where: { id: expenseId } });
      await this.events.log({ tripId: row.tripId, actorId: viewerId, type: "expense.deleted", payload: { category: row.category } }, tx);
    });
    this.realtime.trip(row.tripId, viewerId, "trip.expenses.updated", row.tripId);
    return this.list(row.tripId, viewerId);
  }

  /**
   * Records a repayment. Both people must be on the trip — or on its money already (someone who left the trip
   * still owes or is owed what their expenses say, and settling up with them has to stay possible).
   */
  async settle(tripId: string, viewerId: string, input: SettlementInput) {
    const trip = await this.trip(tripId, viewerId);
    // Only someone in the repayment (or the owner, who keeps the books) records it — never a third member.
    if (![input.fromId, input.toId, trip.ownerId].includes(viewerId)) throw new AppError(403, "Only the person paying, the person paid, or the trip owner can record a repayment.");
    const members = new Set(trip.members.map((m) => m.userId));
    const onTheMoney = async (id: string) =>
      members.has(id) ||
      !!(await this.prisma.expense.findFirst({ where: { tripId, OR: [{ paidById: id }, { shares: { some: { userId: id } } }] }, select: { id: true } }));
    if (!(await onTheMoney(input.fromId)) || !(await onTheMoney(input.toId))) throw Errors.invalid("Both people have to be on the trip.");
    await this.prisma.transaction(async (tx) => {
      await tx.settlement.create({ data: { tripId, fromId: input.fromId, toId: input.toId, amount: BigInt(input.amount), createdById: viewerId } });
      await this.events.log({ tripId, actorId: viewerId, type: "settlement.added", payload: { from: input.fromId, to: input.toId } }, tx);
    });
    this.realtime.trip(tripId, viewerId, "trip.expenses.updated", tripId);
    return this.list(tripId, viewerId);
  }

  async unsettle(settlementId: string, viewerId: string) {
    const row = await this.prisma.settlement.findUnique({ where: { id: settlementId } });
    if (!row) throw Errors.notFound("That repayment");
    const trip = await this.trip(row.tripId, viewerId);
    if (![row.createdById, row.fromId, row.toId, trip.ownerId].includes(viewerId)) throw new AppError(403, "Only the two people involved, or the trip owner, can undo a repayment.");
    await this.prisma.transaction(async (tx) => {
      await tx.settlement.delete({ where: { id: settlementId } });
      await this.events.log({ tripId: row.tripId, actorId: viewerId, type: "settlement.deleted" }, tx);
    });
    this.realtime.trip(row.tripId, viewerId, "trip.expenses.updated", row.tripId);
    return this.list(row.tripId, viewerId);
  }
}

@Controller()
export class ExpensesController {
  constructor(private readonly svc: ExpensesService) {}

  @Get("trips/:id/expenses")
  list(@Param("id", Uuid) id: string, @ViewerId() me: string | null) {
    return this.svc.list(id, requireUser(me));
  }

  @Post("trips/:id/expenses")
  create(@Param("id", Uuid) id: string, @ViewerId() me: string | null, @Body(new ZodPipe(expenseSchema)) body: ExpenseInput) {
    return this.svc.create(id, requireUser(me), body);
  }

  @Patch("expenses/:expenseId")
  update(@Param("expenseId", Uuid) expenseId: string, @ViewerId() me: string | null, @Body(new ZodPipe(expenseSchema)) body: ExpenseInput) {
    return this.svc.update(expenseId, requireUser(me), body);
  }

  @Delete("expenses/:expenseId")
  @HttpCode(200)
  remove(@Param("expenseId", Uuid) expenseId: string, @ViewerId() me: string | null) {
    return this.svc.remove(expenseId, requireUser(me));
  }

  @Post("trips/:id/settlements")
  settle(@Param("id", Uuid) id: string, @ViewerId() me: string | null, @Body(new ZodPipe(settlementSchema)) body: SettlementInput) {
    return this.svc.settle(id, requireUser(me), body);
  }

  @Delete("settlements/:settlementId")
  @HttpCode(200)
  unsettle(@Param("settlementId", Uuid) settlementId: string, @ViewerId() me: string | null) {
    return this.svc.unsettle(settlementId, requireUser(me));
  }
}

@Module({ imports: [TripsModule], controllers: [ExpensesController], providers: [ExpensesService] })
export class ExpensesModule {}
