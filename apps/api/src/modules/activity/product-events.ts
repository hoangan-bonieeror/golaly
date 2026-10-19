import { Global, Injectable, Logger, Module } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";
import { afterCommit, PrismaService } from "../../prisma/prisma.service";

/** What someone did outside a trip's plan (plan changes are trip_events). Facts only — never text, names or e-mails. */
export type ProductEventType =
  | "user.registered"
  | "user.login"
  | "trip.created"
  | "trip.forked"
  | "trip.published"
  | "invite.accepted"
  | "post.created"
  /** A member opened the trip (its page, or "where to now?") while it was under way. Once a day per person and trip. */
  | "trip.opened_on_trip";

export interface ProductEventInput {
  type: ProductEventType;
  userId: string | null;
  tripId?: string | null;
  props?: Record<string, string | number | boolean | null>;
}

/**
 * Product analytics events (admin dashboard, phase 2). Best-effort and out of band: recorded after the
 * surrounding transaction commits (so a rolled-back action leaves no event) and never failing the request
 * that caused it. The nightly analytics pipeline (dbt, `analytics/`) turns them into aggregate marts.
 */
const DAY_MS = 86_400_000;
/** Bound on the per-instance "already recorded today" keys. */
const MAX_SEEN = 50_000;

@Injectable()
export class ProductEventsService {
  private readonly log = new Logger("ProductEvents");
  private readonly seenOnTrip = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  track(e: ProductEventInput) {
    afterCommit(() => {
      this.prisma.productEvent
        .create({ data: { type: e.type, userId: e.userId, tripId: e.tripId ?? null, props: (e.props ?? {}) as Prisma.InputJsonValue } })
        .catch((err: Error) => this.log.warn(`couldn't record ${e.type}: ${err.message}`));
    });
  }

  /**
   * Records `trip.opened_on_trip` when a member opens a trip while it is under way: the signal for "do groups use
   * TRIPLY during the trip, not only to plan it". Trip dates have no time zone, so a day on either side counts
   * (the API runs in UTC). At most once per person, trip and UTC day per instance; analytics count distinct days.
   */
  openedOnTrip(userId: string | null, trip: { id: string; startDate: Date | null; endDate: Date | null; members: { userId: string }[] }, now = new Date()) {
    if (!userId || !trip.startDate || !trip.members.some((m) => m.userId === userId)) return;
    const day = now.toISOString().slice(0, 10);
    const today = Date.parse(`${day}T00:00:00Z`);
    const start = trip.startDate.getTime() - DAY_MS;
    const end = (trip.endDate ?? trip.startDate).getTime() + DAY_MS;
    if (today < start || today > end) return;
    const key = `${userId}:${trip.id}:${day}`;
    if (this.seenOnTrip.has(key)) return;
    if (this.seenOnTrip.size >= MAX_SEEN) this.seenOnTrip.clear();
    this.seenOnTrip.add(key);
    this.track({ type: "trip.opened_on_trip", userId, tripId: trip.id });
  }
}

@Global()
@Module({ providers: [ProductEventsService], exports: [ProductEventsService] })
export class ProductEventsModule {}
