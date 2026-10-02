/** Invitation service, member roles and fork service. */
import { io, type Socket } from "socket.io-client";
import type { AddressInfo } from "node:net";
import { createTestContext, demoTrip, type TestContext } from "./helpers";

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => t.app.close());

async function tripWithEditor() {
  const owner = await t.register("own");
  const trip = (await owner.post("/trips", { title: "Collab", startDate: "2027-06-01", endDate: "2027-06-02" })).body;
  const day = (await owner.get(`/trips/${trip.id}`)).body.days[0];
  return { owner, trip, day };
}

describe("invitations", () => {
  it("link invites: token works for anyone until revoked, never exposes ids, and is stored hashed", async () => {
    const { owner, trip } = await tripWithEditor();
    const inv = (await owner.post(`/trips/${trip.id}/invitations`, { role: "VIEWER" })).body;
    expect(inv.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(inv.url).toContain(`/invite/${inv.token}`);
    expect(inv.token).not.toContain(trip.id);
    const row = await t.prisma.tripInvitation.findUniqueOrThrow({ where: { id: inv.id } });
    expect(JSON.stringify(row)).not.toContain(inv.token);

    const lookup = (await t.anon().get(`/invitations/${inv.token}`)).body;
    expect(lookup).toMatchObject({ status: "valid", role: "VIEWER", trip: { title: "Collab" } });

    const a = await t.register("a");
    expect((await a.post(`/invitations/${inv.token}/accept`)).body).toEqual({ tripId: trip.id });
    const b = await t.register("b");
    expect((await b.post(`/invitations/${inv.token}/accept`)).status).toBe(200);

    await owner.delete(`/trips/${trip.id}/invitations/${inv.id}`);
    const c = await t.register("c");
    const revoked = await c.post(`/invitations/${inv.token}/accept`);
    expect(revoked.status).toBe(422);
    expect(revoked.body.message).toBe("This invitation was cancelled by the trip owner.");
  });

  it("email invites are bound to that email, notify existing users, and are single-use", async () => {
    const { owner, trip } = await tripWithEditor();
    const invitee = await t.register("inv");
    const inv = (await owner.post(`/trips/${trip.id}/invitations`, { email: invitee.email, role: "EDITOR" })).body;
    expect((await owner.post(`/trips/${trip.id}/invitations`, { email: invitee.email, role: "EDITOR" })).status).toBe(409);

    const note = (await invitee.get("/notifications")).body.items[0];
    expect(note).toMatchObject({ type: "TRIP_INVITE", invitationId: inv.id });

    const stranger = await t.register("str");
    expect((await stranger.post(`/invitations/id/${inv.id}/accept`)).status).toBe(403);
    expect((await stranger.post(`/invitations/${inv.token}/accept`)).status).toBe(403);

    expect((await invitee.post(`/invitations/id/${inv.id}/accept`)).status).toBe(200);
    expect((await invitee.get(`/trips/${trip.id}`)).body.myRole).toBe("EDITOR");
    expect((await invitee.post(`/invitations/${inv.token}/accept`)).status).toBe(422);
  });

  it("expired invitations are rejected with a friendly message", async () => {
    const { owner, trip } = await tripWithEditor();
    const inv = (await owner.post(`/trips/${trip.id}/invitations`, { role: "VIEWER" })).body;
    await t.prisma.tripInvitation.update({ where: { id: inv.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const u = await t.register("late");
    expect((await t.anon().get(`/invitations/${inv.token}`)).body).toEqual({ status: "expired" });
    const res = await u.post(`/invitations/${inv.token}/accept`);
    expect(res.body.message).toBe("This invitation has expired.");
  });

  it("only the owner can invite", async () => {
    const { owner, trip } = await tripWithEditor();
    const inv = (await owner.post(`/trips/${trip.id}/invitations`, { role: "EDITOR" })).body;
    const editor = await t.register("ed");
    await editor.post(`/invitations/${inv.token}/accept`);
    expect((await editor.post(`/trips/${trip.id}/invitations`, { role: "VIEWER" })).status).toBe(403);
  });
});

describe("roles", () => {
  it("viewer can't edit; owner promotes to editor; editor edits; owner removes; removed user loses access", async () => {
    const { owner, trip, day } = await tripWithEditor();
    const inv = (await owner.post(`/trips/${trip.id}/invitations`, { role: "VIEWER" })).body;
    const member = await t.register("mem");
    await member.post(`/invitations/${inv.token}/accept`);

    const denied = await member.post(`/days/${day.id}/items`, { type: "NOTE", title: "Sneaky" });
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe("You no longer have permission to edit this trip.");

    const members = (await owner.patch(`/trips/${trip.id}/members/${member.id}`, { role: "EDITOR" })).body;
    expect(members.find((m: { user: { id: string } }) => m.user.id === member.id).role).toBe("EDITOR");
    expect((await member.get("/notifications")).body.items[0].type).toBe("TRIP_MEMBER_ROLE_CHANGED");

    const item = await member.post(`/days/${day.id}/items`, { type: "NOTE", title: "Allowed now" });
    expect(item.status).toBe(201);
    expect(item.body.updatedBy.id).toBe(member.id);

    // Editors can't manage people, and nobody can demote/remove the owner.
    expect((await member.patch(`/trips/${trip.id}/members/${owner.id}`, { role: "VIEWER" })).status).toBe(403);
    expect((await owner.patch(`/trips/${trip.id}/members/${member.id}`, { role: "OWNER" })).status).toBe(422);
    expect((await owner.delete(`/trips/${trip.id}/members/${owner.id}`)).status).toBe(422);

    expect((await owner.delete(`/trips/${trip.id}/members/${member.id}`)).status).toBe(200);
    expect((await member.get(`/trips/${trip.id}`)).status).toBe(403);
    const audit = await t.prisma.auditLog.findMany({ where: { entityId: trip.id } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["trip.member.role_changed", "trip.member.removed"]));
  });

  it("members can leave on their own", async () => {
    const { owner, trip } = await tripWithEditor();
    const inv = (await owner.post(`/trips/${trip.id}/invitations`, { role: "VIEWER" })).body;
    const m = await t.register("leave");
    await m.post(`/invitations/${inv.token}/accept`);
    expect((await m.delete(`/trips/${trip.id}/members/${m.id}`)).status).toBe(200);
    expect((await m.get("/trips")).body.find((x: { id: string }) => x.id === trip.id)).toBeUndefined();
  });

  it("public viewers don't see the private member list", async () => {
    const vietnam = await demoTrip(t.prisma, "Vietnam — 10 Days, North to South");
    const japan = await demoTrip(t.prisma, "Japan — 7 Days");
    await t.prisma.trip.update({ where: { id: japan.id }, data: { visibility: "PUBLIC" } });
    const stranger = await t.register("peek");
    const detail = (await stranger.get(`/trips/${japan.id}`)).body;
    expect(detail.members).toHaveLength(1);
    expect(detail.members[0].role).toBe("OWNER");
    expect(detail.pendingInvitations).toBeUndefined();
    expect((await stranger.get(`/trips/${japan.id}/members`)).status).toBe(403);
    await t.prisma.trip.update({ where: { id: japan.id }, data: { visibility: "PRIVATE" } });
    expect(vietnam).toBeTruthy();
  });
});

describe("fork", () => {
  it("copies itinerary, not people; new owner; private; attributed; source unchanged", async () => {
    const source = await demoTrip(t.prisma, "Vietnam — 10 Days, North to South");
    const before = await t.prisma.trip.findUniqueOrThrow({ where: { id: source.id }, include: { members: true, days: { include: { items: true } } } });
    const forker = await t.register("fork");
    const fork = (await forker.post(`/trips/${source.id}/fork`)).body;
    expect(fork).toMatchObject({
      visibility: "PRIVATE",
      myRole: "OWNER",
      owner: { id: forker.id },
      forkedFrom: { tripId: source.id, title: source.title, ownerUsername: "sarahwanders" },
      stats: { days: before.days.length, items: before.days.flatMap((d) => d.items).length, travelers: 1 },
    });
    const forkRow = await t.prisma.trip.findUniqueOrThrow({ where: { id: fork.id }, include: { members: true, invitations: true, posts: true } });
    expect(forkRow.members).toEqual([expect.objectContaining({ userId: forker.id, role: "OWNER" })]);
    expect(forkRow.invitations).toHaveLength(0);
    expect(forkRow.posts).toHaveLength(0);

    // Editing the fork never touches the source.
    const forkDay = (await forker.get(`/trips/${fork.id}`)).body.days[0];
    await forker.delete(`/items/${forkDay.items[0].id}`);
    await forker.patch(`/trips/${fork.id}`, { title: "My Vietnam" });
    const after = await t.prisma.trip.findUniqueOrThrow({ where: { id: source.id }, include: { members: true, days: { include: { items: true } } } });
    expect(after.title).toBe(before.title);
    expect(after.members).toEqual(before.members);
    expect(after.days.flatMap((d) => d.items).length).toBe(before.days.flatMap((d) => d.items).length);
    expect(after.forkCount).toBe(before.forkCount + 1);

    const sarah = await t.as("sarah@triply.dev");
    expect((await sarah.get("/notifications")).body.items.some((n: { type: string }) => n.type === "TRIP_FORKED")).toBe(true);
  });

  it("refuses private, link-only, no-remix and own trips", async () => {
    const japan = await demoTrip(t.prisma, "Japan — 7 Days");
    const portugal = await demoTrip(t.prisma, "Lisbon & Porto in 5 Days"); // allowFork: false
    const u = await t.register("nofork");
    expect((await u.post(`/trips/${japan.id}/fork`)).status).toBe(403);
    const pt = await u.post(`/trips/${portugal.id}/fork`);
    expect(pt.status).toBe(403);
    expect(pt.body.message).toBe("The creator hasn't allowed remixing this trip.");
    const an = await t.as("an@triply.dev");
    expect((await an.post(`/trips/${japan.id}/fork`)).status).toBe(422);
    expect((await t.anon().post(`/trips/${portugal.id}/fork`)).status).toBe(401);
  });
});

describe("realtime", () => {
  it("delivers item events to members in the trip room and refuses strangers", async () => {
    const { owner, trip, day } = await tripWithEditor();
    await t.app.listen(0);
    const port = (t.app.getHttpServer().address() as AddressInfo).port;
    const connect = (cookie: string) =>
      new Promise<Socket>((resolve, reject) => {
        const s = io(`http://localhost:${port}`, { path: "/socket.io", transports: ["websocket"], extraHeaders: { cookie } });
        s.on("connect", () => resolve(s));
        s.on("connect_error", reject);
      });
    const ownerSock = await connect(owner.cookies());
    expect(await ownerSock.emitWithAck("trip.join", { tripId: trip.id })).toEqual({ ok: true });

    const stranger = await t.register("rt");
    const strangerSock = await connect(stranger.cookies());
    expect(await strangerSock.emitWithAck("trip.join", { tripId: trip.id })).toEqual({ ok: false });

    const event = new Promise((resolve) => ownerSock.on("trip.event", resolve));
    const item = (await owner.post(`/days/${day.id}/items`, { type: "NOTE", title: "Realtime!" })).body;
    await expect(event).resolves.toMatchObject({ tripId: trip.id, event: "trip.item.created", entityId: item.id, actorId: owner.id });
    ownerSock.close();
    strangerSock.close();
  });
});
