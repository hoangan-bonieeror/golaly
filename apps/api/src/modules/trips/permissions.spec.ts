/**
 * Permission service (spec §43 unit): the shared Owner/Editor/Viewer matrix and the
 * TripAccessService that enforces it with friendly errors.
 */
import { can, type PermissionMember, type PermissionTrip, type TripAction } from "@triply/shared";
import { AppError } from "../../common/http";
import { TripAccessService } from "./trip-access.service";

const OWNER = "11111111-1111-4111-a111-111111111111";
const EDITOR = "22222222-2222-4222-a222-222222222222";
const VIEWER = "33333333-3333-4333-a333-333333333333";
const STRANGER = "44444444-4444-4444-a444-444444444444";
const TRIP = "55555555-5555-4555-a555-555555555555";

function trip(over: Partial<PermissionTrip & { members: PermissionMember[] }> = {}): PermissionTrip & { members: PermissionMember[] } {
  return {
    id: TRIP,
    ownerId: OWNER,
    visibility: "PRIVATE",
    allowFork: true,
    deletedAt: null,
    members: [
      { tripId: TRIP, userId: OWNER, role: "OWNER" },
      { tripId: TRIP, userId: EDITOR, role: "EDITOR" },
      { tripId: TRIP, userId: VIEWER, role: "VIEWER" },
    ],
    ...over,
  };
}
const check = (action: TripAction, userId: string | null, t = trip()) => can(action, { trip: t, members: t.members, userId });

describe("permission matrix", () => {
  it("owner can do everything except fork their own trip", () => {
    for (const a of ["trip.delete", "trip.change_visibility", "members.invite", "members.change_role", "members.remove", "itinerary.edit"] as TripAction[])
      expect(check(a, OWNER)).toBe(true);
    expect(check("trip.fork", OWNER, trip({ visibility: "PUBLIC" }))).toBe(false);
  });

  it("editor can change the itinerary but not the trip or its people", () => {
    for (const a of ["itinerary.add", "itinerary.edit", "itinerary.delete", "itinerary.reorder", "trip.view"] as TripAction[]) expect(check(a, EDITOR)).toBe(true);
    for (const a of ["trip.delete", "trip.change_visibility", "trip.edit_details", "members.invite", "members.change_role", "members.remove"] as TripAction[])
      expect(check(a, EDITOR)).toBe(false);
  });

  it("viewer can only look", () => {
    expect(check("trip.view", VIEWER)).toBe(true);
    // Voting on ideas is participation, not editing: viewers may.
    expect(check("itinerary.vote", VIEWER)).toBe(true);
    for (const a of ["itinerary.add", "itinerary.edit", "itinerary.delete", "itinerary.reorder", "members.invite"] as TripAction[]) expect(check(a, VIEWER)).toBe(false);
  });

  it("private trips are invisible to strangers and anonymous users", () => {
    expect(check("trip.view", STRANGER)).toBe(false);
    expect(check("trip.view", null)).toBe(false);
  });

  it("public and link-only trips are view-only for strangers", () => {
    for (const visibility of ["PUBLIC", "LINK_ONLY"] as const) {
      const t = trip({ visibility });
      expect(check("trip.view", STRANGER, t)).toBe(true);
      expect(check("itinerary.edit", STRANGER, t)).toBe(false);
      expect(check("itinerary.vote", STRANGER, t)).toBe(false);
    }
  });

  it("only PUBLIC trips with remix enabled can be forked, and only by signed-in users", () => {
    expect(check("trip.fork", STRANGER, trip({ visibility: "PUBLIC" }))).toBe(true);
    expect(check("trip.fork", STRANGER, trip({ visibility: "LINK_ONLY" }))).toBe(false);
    expect(check("trip.fork", STRANGER, trip({ visibility: "PUBLIC", allowFork: false }))).toBe(false);
    expect(check("trip.fork", null, trip({ visibility: "PUBLIC" }))).toBe(false);
  });

  it("deleted trips deny everything", () => {
    expect(check("trip.view", OWNER, trip({ deletedAt: new Date() }))).toBe(false);
  });

  it("a role claimed by the client is irrelevant — only the members list counts", () => {
    const t = trip({ members: [{ tripId: TRIP, userId: OWNER, role: "OWNER" }] });
    expect(check("itinerary.edit", EDITOR, t)).toBe(false);
  });
});

describe("TripAccessService.assert", () => {
  const svc = new TripAccessService({} as never);
  const asAccess = (t: ReturnType<typeof trip>) => t as never;
  const statusOf = (fn: () => void) => {
    try {
      fn();
      return 200;
    } catch (e) {
      return (e as AppError).getStatus();
    }
  };
  const messageOf = (fn: () => void) => {
    try {
      fn();
      return "";
    } catch (e) {
      return ((e as AppError).getResponse() as { message: string }).message;
    }
  };

  it("hides private trips behind 'This trip is private.'", () => {
    expect(messageOf(() => svc.assert("itinerary.edit", asAccess(trip()), STRANGER))).toBe("This trip is private.");
  });

  it("tells editors that owner-only actions are owner-only", () => {
    expect(messageOf(() => svc.assert("trip.delete", asAccess(trip()), EDITOR))).toBe("Only the trip owner can do that.");
  });

  it("returns the friendly edit message for viewers", () => {
    expect(messageOf(() => svc.assert("itinerary.edit", asAccess(trip()), VIEWER))).toBe("You no longer have permission to edit this trip.");
  });

  it("asks anonymous users to log in before writes", () => {
    expect(statusOf(() => svc.assert("itinerary.add", asAccess(trip({ visibility: "PUBLIC" })), null))).toBe(401);
  });

  it("lists exactly the permitted actions", () => {
    const perms = svc.permissions(asAccess(trip()), VIEWER);
    expect(perms).toEqual(["trip.view", "itinerary.view", "itinerary.vote", "members.view"]);
  });
});
