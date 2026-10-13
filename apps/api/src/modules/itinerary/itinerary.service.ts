import { Injectable } from "@nestjs/common";
import { orderBySlot, slotForTime, type CreateItemInput, type DayView, type ItemSlot, type ItemView, type ReorderItemInput, type UpdateItemInput, type VoteLevel } from "@triply/shared";
import { addDays, fromDate, MAX_TRIP_DAYS, toDate } from "../../common/dates";
import { Errors } from "../../common/http";
import { lockTrip, writeSortOrder } from "../../common/locks";
import { dayInclude, itemInclude, listablePlace, toDayView, toItemView } from "../../common/presenters";
import { PrismaService, type Tx } from "../../prisma/prisma.service";
import { TripEventsService } from "../activity/trip-events";
import { NotificationsService } from "../notifications/notifications";
import { RealtimeService } from "../realtime/realtime";
import { TripAccessService } from "../trips/trip-access.service";
import { insertAt } from "./itinerary.logic";

/** How many ideas a trip's pool may hold (a soft guard against runaway lists). */
export const MAX_POOL_ITEMS = 300;

/**
 * Days and items of a trip plan. Plans are flexible (roadmap phases 0–1): items sit in a part of
 * the day (`slot`) and only anchors carry a clock time; items with no day are the trip's place
 * pool. Every structural change runs under the trip lock and is recorded in `trip_events`.
 */
