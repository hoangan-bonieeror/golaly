/** Place photos: user uploads (trust + review), sharing from posts, reports, moderation, and the import ingester. */
import type { ModerationPhoto, Paged, PlaceBrowse, PlaceDetail, PlacePhotoView } from "@triply/shared";
import sharp from "sharp";
import { seedId } from "../prisma/seed-data/ids";
import { PhotoIngestService } from "../src/modules/places/photos";
import { createTestContext, type Agent, type TestContext } from "./helpers";

let t: TestContext;
beforeAll(async () => (t = await createTestContext()));
afterAll(() => t.app.close());

const place = (key: string) => seedId(`place:${key}`);
const jpeg = (color: string, w = 800, h = 600) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer();
async function upload(a: Agent, color = "#a4471f"): Promise<string> {
  const res = await a.raw.post("/api/v1/media").set("X-Requested-With", "triply").attach("file", await jpeg(color), { filename: "p.jpg", contentType: "image/jpeg" });
  expect(res.status).toBe(201);
  return res.body.id;
}
const detail = async (a: Agent, key: string) => (await a.get(`/places/${place(key)}`)).body as PlaceDetail;

describe("user photos", () => {
  it("new accounts' photos wait for review and are only visible to their uploader", async () => {
    const u = await t.register("newbie", { verified: true });
    const res = await u.post(`/places/${place("mot")}/photos`, { mediaId: await upload(u), caption: "Herbal tea, ice cold" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "PENDING", mine: true, source: "user", caption: "Herbal tea, ice cold" });
    expect((await detail(u, "mot")).photos.map((p) => p.id)).toContain(res.body.id);
    expect((await detail(t.anon(), "mot")).photos.map((p) => p.id)).not.toContain(res.body.id);
    expect((await detail(t.anon(), "mot")).photo).toBeNull();
  });

  it("refuses unverified accounts, other people's media and duplicates", async () => {
    const unverified = await t.register("unver");
    const m = await upload(unverified);
    expect((await unverified.post(`/places/${place("mot")}/photos`, { mediaId: m })).status).toBe(403);
    const v = await t.register("thief", { verified: true });
    expect((await v.post(`/places/${place("mot")}/photos`, { mediaId: m })).status).toBe(422);
    const own = await upload(v);
    expect((await v.post(`/places/${place("mot")}/photos`, { mediaId: own })).status).toBe(201);
    expect((await v.post(`/places/${place("mot")}/photos`, { mediaId: own })).status).toBe(409);
    expect((await t.anon().post(`/places/${place("mot")}/photos`, { mediaId: own })).status).toBe(401);
  });

  it("trusted travelers publish at once; the photo becomes the place's cover with a credit", async () => {
    const sarah = await t.as("sarah@triply.dev"); // has public trips
    const res = await sarah.post(`/places/${place("roastery")}/photos`, { mediaId: await upload(sarah, "#6b3a1f") });
    expect(res.body.status).toBe("APPROVED");
    const d = await detail(t.anon(), "roastery");
    expect(d.photos[0]).toMatchObject({ id: res.body.id, mine: false, credit: { text: "Photo by Sarah", authorUrl: "/u/sarahwanders" } });
    expect(d.photo?.credit).toBe("Photo by Sarah");
    const list = (await t.anon().get("/places/browse?destination=hoi-an&q=roastery")).body as PlaceBrowse;
    expect(list.items[0].photo?.thumbUrl).toMatch(/_thumb\.webp$/);
  });

  it("can be shared from the uploader's own post only", async () => {
    const sarah = await t.as("sarah@triply.dev");
    const mediaId = await upload(sarah, "#f5cd5b");
    const post = (await sarah.post("/posts", { title: "Lantern night", body: "", mediaIds: [mediaId] })).body;
    const ok = await sarah.post(`/places/${place("ancient-town")}/photos`, { mediaId, postId: post.id });
    expect(ok.status).toBe(201);
    const other = await upload(sarah, "#123456");
    expect((await sarah.post(`/places/${place("ancient-town")}/photos`, { mediaId: other, postId: post.id })).status).toBe(422);
  });

  it("uploaders can remove their photo; others can't", async () => {
    const sarah = await t.as("sarah@triply.dev");
    const photo = (await sarah.post(`/places/${place("cao-lau")}/photos`, { mediaId: await upload(sarah) })).body as PlacePhotoView;
    const minh = await t.as("minh@triply.dev");
    expect((await minh.delete(`/place-photos/${photo.id}`)).status).toBe(403);
    expect((await sarah.delete(`/place-photos/${photo.id}`)).status).toBe(200);
    expect((await detail(t.anon(), "cao-lau")).photos.map((p) => p.id)).not.toContain(photo.id);
  });
});

