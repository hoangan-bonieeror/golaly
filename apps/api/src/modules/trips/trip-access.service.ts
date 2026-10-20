import { Injectable } from "@nestjs/common";
import { can, type TripAction } from "@golaly/shared";
import { AppError, Errors } from "../../common/http";
import { PrismaService, type Tx } from "../../prisma/prisma.service";

const ALL_ACTIONS: TripAction[] = [
  "trip.view",
  "trip.edit_details",
  "trip.delete",
  "trip.change_visibility",
  "trip.fork",
  "itinerary.view",
  "itinerary.add",
  "itinerary.edit",
  "itinerary.delete",
  "itinerary.reorder",
  "itinerary.vote",
  "itinerary.photo",
  "expenses.manage",
  "members.view",
  "members.invite",
  "members.change_role",
  "members.remove",
];

const OWNER_ONLY: TripAction[] = ["trip.delete", "trip.change_visibility", "trip.edit_details", "members.invite", "members.change_role", "members.remove"];

export type AccessTrip = Awaited<ReturnType<TripAccessService["load"]>>;

/**
 * The one place trip authorization happens (spec §28): authentication → trip exists →
 * membership → role → specific permission. Uses the same `can()` matrix as the web app,
 * but always with roles read from the database — never from the request.
 */
@Injectable()
export class TripAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async load(tripId: string, tx: Tx = this.prisma) {
    const trip = await tx.trip.findFirst({ where: { id: tripId, deletedAt: null }, include: { members: true } });
    if (!trip) throw Errors.notFound("That trip");
    return trip;
  }

  can(action: TripAction, trip: AccessTrip, viewerId: string | null) {
    return can(action, { trip, members: trip.members, userId: viewerId });
  }

  permissions(trip: AccessTrip, viewerId: string | null): TripAction[] {
    return ALL_ACTIONS.filter((a) => this.can(a, trip, viewerId));
  }

  assert(action: TripAction, trip: AccessTrip, viewerId: string | null) {
    if (this.can(action, trip, viewerId)) return;
    if (!viewerId && action !== "trip.view" && action !== "itinerary.view") throw Errors.unauthorized();
    if (!this.can("trip.view", trip, viewerId)) throw new AppError(403, "This trip is private.");
    if (action === "trip.fork") {
      if (trip.ownerId === viewerId) throw Errors.invalid("This is already your trip.");
      throw new AppError(403, trip.allowFork ? "Only public trips can be remixed." : "The creator hasn't allowed remixing this trip.");
    }
    if (OWNER_ONLY.includes(action)) throw new AppError(403, "Only the trip owner can do that.");
    throw Errors.forbidden();
  }

  /** Load + assert in one step. */
  async require(action: TripAction, tripId: string, viewerId: string | null, tx: Tx = this.prisma) {
    const trip = await this.load(tripId, tx);
    this.assert(action, trip, viewerId);
    return trip;
  }

  memberIds(trip: AccessTrip) {
    return trip.members.map((m) => m.userId);
  }
}
