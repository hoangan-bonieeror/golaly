import { Injectable } from "@nestjs/common";
import type { CreateTripInput, TripDetail, TripSummary, UpdateTripInput } from "@triply/shared";
import { addDays, dayCount, fromDate, MAX_TRIP_DAYS, toDate } from "../../common/dates";
import { Errors } from "../../common/http";
import {
  dayInclude,
  toDayView,
  toTripSummary,
  toUserSummary,
  tripSummaryInclude,
  userSummarySelect,
} from "../../common/presenters";
import { PrismaService, type Tx } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit";
import { NotificationsService } from "../notifications/notifications";
import { RealtimeService } from "../realtime/realtime";
import { SearchIndexService } from "../search/search-index";
import { TripAccessService } from "./trip-access.service";

const FALLBACK_COVER: [string, string] = ["#0e6e6a", "#f26b4e"];

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TripAccessService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly searchIndex: SearchIndexService,
  ) {}

  // ── Reads ──────────────────────────────────────────────────────────────
  async summary(tripId: string, viewerId: string | null, tx: Tx = this.prisma): Promise<TripSummary> {
    const t = await tx.trip.findUniqueOrThrow({ where: { id: tripId }, include: tripSummaryInclude(viewerId) });
    return toTripSummary(t, viewerId);
  }

  async detail(tripId: string, viewerId: string | null): Promise<TripDetail> {
    const trip = await this.access.require("trip.view", tripId, viewerId);
    const isOwner = trip.ownerId === viewerId;
    const [t, days, members, invitations] = await Promise.all([
      this.prisma.trip.findUniqueOrThrow({ where: { id: tripId }, include: tripSummaryInclude(viewerId) }),
      this.prisma.tripDay.findMany({ where: { tripId }, orderBy: { dayNumber: "asc" }, include: dayInclude(viewerId) }),
      this.prisma.tripMember.findMany({ where: { tripId }, include: { user: { select: userSummarySelect } }, orderBy: { joinedAt: "asc" } }),
      isOwner
        ? this.prisma.tripInvitation.findMany({
            where: { tripId, revokedAt: null, acceptedAt: null, expiresAt: { gt: new Date() } },
            include: { inviter: { select: userSummarySelect } },
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
    ]);
    const order = { OWNER: 0, EDITOR: 1, VIEWER: 2 } as const;
    return {
      ...toTripSummary(t, viewerId),
      days: days.map(toDayView),
      // Non-members of a public trip see who created it, not the private member list (spec §34).
      members: (trip.members.some((m) => m.userId === viewerId) ? members : members.filter((m) => m.role === "OWNER"))
        .sort((a, b) => order[a.role] - order[b.role])
        .map((m) => ({ user: toUserSummary(m.user), role: m.role, joinedAt: m.joinedAt.toISOString() })),
      permissions: this.access.permissions(trip, viewerId),
      ...(isOwner
        ? {
            pendingInvitations: invitations.map((i) => ({
              id: i.id,
              email: i.email,
              role: i.role as "EDITOR" | "VIEWER",
              expiresAt: i.expiresAt.toISOString(),
              createdAt: i.createdAt.toISOString(),
              invitedBy: toUserSummary(i.inviter),
            })),
          }
        : {}),
    };
  }

  async mine(viewerId: string, filter: "all" | "mine" | "shared" | "past"): Promise<TripSummary[]> {
    const today = toDate(new Date().toISOString().slice(0, 10));
    const rows = await this.prisma.trip.findMany({
      where: {
        deletedAt: null,
        members: { some: { userId: viewerId } },
        ...(filter === "mine" ? { ownerId: viewerId } : {}),
        ...(filter === "shared" ? { ownerId: { not: viewerId } } : {}),
        ...(filter === "past" ? { endDate: { lt: today } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      include: tripSummaryInclude(viewerId),
    });
    return rows.map((t) => toTripSummary(t, viewerId));
  }

  async saved(viewerId: string): Promise<TripSummary[]> {
    const rows = await this.prisma.trip.findMany({
      where: {
        deletedAt: null,
        savedBy: { some: { userId: viewerId } },
        // A saved trip that later went private disappears for non-members.
        OR: [{ visibility: { not: "PRIVATE" } }, { members: { some: { userId: viewerId } } }],
      },
      include: tripSummaryInclude(viewerId),
    });
    return rows.map((t) => toTripSummary(t, viewerId));
  }

  // ── Writes ─────────────────────────────────────────────────────────────
  async create(ownerId: string, input: CreateTripInput & { destinationIds: string[] }): Promise<TripSummary> {
    const destinations = await this.validDestinations(input.destinationIds);
    const n = dayCount(input.startDate, input.endDate) ?? 1;
    if (n > MAX_TRIP_DAYS) throw Errors.invalid(`Trips can be up to ${MAX_TRIP_DAYS} days long.`);
    const cover = destinations[0] ? ([destinations[0].paletteA, destinations[0].paletteB] as const) : FALLBACK_COVER;

    const trip = await this.prisma.trip.create({
      data: {
        ownerId,
        title: input.title,
        description: input.description ?? "",
        startDate: toDate(input.startDate),
        endDate: toDate(input.endDate),
        visibility: "PRIVATE", // spec §17: default PRIVATE
        coverA: cover[0],
        coverB: cover[1],
        members: { create: { userId: ownerId, role: "OWNER" } },
        destinations: { create: input.destinationIds.map((destinationId, position) => ({ destinationId, position })) },
        days: {
          create: Array.from({ length: n }, (_, i) => ({
            dayNumber: i + 1,
            date: input.startDate ? toDate(addDays(input.startDate, i)) : null,
          })),
        },
      },
    });
    await this.searchIndex.trip(trip.id);
    return this.summary(trip.id, ownerId);
  }

  async update(tripId: string, viewerId: string, input: UpdateTripInput): Promise<TripSummary> {
    const trip = await this.access.require("trip.edit_details", tripId, viewerId);
    if (input.visibility && input.visibility !== trip.visibility) this.access.assert("trip.change_visibility", trip, viewerId);
    if (input.destinationIds) await this.validDestinations(input.destinationIds);
    if (input.coverMediaId) {
      const m = await this.prisma.media.findFirst({ where: { id: input.coverMediaId, ownerId: viewerId } });
      if (!m) throw Errors.invalid("Upload the cover photo first.");
    }
    const start = input.startDate !== undefined ? input.startDate : fromDate(trip.startDate);
    const end = input.endDate !== undefined ? input.endDate : fromDate(trip.endDate);
    if (start && end && end < start) throw Errors.invalid("End date can't be before the start date.", { endDate: "End date can't be before the start date." });

    await this.prisma.$transaction(async (tx) => {
      const { destinationIds, startDate, endDate, ...rest } = input;
      await tx.trip.update({
        where: { id: tripId },
        data: {
          ...rest,
          ...(startDate !== undefined ? { startDate: toDate(startDate) } : {}),
          ...(endDate !== undefined ? { endDate: toDate(endDate) } : {}),
        },
      });
      if (destinationIds) {
        await tx.tripDestination.deleteMany({ where: { tripId } });
        await tx.tripDestination.createMany({ data: destinationIds.map((destinationId, position) => ({ tripId, destinationId, position })) });
      }
      if (startDate !== undefined || endDate !== undefined) await this.reconcileDays(tx, tripId, start, end);
      if (input.visibility && input.visibility !== trip.visibility)
        await this.audit.log(viewerId, "trip.visibility_changed", "trip", tripId, { from: trip.visibility, to: input.visibility }, tx);
      if (input.title !== undefined || input.description !== undefined || destinationIds) await this.searchIndex.trip(tripId, tx);
    });
    this.realtime.trip(tripId, viewerId, "trip.updated");
    return this.summary(tripId, viewerId);
  }

  /**
   * Keeps days in sync with the trip's date range. Never silently deletes plans:
   * shrinking the range only removes trailing days that are empty.
   */
  private async reconcileDays(tx: Tx, tripId: string, start: string | null, end: string | null) {
    const days = await tx.tripDay.findMany({ where: { tripId }, orderBy: { dayNumber: "asc" }, include: { _count: { select: { items: true } } } });
    const target = dayCount(start, end);
    if (target !== null) {
      if (target > MAX_TRIP_DAYS) throw Errors.invalid(`Trips can be up to ${MAX_TRIP_DAYS} days long.`);
      const extra = days.slice(target);
      const busy = extra.filter((d) => d._count.items > 0);
      if (busy.length)
        throw Errors.invalid(`Day ${busy[0].dayNumber}${busy.length > 1 ? ` and ${busy.length - 1} more` : ""} still has plans. Move or delete them before shortening the trip.`);
      if (extra.length) await tx.tripDay.deleteMany({ where: { id: { in: extra.map((d) => d.id) } } });
      for (let i = days.length; i < target; i++) await tx.tripDay.create({ data: { tripId, dayNumber: i + 1 } });
    }
    const all = await tx.tripDay.findMany({ where: { tripId }, orderBy: { dayNumber: "asc" } });
    for (const [i, d] of all.entries()) await tx.tripDay.update({ where: { id: d.id }, data: { date: start ? toDate(addDays(start, i)) : null } });
  }

  async remove(tripId: string, viewerId: string) {
    await this.access.require("trip.delete", tripId, viewerId);
    await this.prisma.$transaction(async (tx) => {
      await tx.trip.update({ where: { id: tripId }, data: { deletedAt: new Date() } }); // soft delete
      await tx.tripInvitation.updateMany({ where: { tripId, revokedAt: null, acceptedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log(viewerId, "trip.deleted", "trip", tripId, {}, tx);
    });
    this.realtime.trip(tripId, viewerId, "trip.updated");
  }

  async setSaved(tripId: string, viewerId: string, on: boolean): Promise<TripSummary> {
    const trip = await this.access.require("trip.view", tripId, viewerId);
    if (trip.visibility === "PRIVATE" && on) throw Errors.invalid("Private trips can't be saved — you're already a member.");
    const key = { userId_tripId: { userId: viewerId, tripId } };
    const existing = await this.prisma.savedTrip.findUnique({ where: key });
    if (on && !existing) {
      await this.prisma.$transaction([
        this.prisma.savedTrip.create({ data: { userId: viewerId, tripId } }),
        this.prisma.trip.update({ where: { id: tripId }, data: { saveCount: { increment: 1 } } }),
      ]);
      await this.notifications.notify([trip.ownerId], viewerId, "TRIP_SAVED", `saved your trip ${trip.title}`, { tripId });
    } else if (!on && existing) {
      await this.prisma.$transaction([
        this.prisma.savedTrip.delete({ where: key }),
        this.prisma.trip.update({ where: { id: tripId }, data: { saveCount: { decrement: 1 } } }),
      ]);
    }
    return this.summary(tripId, viewerId);
  }

  /**
   * Fork / Remix (spec §20). Copies title, description, dates, destinations, days, items and
   * place references. Does NOT copy members, invitations, comments, media or counters.
   * The forker becomes OWNER; the copy starts PRIVATE; attribution is stored; the source
   * trip's content is never modified (only its fork counter increases).
   */
  async fork(tripId: string, viewerId: string): Promise<TripSummary> {
    const src = await this.access.require("trip.fork", tripId, viewerId);
    const source = await this.prisma.trip.findUniqueOrThrow({
      where: { id: tripId },
      include: {
        owner: { select: { username: true } },
        destinations: { orderBy: { position: "asc" } },
        days: { orderBy: { dayNumber: "asc" }, include: { items: { orderBy: { sortOrder: "asc" } } } },
      },
    });

    const fork = await this.prisma.$transaction(async (tx) => {
      const created = await tx.trip.create({
        data: {
          ownerId: viewerId,
          title: source.title,
          description: source.description,
          startDate: source.startDate,
          endDate: source.endDate,
          estimatedBudget: source.estimatedBudget,
          currency: source.currency,
          coverA: source.coverA,
          coverB: source.coverB,
          visibility: "PRIVATE",
          forkedFromId: source.id,
          forkedFromTitle: source.title,
          forkedFromOwner: source.owner.username,
          searchText: source.searchText,
          members: { create: { userId: viewerId, role: "OWNER" } },
          destinations: { create: source.destinations.map((d) => ({ destinationId: d.destinationId, position: d.position })) },
        },
      });
      for (const day of source.days) {
        await tx.tripDay.create({
          data: {
            tripId: created.id,
            dayNumber: day.dayNumber,
            date: day.date,
            title: day.title,
            items: {
              create: day.items.map((i) => ({
                type: i.type,
                title: i.title,
                description: i.description,
                placeId: i.placeId,
                startTime: i.startTime,
                endTime: i.endTime,
                notes: i.notes,
                sortOrder: i.sortOrder,
                updatedById: viewerId,
              })),
            },
          },
        });
      }
      await tx.trip.update({ where: { id: source.id }, data: { forkCount: { increment: 1 }, updatedAt: source.updatedAt } });
      await this.notifications.notify([src.ownerId], viewerId, "TRIP_FORKED", `remixed your trip ${source.title}`, { tripId: source.id }, tx);
      return created;
    });
    return this.summary(fork.id, viewerId);
  }

  private async validDestinations(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.destination.findMany({ where: { id: { in: ids } } });
    if (rows.length !== new Set(ids).size) throw Errors.invalid("One of those destinations doesn't exist.");
    return ids.map((id) => rows.find((r) => r.id === id)!);
  }
}