describe("moderation", () => {
  it("admins review the queue; others can't see it", async () => {
    const u = await t.register("queued", { verified: true });
    const photo = (await u.post(`/places/${place("tra-que")}/photos`, { mediaId: await upload(u) })).body as PlacePhotoView;
    const minh = await t.as("minh@triply.dev");
    expect((await minh.get("/admin/place-photos")).status).toBe(403);
    expect((await minh.patch(`/place-photos/${photo.id}`, { status: "APPROVED" })).status).toBe(403);
    const an = await t.as("an@triply.dev");
    expect((await an.get("/users/me")).body.isAdmin).toBe(true);
    const queue = (await an.get("/admin/place-photos?filter=pending")).body as Paged<ModerationPhoto>;
    expect(queue.items.find((p) => p.id === photo.id)).toMatchObject({ place: { name: "Trà Quế Vegetable Village", destinationName: "Hội An" } });
    expect((await an.patch(`/place-photos/${photo.id}`, { status: "APPROVED" })).body.status).toBe("APPROVED");
    expect((await detail(t.anon(), "tra-que")).photos.map((p) => p.id)).toContain(photo.id);
    const log = await t.prisma.auditLog.findFirst({ where: { entityId: photo.id, action: "place_photo.approved" } });
    expect(log).not.toBeNull();
  });

  it("three separate reports hide a photo until a moderator restores it", async () => {
    const sarah = await t.as("sarah@triply.dev");
    const photo = (await sarah.post(`/places/${place("hoian-museum")}/photos`, { mediaId: await upload(sarah) })).body as PlacePhotoView;
    for (let i = 0; i < 3; i++) {
      const r = await t.register(`rep${i}`);
      expect((await r.post("/reports", { target: "PLACE_PHOTO", targetId: photo.id, reason: "INAPPROPRIATE" })).status).toBe(201);
    }
    expect((await detail(t.anon(), "hoian-museum")).photos.map((p) => p.id)).not.toContain(photo.id);
    // Hidden photos can't be reported (or probed) by others any more.
    expect((await (await t.register("late")).post("/reports", { target: "PLACE_PHOTO", targetId: photo.id, reason: "SPAM" })).status).toBe(404);
    const an = await t.as("an@triply.dev");
    const hidden = (await an.get("/admin/place-photos?filter=hidden")).body as Paged<ModerationPhoto>;
    expect(hidden.items.find((p) => p.id === photo.id)?.reportCount).toBe(3);
    await an.patch(`/place-photos/${photo.id}`, { status: "APPROVED" });
    // Restoring resolves those reports, so one more report doesn't immediately hide it again.
    await (await t.register("again")).post("/reports", { target: "PLACE_PHOTO", targetId: photo.id, reason: "SPAM" });
    expect((await detail(t.anon(), "hoian-museum")).photos.map((p) => p.id)).toContain(photo.id);
  });
});