@Injectable()
export class ItineraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TripAccessService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly events: TripEventsService,
  ) {}

  private async dayWithTrip(dayId: string, tx: Tx = this.prisma) {
    const day = await tx.tripDay.findUnique({ where: { id: dayId } });
    if (!day) throw Errors.notFound("That day");
    return day;
  }

  private async item(itemId: string, tx: Tx = this.prisma) {
    const item = await tx.itineraryItem.findUnique({ where: { id: itemId }, include: { day: true } });
    if (!item) throw Errors.notFound("That item (someone may have removed it)");
    return item;
  }

  private async itemView(id: string, viewerId: string) {
    const i = await this.prisma.itineraryItem.findUniqueOrThrow({ where: { id }, include: itemInclude(viewerId) });
    return toItemView(i);
  }

  private async assertPlace(placeId: string | null | undefined) {
    if (placeId && !(await this.prisma.place.findFirst({ where: { id: placeId, ...listablePlace }, select: { id: true } })))
      throw Errors.invalid("That place doesn't exist or has closed.");
  }

  /** The items of one list — a day, or the pool when `dayId` is null — in their current order. */
  private list(tx: Tx, tripId: string, dayId: string | null) {
    return tx.itineraryItem.findMany({ where: { tripId, dayId }, orderBy: { sortOrder: "asc" } });
  }

  /** Re-numbers a day grouped by part of the day (anchors chronological); the pool keeps its order. */
  private async normalize(tx: Tx, tripId: string, dayId: string | null) {
    const items = await this.list(tx, tripId, dayId);
    await writeSortOrder(tx, dayId ? orderBySlot(items) : items.map((i) => i.id));
  }

  private async touch(tx: Tx, tripId: string) {
    await tx.trip.update({ where: { id: tripId }, data: { updatedAt: new Date() } });
  }

  /** A clock time decides the part of the day; otherwise the requested slot, else the fallback. */
  private slotFor(startTime: string | null | undefined, slot: ItemSlot | undefined, fallback: ItemSlot): ItemSlot {
    return startTime ? slotForTime(startTime) : (slot ?? fallback);
  }

  // ── Days ───────────────────────────────────────────────────────────────
  async days(tripId: string, viewerId: string | null): Promise<DayView[]> {
    await this.access.require("itinerary.view", tripId, viewerId);
    const days = await this.prisma.tripDay.findMany({ where: { tripId }, orderBy: { dayNumber: "asc" }, include: dayInclude(viewerId) });
    return days.map(toDayView);
  }

  async pool(tripId: string, viewerId: string | null): Promise<ItemView[]> {
    await this.access.require("itinerary.view", tripId, viewerId);
    const items = await this.prisma.itineraryItem.findMany({ where: { tripId, dayId: null }, orderBy: { sortOrder: "asc" }, include: itemInclude(viewerId) });
    return items.map(toItemView);
  }

  async addDay(tripId: string, viewerId: string): Promise<DayView> {
    const trip = await this.access.require("itinerary.add", tripId, viewerId);
    const day = await this.prisma.transaction(async (tx) => {
      await lockTrip(tx, tripId);
      const last = await tx.tripDay.findFirst({ where: { tripId }, orderBy: { dayNumber: "desc" } });
      const n = (last?.dayNumber ?? 0) + 1;
      if (n > MAX_TRIP_DAYS) throw Errors.invalid(`Trips can be up to ${MAX_TRIP_DAYS} days long.`);
      const start = fromDate(trip.startDate);
      const date = start ? addDays(start, n - 1) : null;
      const created = await tx.tripDay.create({ data: { tripId, dayNumber: n, date: toDate(date) } });
      if (date) await tx.trip.update({ where: { id: tripId }, data: { endDate: toDate(date) } });
      return created;
    });
    this.realtime.trip(tripId, viewerId, "trip.day.created", day.id);
    return toDayView({ ...day, items: [] });
  }

  async updateDay(tripId: string, dayId: string, viewerId: string, title: string | null) {
    await this.access.require("itinerary.edit", tripId, viewerId);
    const day = await this.dayWithTrip(dayId);
    if (day.tripId !== tripId) throw Errors.notFound("That day");
    await this.prisma.tripDay.update({ where: { id: dayId }, data: { title } });
    this.realtime.trip(tripId, viewerId, "trip.updated", dayId);
    return { ok: true };
  }

  /**
   * Removes a day, renumbers later days and keeps dates contiguous. Its places aren't lost: they
   * go back to the pool (notes and custom items are deleted with the day).
   */
  async deleteDay(tripId: string, dayId: string, viewerId: string) {
    const trip = await this.access.require("itinerary.delete", tripId, viewerId);
    const day = await this.dayWithTrip(dayId);
    if (day.tripId !== tripId) throw Errors.notFound("That day");
    await this.prisma.transaction(async (tx) => {
      await lockTrip(tx, tripId);
      const count = await tx.tripDay.count({ where: { tripId } });
      if (count <= 1) throw Errors.invalid("A trip needs at least one day.");
      const keep = await tx.itineraryItem.findMany({ where: { dayId, placeId: { not: null } }, orderBy: { sortOrder: "asc" }, select: { id: true } });
      if (keep.length) {
        const poolIds = (await this.list(tx, tripId, null)).map((i) => i.id);
        await tx.itineraryItem.updateMany({ where: { id: { in: keep.map((k) => k.id) } }, data: { dayId: null, slot: "ANY", startTime: null, endTime: null } });
        await writeSortOrder(tx, [...poolIds, ...keep.map((k) => k.id)]);
      }
      await tx.tripDay.delete({ where: { id: dayId } });
      const rest = await tx.tripDay.findMany({ where: { tripId }, orderBy: { dayNumber: "asc" } });
      // Two passes avoid violating the (trip_id, day_number) unique constraint mid-update.
      for (const [i, d] of rest.entries()) await tx.tripDay.update({ where: { id: d.id }, data: { dayNumber: 1000 + i } });
      const start = fromDate(trip.startDate);
      for (const [i, d] of rest.entries())
        await tx.tripDay.update({ where: { id: d.id }, data: { dayNumber: i + 1, date: start ? toDate(addDays(start, i)) : d.date } });
      if (start) await tx.trip.update({ where: { id: tripId }, data: { endDate: toDate(addDays(start, rest.length - 1)) } });
      for (const k of keep) await this.events.log({ tripId, actorId: viewerId, type: "item.moved", itemId: k.id, payload: { toDay: null, reason: "day_deleted" } }, tx);
    });
    this.realtime.trip(tripId, viewerId, "trip.updated", dayId);
    return { ok: true };
  }

  // ── Items ──────────────────────────────────────────────────────────────
  async addItem(dayId: string, viewerId: string, input: CreateItemInput): Promise<ItemView> {
    const day = await this.dayWithTrip(dayId);
    const trip = await this.access.require("itinerary.add", day.tripId, viewerId);
    await this.assertPlace(input.placeId);
    const { status: _status, ...data } = input;
    const item = await this.prisma.transaction(async (tx) => {
      await lockTrip(tx, trip.id);
      const count = await tx.itineraryItem.count({ where: { dayId } });
      const slot = this.slotFor(input.startTime, input.slot, "ANY");
      const created = await tx.itineraryItem.create({
        data: { ...data, slot, placeId: input.type === "NOTE" ? null : input.placeId, tripId: trip.id, dayId, sortOrder: count, updatedById: viewerId, addedById: viewerId },
      });
      await this.normalize(tx, trip.id, dayId);
      await this.touch(tx, trip.id);
      await this.events.log({ tripId: trip.id, actorId: viewerId, type: "item.added", itemId: created.id, placeId: created.placeId, payload: { day: day.dayNumber, slot, itemType: created.type, timed: !!created.startTime } }, tx);
      await this.notifications.notify(this.access.memberIds(trip), viewerId, "TRIP_ITEM_ADDED", { k: "item_added", item: created.title, day: day.dayNumber, trip: trip.title }, { tripId: trip.id }, tx);
      return created;
    });
    this.realtime.trip(trip.id, viewerId, "trip.item.created", item.id);
    return this.itemView(item.id, viewerId);
  }

  /** POST /trips/:id/pool — an idea for the trip, not yet on a day. */
  async addToPool(tripId: string, viewerId: string, input: CreateItemInput): Promise<ItemView> {
    const trip = await this.access.require("itinerary.add", tripId, viewerId);
    await this.assertPlace(input.placeId);
    if (input.type === "NOTE") throw Errors.invalid("Notes belong on a day; the pool is for places and activities.");
    const { status: _status, startTime: _s, endTime: _e, slot: _slot, ...data } = input;
    const item = await this.prisma.transaction(async (tx) => {
      await lockTrip(tx, tripId);
      const count = await tx.itineraryItem.count({ where: { tripId, dayId: null } });
      if (count >= MAX_POOL_ITEMS) throw Errors.invalid(`A trip's pool holds up to ${MAX_POOL_ITEMS} ideas. Plan some into days or remove a few first.`);
      if (input.placeId && (await tx.itineraryItem.findFirst({ where: { tripId, dayId: null, placeId: input.placeId }, select: { id: true } })))
        throw Errors.conflict("That place is already in the pool.");
      const created = await tx.itineraryItem.create({ data: { ...data, tripId, dayId: null, slot: "ANY", sortOrder: count, updatedById: viewerId, addedById: viewerId } });
      await this.touch(tx, tripId);
      await this.events.log({ tripId, actorId: viewerId, type: "item.pooled", itemId: created.id, placeId: created.placeId, payload: { itemType: created.type } }, tx);
      await this.notifications.notify(this.access.memberIds(trip), viewerId, "TRIP_ITEM_ADDED", { k: "pool_added", item: created.title, trip: trip.title }, { tripId }, tx);
      return created;
    });
    this.realtime.trip(tripId, viewerId, "trip.item.created", item.id);
    return this.itemView(item.id, viewerId);
  }

  async updateItem(itemId: string, viewerId: string, input: UpdateItemInput): Promise<ItemView> {
    const item = await this.item(itemId);
    const trip = await this.access.require("itinerary.edit", item.tripId, viewerId);
    await this.assertPlace(input.placeId);
    const merged = { startTime: input.startTime !== undefined ? input.startTime : item.startTime, endTime: input.endTime !== undefined ? input.endTime : item.endTime };
    if (merged.startTime && merged.endTime && merged.endTime < merged.startTime)
      throw Errors.invalid("End time should be after the start time.", { endTime: "End time should be after the start time." });
    await this.prisma.transaction(async (tx) => {
      await lockTrip(tx, trip.id);
      const cur = await tx.itineraryItem.findUnique({ where: { id: itemId } });
      if (!cur) throw Errors.notFound("That item (someone may have removed it)");
      // Pool items have no part of the day or time yet.
      const pooled = cur.dayId === null;
      const slot = pooled ? "ANY" : this.slotFor(merged.startTime, input.slot, cur.slot);
      const updated = await tx.itineraryItem.update({
        where: { id: itemId },
        data: {
          ...input,
          slot,
          ...(pooled ? { startTime: null, endTime: null } : {}),
          ...(input.type === "NOTE" ? { placeId: null } : {}),
          updatedById: viewerId,
        },
      });
      if (!pooled && (slot !== cur.slot || updated.startTime !== cur.startTime)) await this.normalize(tx, trip.id, cur.dayId);
      await this.touch(tx, trip.id);
      if (input.status !== undefined && input.status !== cur.status)
        await this.events.log({ tripId: trip.id, actorId: viewerId, type: "item.status", itemId, placeId: updated.placeId, payload: { from: cur.status, to: updated.status } }, tx);
      const changed = (["title", "type", "placeId", "startTime", "endTime", "notes", "description"] as const).filter((k) => input[k] !== undefined && input[k] !== cur[k]);
      if (changed.length || slot !== cur.slot)
        await this.events.log({ tripId: trip.id, actorId: viewerId, type: "item.updated", itemId, placeId: updated.placeId, payload: { fields: [...changed, ...(slot !== cur.slot ? ["slot"] : [])].join(","), slot } }, tx);
      await this.notifications.notify(this.access.memberIds(trip), viewerId, "TRIP_ITEM_UPDATED", { k: "item_updated", item: updated.title, trip: trip.title }, { tripId: trip.id }, tx);
    });
    this.realtime.trip(trip.id, viewerId, "trip.item.updated", itemId);
    return this.itemView(itemId, viewerId);
  }

  async deleteItem(itemId: string, viewerId: string) {
    const item = await this.item(itemId);
    const trip = await this.access.require("itinerary.delete", item.tripId, viewerId);
    await this.prisma.transaction(async (tx) => {
      await lockTrip(tx, trip.id);
      // Re-read under the lock: the item may have moved to another day (or gone) meanwhile.
      const cur = await tx.itineraryItem.findUnique({ where: { id: itemId }, select: { dayId: true, placeId: true, _count: { select: { votes: true } } } });
      if (!cur) throw Errors.notFound("That item (someone may have removed it)");
      await tx.itineraryItem.delete({ where: { id: itemId } });
      const rest = await this.list(tx, trip.id, cur.dayId);
      await writeSortOrder(tx, rest.map((r) => r.id));
      await this.touch(tx, trip.id);
      await this.events.log({ tripId: trip.id, actorId: viewerId, type: "item.deleted", itemId, placeId: cur.placeId, payload: { pooled: cur.dayId === null, votes: cur._count.votes } }, tx);
    });
    this.realtime.trip(trip.id, viewerId, "trip.item.deleted", itemId);
    return { ok: true };
  }

  async duplicateItem(itemId: string, viewerId: string): Promise<ItemView> {
    const item = await this.item(itemId);
    const trip = await this.access.require("itinerary.add", item.tripId, viewerId);
    if (item.dayId === null) throw Errors.invalid("Pool ideas can't be duplicated; plan it into a day first.");
    const copy = await this.prisma.transaction(async (tx) => {
      await lockTrip(tx, trip.id);
      const cur = await this.item(itemId, tx);
      const ids = (await this.list(tx, trip.id, cur.dayId)).map((i) => i.id);
      const created = await tx.itineraryItem.create({
        data: {
          tripId: trip.id,
          dayId: cur.dayId,
          slot: cur.slot,
          type: item.type,
          title: `${item.title} (copy)`,
          description: item.description,
          placeId: item.placeId,
          startTime: item.startTime,
          endTime: item.endTime,
          notes: item.notes,
          sortOrder: ids.length,
          updatedById: viewerId,
          addedById: viewerId,
        },
      });
      await writeSortOrder(tx, insertAt(ids, created.id, ids.indexOf(itemId) + 1));
      await this.normalize(tx, trip.id, cur.dayId);
      await this.touch(tx, trip.id);
      await this.events.log({ tripId: trip.id, actorId: viewerId, type: "item.added", itemId: created.id, placeId: created.placeId, payload: { day: cur.day?.dayNumber ?? null, slot: cur.slot, copyOf: itemId } }, tx);
      return created;
    });
    this.realtime.trip(trip.id, viewerId, "trip.item.created", copy.id);
    return this.itemView(copy.id, viewerId);
  }

  /**
   * POST /items/:id/reorder — move within a day, to another day or part of the day, or between
   * the pool and a day. `index` is the position in the target list (a day's items in display
   * order, or the pool). Anchors keep the part of the day their time puts them in.
   */
  async reorder(itemId: string, viewerId: string, to: ReorderItemInput) {
    const item = await this.item(itemId);
    const trip = await this.access.require("itinerary.reorder", item.tripId, viewerId);
    const target = to.dayId ? await this.dayWithTrip(to.dayId) : null;
    if (target && target.tripId !== trip.id) throw Errors.invalid("Items can only move within the same trip.");
    await this.prisma.transaction(async (tx) => {
      // Under the trip lock, read the item's CURRENT list and the target's CURRENT list, and
      // change only the moved item: a concurrent move by someone else is never undone.
      await lockTrip(tx, trip.id);
      const cur = await tx.itineraryItem.findUnique({ where: { id: itemId } });
      if (!cur) throw Errors.notFound("That item (someone may have removed it)");
      if (!to.dayId && cur.type === "NOTE") throw Errors.invalid("Notes belong on a day; the pool is for places and activities.");
      const toPool = to.dayId === null;
      const slot: ItemSlot = toPool ? "ANY" : this.slotFor(cur.startTime, to.slot, cur.dayId === null ? "ANY" : cur.slot);
      await tx.itineraryItem.update({
        where: { id: itemId },
        // Into the pool, a clock time no longer means anything.
        data: { dayId: to.dayId, slot, ...(toPool ? { startTime: null, endTime: null } : {}), updatedById: viewerId },
      });
      const targetIds = (await this.list(tx, trip.id, to.dayId)).map((i) => i.id);
      await writeSortOrder(tx, insertAt(targetIds, itemId, to.index));
      if (to.dayId) await this.normalize(tx, trip.id, to.dayId);
      if (cur.dayId !== to.dayId) {
        const rest = await this.list(tx, trip.id, cur.dayId);
        await writeSortOrder(tx, rest.map((r) => r.id));
      }
      await this.touch(tx, trip.id);
      if (cur.dayId !== to.dayId || cur.slot !== slot)
        await this.events.log(
          { tripId: trip.id, actorId: viewerId, type: "item.moved", itemId, placeId: cur.placeId, payload: { fromDay: cur.dayId === null ? null : (item.day?.dayNumber ?? null), toDay: target?.dayNumber ?? null, fromSlot: cur.slot, toSlot: slot } },
          tx,
        );
    });
    this.realtime.trip(trip.id, viewerId, "trip.item.reordered", itemId);
    return { ok: true };
  }

  // ── Votes ──────────────────────────────────────────────────────────────
  /** PUT /items/:id/vote — one vote per member and item; voting again changes it. */
  async vote(itemId: string, viewerId: string, level: VoteLevel): Promise<ItemView> {
    const item = await this.item(itemId);
    const trip = await this.access.require("itinerary.vote", item.tripId, viewerId);
    await this.prisma.transaction(async (tx) => {
      const prev = await tx.itemVote.findUnique({ where: { itemId_userId: { itemId, userId: viewerId } } });
      if (prev?.level === level) return;
      await tx.itemVote.upsert({ where: { itemId_userId: { itemId, userId: viewerId } }, create: { itemId, userId: viewerId, level }, update: { level } });
      await this.events.log({ tripId: trip.id, actorId: viewerId, type: "item.voted", itemId, placeId: item.placeId, payload: { level, from: prev?.level ?? null, pooled: item.dayId === null } }, tx);
    });
    this.realtime.trip(trip.id, viewerId, "trip.item.voted", itemId);
    return this.itemView(itemId, viewerId);
  }

  async unvote(itemId: string, viewerId: string): Promise<ItemView> {
    const item = await this.item(itemId);
    const trip = await this.access.require("itinerary.vote", item.tripId, viewerId);
    await this.prisma.transaction(async (tx) => {
      const { count } = await tx.itemVote.deleteMany({ where: { itemId, userId: viewerId } });
      if (count) await this.events.log({ tripId: trip.id, actorId: viewerId, type: "item.unvoted", itemId, placeId: item.placeId }, tx);
    });
    this.realtime.trip(trip.id, viewerId, "trip.item.voted", itemId);
    return this.itemView(itemId, viewerId);
  }
}
