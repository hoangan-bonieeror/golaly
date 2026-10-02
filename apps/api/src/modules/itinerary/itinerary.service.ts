import { Injectable } from "@nestjs/common";
import type { CreateItemInput, DayView, ItemView, ReorderItemInput, UpdateItemInput } from "@triply/shared";
import { addDays, fromDate, MAX_TRIP_DAYS, toDate } from "../../common/dates";
import { Errors } from "../../common/http";
import { lockTrip, writeSortOrder } from "../../common/locks";
import { dayInclude, toDayView, toItemView } from "../../common/presenters";
import { PrismaService, type Tx } from "../../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications";
import { RealtimeService } from "../realtime/realtime";
import { TripAccessService } from "../trips/trip-access.service";
import { insertAt, orderByTime } from "./itinerary.logic";

@Injectable()
export class ItineraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TripAccessService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  private async dayWithTrip(dayId: string, tx: Tx = this.prisma) {
    const day = await tx.tripDay.findUnique({ where: { id: dayId } });
    if (!day) throw Errors.notFound("That day");
    return day;
  }

  private async itemWithDay(itemId: string, tx: Tx = this.prisma) {
    const item = await tx.itineraryItem.findUnique({ where: { id: itemId }, include: { day: true } });
    if (!item) throw Errors.notFound("That item (someone may have removed it)");
    return item;
  }

  private async itemView(id: string, viewerId: string) {
    const i = await this.prisma.itineraryItem.findUniqueOrThrow({ where: { id }, include: dayInclude(viewerId).items.include });
    return toItemView(i);
  }

  private async assertPlace(placeId: string | null | undefined) {
    if (placeId && !(await this.prisma.place.findUnique({ where: { id: placeId }, select: { id: true } }))) throw Errors.invalid("That place doesn't exist.");
  }

  private writeOrder(tx: Tx, ids: string[]) {
    return writeSortOrder(tx, ids);
  }

  private async touch(tx: Tx, tripId: string) {
    await tx.trip.update({ where: { id: tripId }, data: { updatedAt: new Date() } });
  }

  // ── Days ───────────────────────────────────────────────────────────────
  async days(tripId: string, viewerId: string | null): Promise<DayView[]> {
    await this.access.require("itinerary.view", tripId, viewerId);
    const days = await this.prisma.tripDay.findMany({ where: { tripId }, orderBy: { dayNumber: "asc" }, include: dayInclude(viewerId) });
    return days.map(toDayView);
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

  /** Removes a day and its items, renumbers later days and keeps dates contiguous. */
  async deleteDay(tripId: string, dayId: string, viewerId: string) {
    const trip = await this.access.require("itinerary.delete", tripId, viewerId);
    const day = await this.dayWithTrip(dayId);
    if (day.tripId !== tripId) throw Errors.notFound("That day");
    await this.prisma.transaction(async (tx) => {
      await lockTrip(tx, tripId);
      const count = await tx.tripDay.count({ where: { tripId } });
      if (count <= 1) throw Errors.invalid("A trip needs at least one day.");
      await tx.tripDay.delete({ where: { id: dayId } });
      const rest = await tx.tripDay.findMany({ where: { tripId }, orderBy: { dayNumber: "asc" } });
      // Two passes avoid violating the (trip_id, day_number) unique constraint mid-update.
      for (const [i, d] of rest.entries()) await tx.tripDay.update({ where: { id: d.id }, data: { dayNumber: 1000 + i } });
      const start = fromDate(trip.startDate);
      for (const [i, d] of rest.entries())
        await tx.tripDay.update({ where: { id: d.id }, data: { dayNumber: i + 1, date: start ? toDate(addDays(start, i)) : d.date } });
      if (start) await tx.trip.update({ where: { id: tripId }, data: { endDate: toDate(addDays(start, rest.length - 1)) } });
    });
    this.realtime.trip(tripId, viewerId, "trip.updated", dayId);
    return { ok: true };
  }

  // ── Items ──────────────────────────────────────────────────────────────
  async addItem(dayId: string, viewerId: string, input: CreateItemInput): Promise<ItemView> {
    const day = await this.dayWithTrip(dayId);
    const trip = await this.access.require("itinerary.add", day.tripId, viewerId);
    await this.assertPlace(input.placeId);
    const item = await this.prisma.transaction(async (tx) => {
      await lockTrip(tx, trip.id);
      const count = await tx.itineraryItem.count({ where: { dayId } });
      const created = await tx.itineraryItem.create({
        data: { ...input, placeId: input.type === "NOTE" ? null : input.placeId, dayId, sortOrder: count, updatedById: viewerId },
      });
      const siblings = await tx.itineraryItem.findMany({ where: { dayId } });
      await this.writeOrder(tx, orderByTime(siblings));
      await this.touch(tx, trip.id);
      await this.notifications.notify(this.access.memberIds(trip), viewerId, "TRIP_ITEM_ADDED", `added “${created.title}” to Day ${day.dayNumber} of ${trip.title}`, { tripId: trip.id }, tx);
      return created;
    });
    this.realtime.trip(trip.id, viewerId, "trip.item.created", item.id);
    return this.itemView(item.id, viewerId);
  }

  async updateItem(itemId: string, viewerId: string, input: UpdateItemInput): Promise<ItemView> {
    const item = await this.itemWithDay(itemId);
    const trip = await this.access.require("itinerary.edit", item.day.tripId, viewerId);
    await this.assertPlace(input.placeId);
    const merged = { startTime: input.startTime !== undefined ? input.startTime : item.startTime, endTime: input.endTime !== undefined ? input.endTime : item.endTime };
    if (merged.startTime && merged.endTime && merged.endTime < merged.startTime)
      throw Errors.invalid("End time should be after the start time.", { endTime: "End time should be after the start time." });
    await this.prisma.transaction(async (tx) => {
      await lockTrip(tx, trip.id);
      const updated = await tx.itineraryItem.update({
        where: { id: itemId },
        data: { ...input, ...(input.type === "NOTE" ? { placeId: null } : {}), updatedById: viewerId },
      });
      if (input.startTime !== undefined && input.startTime !== item.startTime) {
        const siblings = await tx.itineraryItem.findMany({ where: { dayId: updated.dayId } });
        await this.writeOrder(tx, orderByTime(siblings));
      }
      await this.touch(tx, trip.id);
      await this.notifications.notify(this.access.memberIds(trip), viewerId, "TRIP_ITEM_UPDATED", `updated “${updated.title}” in ${trip.title}`, { tripId: trip.id }, tx);
    });
    this.realtime.trip(trip.id, viewerId, "trip.item.updated", itemId);
    return this.itemView(itemId, viewerId);
  }

  async deleteItem(itemId: string, viewerId: string) {
    const item = await this.itemWithDay(itemId);
    const trip = await this.access.require("itinerary.delete", item.day.tripId, viewerId);
    await this.prisma.transaction(async (tx) => {
      await lockTrip(tx, trip.id);
      // Re-read under the lock: the item may have moved to another day (or gone) meanwhile.
      const cur = await tx.itineraryItem.findUnique({ where: { id: itemId }, select: { dayId: true } });
      if (!cur) throw Errors.notFound("That item (someone may have removed it)");
      await tx.itineraryItem.delete({ where: { id: itemId } });
      const rest = await tx.itineraryItem.findMany({ where: { dayId: cur.dayId }, orderBy: { sortOrder: "asc" } });
      await this.writeOrder(tx, rest.map((r) => r.id));
      await this.touch(tx, trip.id);
    });
    this.realtime.trip(trip.id, viewerId, "trip.item.deleted", itemId);
    return { ok: true };
  }

  async duplicateItem(itemId: string, viewerId: string): Promise<ItemView> {
    const item = await this.itemWithDay(itemId);
    const trip = await this.access.require("itinerary.add", item.day.tripId, viewerId);
    const copy = await this.prisma.transaction(async (tx) => {
      await lockTrip(tx, trip.id);
      const cur = await this.itemWithDay(itemId, tx);
      const ids = (await tx.itineraryItem.findMany({ where: { dayId: cur.dayId }, orderBy: { sortOrder: "asc" } })).map((i) => i.id);
      const created = await tx.itineraryItem.create({
        data: {
          dayId: cur.dayId,
          type: item.type,
          title: `${item.title} (copy)`,
          description: item.description,
          placeId: item.placeId,
          startTime: item.startTime,
          endTime: item.endTime,
          notes: item.notes,
          sortOrder: ids.length,
          updatedById: viewerId,
        },
      });
      await this.writeOrder(tx, insertAt(ids, created.id, ids.indexOf(itemId) + 1));
      await this.touch(tx, trip.id);
      return created;
    });
    this.realtime.trip(trip.id, viewerId, "trip.item.created", copy.id);
    return this.itemView(copy.id, viewerId);
  }

  /** POST /items/:id/reorder — move within a day or to another day of the same trip. */
  async reorder(itemId: string, viewerId: string, to: ReorderItemInput) {
    const item = await this.itemWithDay(itemId);
    const trip = await this.access.require("itinerary.reorder", item.day.tripId, viewerId);
    const target = await this.dayWithTrip(to.dayId);
    if (target.tripId !== trip.id) throw Errors.invalid("Items can only move within the same trip.");
    await this.prisma.transaction(async (tx) => {
      // Under the trip lock, read the item's CURRENT day and the target day's CURRENT list, and
      // change dayId only on the moved item: a concurrent move by someone else is never undone.
      await lockTrip(tx, trip.id);
      const cur = await tx.itineraryItem.findUnique({ where: { id: itemId }, select: { dayId: true } });
      if (!cur) throw Errors.notFound("That item (someone may have removed it)");
      await tx.itineraryItem.update({ where: { id: itemId }, data: { dayId: to.dayId, updatedById: viewerId } });
      const targetIds = (await tx.itineraryItem.findMany({ where: { dayId: to.dayId }, orderBy: { sortOrder: "asc" } })).map((i) => i.id);
      await this.writeOrder(tx, insertAt(targetIds, itemId, to.index));
      if (cur.dayId !== to.dayId) {
        const rest = await tx.itineraryItem.findMany({ where: { dayId: cur.dayId }, orderBy: { sortOrder: "asc" } });
        await this.writeOrder(tx, rest.map((r) => r.id));
      }
      await this.touch(tx, trip.id);
    });
    this.realtime.trip(trip.id, viewerId, "trip.item.reordered", itemId);
    return { ok: true };
  }
}
