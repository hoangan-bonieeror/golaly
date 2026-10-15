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
  | "post.created";

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
@Injectable()
export class ProductEventsService {
  private readonly log = new Logger("ProductEvents");

  constructor(private readonly prisma: PrismaService) {}

  track(e: ProductEventInput) {
    afterCommit(() => {
      this.prisma.productEvent
        .create({ data: { type: e.type, userId: e.userId, tripId: e.tripId ?? null, props: (e.props ?? {}) as Prisma.InputJsonValue } })
        .catch((err: Error) => this.log.warn(`couldn't record ${e.type}: ${err.message}`));
    });
  }
}

@Global()
@Module({ providers: [ProductEventsService], exports: [ProductEventsService] })
export class ProductEventsModule {}
