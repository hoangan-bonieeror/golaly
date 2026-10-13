import { Global, Injectable, Module } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService, type Tx } from "../../prisma/prisma.service";

/** What happened on a trip's plan. Facts only (ids, slots, levels, day numbers) — never free text. */
export type TripEventType =
  | "item.added"
  | "item.pooled"
  | "item.updated"
  | "item.moved"
  | "item.deleted"
  | "item.status"
  | "item.voted"
  | "item.unvoted"
  | "member.dates";

export interface TripEventInput {
  tripId: string;
  actorId: string | null;
  type: TripEventType;
  itemId?: string | null;
  placeId?: string | null;
  payload?: Record<string, string | number | boolean | null>;
}

/**
 * The append-only activity log (`trip_events`, roadmap phase 0): the behavioural record that
 * future planning suggestions learn from. Written inside the caller's transaction, so an event
 * exists exactly when its change does. Rows are only ever inserted. Whether a user's events may be
 * used for analytics is their `analytics_consent`, checked by whatever exports them — not here.
 */
@Injectable()
export class TripEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async log(e: TripEventInput, tx: Tx = this.prisma) {
    await tx.tripEvent.create({
      data: { tripId: e.tripId, actorId: e.actorId, type: e.type, itemId: e.itemId ?? null, placeId: e.placeId ?? null, payload: (e.payload ?? {}) as Prisma.InputJsonValue },
    });
  }
}

@Global()
@Module({ providers: [TripEventsService], exports: [TripEventsService] })
export class TripEventsModule {}
