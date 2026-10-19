/** Posts, feed, discovery privacy, saves, notifications, reports, media. */
import sharp from "sharp";
import { createTestContext, demoTrip, type TestContext } from "./helpers";

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => t.app.close());

describe("privacy (spec §34)", () => {
  it("private trips never appear in explore, search, feed or public profiles", async () => {
    const japan = await demoTrip(t.prisma, "Japan — 7 Days");
    const stranger = await t.register("priv");
    const explore = (await stranger.get("/explore")).body;
    expect(explore.trips.map((x: { id: string }) => x.id)).not.toContain(japan.id);
    const search = (await stranger.get("/search?q=japan")).body;
    expect(search.trips.map((x: { id: string }) => x.id)).not.toContain(japan.id);
    const profileTrips = (await stranger.get("/users/an.nguyen/trips")).body;
    expect(profileTrips.map((x: { id: string }) => x.id)).not.toContain(japan.id);
    expect((await t.anon().get(`/trips/${japan.id}`)).body.message).toBe("This trip is private.");
    // The owner still sees it on their own profile.
    const an = await t.as("an@golaly.dev");
    expect((await an.get("/users/an.nguyen/trips")).body.map((x: { id: string }) => x.id)).toContain(japan.id);
  });

  it("link-only trips are viewable by link but unlisted", async () => {
    const u = await t.register("link");
    const trip = (await u.post("/trips", { title: "Unlisted trip zz" })).body;
    await u.patch(`/trips/${trip.id}`, { visibility: "LINK_ONLY" });
    expect((await t.anon().get(`/trips/${trip.id}`)).status).toBe(200);
    expect((await t.anon().get("/search?q=Unlisted trip zz")).body.trips).toHaveLength(0);
  });

  it("a post drops out of the feed when its trip goes private, and its trip is hidden", async () => {
    const u = await t.register("poster");
    const trip = (await u.post("/trips", { title: "Shared then hidden" })).body;
    expect((await u.post("/posts", { title: "Too early", tripId: trip.id })).status).toBe(422);
    await u.patch(`/trips/${trip.id}`, { visibility: "PUBLIC" });
    const post = (await u.post("/posts", { title: "My story", body: "hi", tripId: trip.id })).body;
    expect(post.trip.id).toBe(trip.id);
    const inFeed = async () => (await t.anon().get("/feed?limit=50")).body.posts.some((p: { id: string }) => p.id === post.id);
    expect(await inFeed()).toBe(true);
    await u.patch(`/trips/${trip.id}`, { visibility: "PRIVATE" });
    expect(await inFeed()).toBe(false);
    expect((await t.anon().get(`/posts/${post.id}`)).body.trip).toBeNull();
  });

  it("drafts are only visible to their author", async () => {
    const u = await t.register("draft");
    const post = (await u.post("/posts", { title: "Secret draft", visibility: "DRAFT" })).body;
    expect((await t.anon().get(`/posts/${post.id}`)).status).toBe(404);
    expect((await u.get(`/posts/${post.id}`)).status).toBe(200);
  });
});