describe("imported photos (Wikimedia Commons)", () => {
  let ingest: PhotoIngestService;
  const calls: { url: string; init?: RequestInit }[] = [];
  beforeAll(async () => {
    ingest = t.app.get(PhotoIngestService);
    ingest.userAgent = "TRIPLY/0.2 (+https://example.com/triply-ops) node";
    const img = await jpeg("#2f6b3a", 1600, 1000);
    ingest.fetcher = (async (url: URL | string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("not-an-image")) return new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
      return new Response(new Uint8Array(img), { status: 200, headers: { "content-type": "image/jpeg" } });
    }) as typeof fetch;
  });
  const queue = (key: string, over: Record<string, unknown> = {}) =>
    t.prisma.placePhoto.create({
      data: {
        placeId: place(key),
        source: "wikimedia",
        sourceId: "File:An Bang beach.jpg",
        remoteUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/An_Bang_beach.jpg/2400px-An_Bang_beach.jpg",
        pageUrl: "https://commons.wikimedia.org/wiki/File:An_Bang_beach.jpg",
        title: "An Bang beach",
        author: "Jane Photographer",
        license: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
        status: "APPROVED",
        score: 1.5,
        ...over,
      },
    });

  it("downloads queued photos into our own media and credits them", async () => {
    const row = await queue("an-bang");
    expect(await ingest.ingestBatch(10)).toMatchObject({ stored: 1, failed: 0 });
    expect(calls[0].init?.redirect).toBe("error");
    expect((calls[0].init?.headers as Record<string, string>)["User-Agent"]).toBe("TRIPLY/0.2 (+https://example.com/triply-ops) node");
    const d = await detail(t.anon(), "an-bang");
    const p = d.photos.find((x) => x.id === row.id)!;
    expect(p.image.url).toMatch(/^\/media\/imported\/.+_1280\.webp$/);
    expect(p.credit).toMatchObject({ text: "Photo: Jane Photographer · CC BY-SA 4.0 · via Wikimedia Commons", sourceName: "Wikimedia Commons", license: "CC BY-SA 4.0" });
    expect(p.uploader).toBeNull();
    const media = await t.prisma.media.findUniqueOrThrow({ where: { id: (await t.prisma.placePhoto.findUniqueOrThrow({ where: { id: row.id } })).mediaId! } });
    expect(media.ownerId).toBeNull();
    expect(media.width).toBe(1600);
  });

  it("reuses one download for the same file on another place, and ranks user photos first", async () => {
    const before = await t.prisma.media.count();
    const twin = await queue("coconut-forest");
    await ingest.ingestBatch(10);
    expect(await t.prisma.media.count()).toBe(before);
    expect((await t.prisma.placePhoto.findUniqueOrThrow({ where: { id: twin.id } })).mediaId).not.toBeNull();
    const sarah = await t.as("sarah@triply.dev");
    const mine = (await sarah.post(`/places/${place("coconut-forest")}/photos`, { mediaId: await upload(sarah) })).body as PlacePhotoView;
    expect((await detail(t.anon(), "coconut-forest")).photos.map((p) => p.id)).toEqual([mine.id, twin.id]);
  });

  it("waits (without contacting anyone) until a contact is configured", async () => {
    const n = calls.length;
    const row = await queue("hoian-market", { sourceId: "File:market.jpg" });
    ingest.userAgent = null;
    try {
      expect(await ingest.ingestBatch(10)).toEqual({ claimed: 0, stored: 0, failed: 0 });
      expect(calls.length).toBe(n);
      expect((await t.prisma.placePhoto.findUniqueOrThrow({ where: { id: row.id } })).ingestAttempts).toBe(0);
    } finally {
      ingest.userAgent = "TRIPLY/0.2 (+https://example.com/triply-ops) node";
    }
    expect((await ingest.ingestBatch(10)).stored).toBe(1);
  });

  it("accepts Commons' resized copies on thumb.wikimedia.org", async () => {
    const row = await queue("jade-emperor", {
      sourceId: "File:thumb.jpg",
      remoteUrl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ec/X.jpg/3840px-X.jpg?utm_source=commons.wikimedia.org",
    });
    expect(await ingest.ingestBatch(10)).toMatchObject({ stored: 1, failed: 0 });
    expect((await t.prisma.placePhoto.findUniqueOrThrow({ where: { id: row.id } })).mediaId).not.toBeNull();
  });

  it("never fetches other hosts, plain http or non-images, and backs off", async () => {
    const n = calls.length;
    const evil = await queue("white-marble", { sourceId: "File:evil", remoteUrl: "https://169.254.169.254/latest/meta-data" });
    const http = await queue("white-marble", { sourceId: "File:http", remoteUrl: "http://upload.wikimedia.org/x.jpg" });
    const html = await queue("white-marble", { sourceId: "File:html", remoteUrl: "https://upload.wikimedia.org/not-an-image.jpg" });
    expect(await ingest.ingestBatch(10)).toMatchObject({ claimed: 3, stored: 0, failed: 3 });
    expect(calls.length - n).toBe(1); // only the allowed https host was contacted
    for (const [row, err] of [
      [evil, /host not allowed/],
      [http, /host not allowed/],
      [html, /not an image/],
    ] as const) {
      const r = await t.prisma.placePhoto.findUniqueOrThrow({ where: { id: row.id } });
      expect(r).toMatchObject({ mediaId: null, ingestAttempts: 1 });
      expect(r.ingestError).toMatch(err);
      expect(r.nextIngestAt!.getTime()).toBeGreaterThan(Date.now());
    }
    // Backed off: an immediate second batch doesn't retry them.
    expect((await ingest.ingestBatch(10)).claimed).toBe(0);
    expect((await detail(t.anon(), "white-marble")).photos).toHaveLength(0);
  });
});