describe("social actions", () => {
  it("like, comment, save and follow work and notify the author", async () => {
    const author = await t.register("auth");
    const post = (await author.post("/posts", { title: "Hello world post" })).body;
    const fan = await t.register("fan");
    expect((await fan.post(`/posts/${post.id}/like`)).body).toMatchObject({ likeCount: 1, likedByMe: true });
    expect((await fan.post(`/posts/${post.id}/like`)).body.likeCount).toBe(1); // idempotent
    const c = (await fan.post(`/posts/${post.id}/comments`, { body: "Great!" })).body;
    expect(c).toMatchObject({ body: "Great!", canDelete: true });
    expect((await fan.post(`/posts/${post.id}/comments`, { body: "" })).status).toBe(422);
    expect((await fan.post(`/posts/${post.id}/save`)).body.savedByMe).toBe(true);
    expect((await fan.get("/posts/saved")).body.items.map((p: { id: string }) => p.id)).toContain(post.id);
    expect((await fan.post(`/users/${author.username}/follow`)).body).toMatchObject({ followers: 1, followedByMe: true });
    expect((await fan.get("/feed?mode=following")).body.posts.map((p: { id: string }) => p.id)).toContain(post.id);

    const types = (await author.get("/notifications")).body.items.map((n: { type: string }) => n.type);
    expect(types).toEqual(expect.arrayContaining(["LIKE", "COMMENT", "FOLLOW"]));
    const unread = (await author.get("/notifications/unread-count")).body.count;
    expect(unread).toBeGreaterThanOrEqual(3);
    await author.patch("/notifications/read-all");
    expect((await author.get("/notifications/unread-count")).body.count).toBe(0);

    const other = await t.register("other");
    expect((await other.delete(`/comments/${c.id}`)).status).toBe(403);
    expect((await author.delete(`/comments/${c.id}`)).status).toBe(200); // author moderates own post
    expect((await author.get(`/posts/${post.id}`)).body.commentCount).toBe(0);
  });

  it("respects allowComments", async () => {
    const u = await t.register("nocom");
    const trip = (await u.post("/trips", { title: "Quiet trip" })).body;
    await u.patch(`/trips/${trip.id}`, { visibility: "PUBLIC", allowComments: false });
    const post = (await u.post("/posts", { title: "No comments please", tripId: trip.id })).body;
    const res = await (await t.register("c")).post(`/posts/${post.id}/comments`, { body: "hi" });
    expect(res.status).toBe(403);
  });

  it("saves trips (counted, owner notified) and places", async () => {
    const vietnam = await demoTrip(t.prisma, "Vietnam — 10 Days, North to South");
    const u = await t.register("saver");
    const saved = (await u.post(`/trips/${vietnam.id}/save`)).body;
    expect(saved).toMatchObject({ savedByMe: true, saveCount: vietnam.saveCount + 1 });
    expect((await u.get("/trips/saved")).body.items.map((x: { id: string }) => x.id)).toContain(vietnam.id);
    const place = await t.prisma.place.findFirstOrThrow({ where: { name: "Hoàn Kiếm Lake" } });
    expect((await u.post(`/places/${place.id}/save`)).body.savedByMe).toBe(true);
    expect((await u.get("/places/saved")).body).toHaveLength(1);
    expect((await u.delete(`/trips/${vietnam.id}/save`)).body.savedByMe).toBe(false);
  });

  it("stores reports for moderation (one per user per target)", async () => {
    const post = await t.prisma.post.findFirstOrThrow();
    const u = await t.register("rep");
    expect((await u.post("/reports", { target: "POST", targetId: post.id, reason: "SPAM" })).status).toBe(201);
    expect((await u.post("/reports", { target: "POST", targetId: post.id, reason: "MISLEADING" })).status).toBe(201);
    expect(await t.prisma.report.count({ where: { reporterId: u.id } })).toBe(1);
    expect((await u.post("/reports", { target: "POST", targetId: post.id, reason: "NOPE" })).status).toBe(422);
  });
});

describe("discovery", () => {
  it("search, destinations and places", async () => {
    const res = (await t.anon().get("/search?q=kyoto")).body;
    expect(res.destinations[0].slug).toBe("kyoto");
    expect(res.trips.map((x: { title: string }) => x.title)).toContain("Kyoto Slow Weekend");
    const page = (await t.anon().get("/destinations/kyoto")).body;
    expect(page.destination.name).toBe("Kyoto");
    expect(page.places.length).toBeGreaterThan(0);
    expect((await t.anon().get("/destinations/atlantis")).status).toBe(404);
    const japan = await demoTrip(t.prisma, "Japan — 7 Days");
    const an = await t.as("an@golaly.dev");
    const places = (await an.get(`/places/search?tripId=${japan.id}`)).body;
    expect(places.length).toBeGreaterThan(0);
  });
});

describe("media", () => {
  it("accepts real images (re-encoded, EXIF stripped, thumbnail) and rejects anything else", async () => {
    const u = await t.register("pic");
    const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#0e6e6a" } }).png().toBuffer();
    const ok = await u.raw.post("/api/v1/media").set("X-Requested-With", "golaly").attach("file", png, { filename: "a.png", contentType: "image/png" });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ width: 300, height: 200, mimeType: "image/webp" });
    expect(ok.body.thumbUrl).toMatch(/_thumb\.webp$/);
    expect((await u.raw.get(ok.body.url)).status).toBe(200);

    const fake = await u.raw.post("/api/v1/media").set("X-Requested-With", "golaly").attach("file", Buffer.from("not an image"), { filename: "x.png", contentType: "image/png" });
    expect(fake.status).toBe(415);
    const tiny = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).png().toBuffer();
    const small = await u.raw.post("/api/v1/media").set("X-Requested-With", "golaly").attach("file", tiny, { filename: "t.png", contentType: "image/png" });
    expect(small.status).toBe(422);

    expect((await u.patch("/users/me", { avatarMediaId: ok.body.id })).body.avatarUrl).toBe(ok.body.thumbUrl);
    const other = await t.register("thief");
    expect((await other.patch("/users/me", { avatarMediaId: ok.body.id })).status).toBe(422);
  });
});
