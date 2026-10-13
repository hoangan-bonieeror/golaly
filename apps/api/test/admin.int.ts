/** Catalog admin (phase 3B): jobs, runs (Airflow mocked), duplicate review, place curation, category maps, realtime. */
import type { AdminAreaView, UnmappedCategoriesView, AdminPlaceDetail, MergeCandidateView, Paged, SyncJobView, SyncRunDetail, SyncRunSummary } from "@triply/shared";
import { AirflowClient } from "../src/modules/admin/airflow";
import { SyncRunListener } from "../src/modules/admin/admin.module";
import { RealtimeService } from "../src/modules/realtime/realtime";
import { createTestContext, type Agent, type TestContext } from "./helpers";

let t: TestContext;
let an: Agent;
let minh: Agent;
let calls: { url: string; method: string; body: unknown }[] = [];
let airflowDown = false;

beforeAll(async () => {
  t = await createTestContext();
  const airflow = t.app.get(AirflowClient);
  airflow.fetchImpl = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    if (airflowDown) throw new TypeError("fetch failed");
    if (url.endsWith("/auth/token")) return Response.json({ access_token: "tok" });
    return Response.json({ dag_run_id: `manual__${calls.length}` }, { status: 200 });
  };
  an = await t.as("an@triply.dev");
  minh = await t.as("minh@triply.dev");
  await t.prisma.geoArea.upsert({
    where: { slug: "zz" },
    create: { slug: "zz", name: "Testland", level: "COUNTRY", countryCode: "ZZ", source: "manual", minLng: 1, minLat: 1, maxLng: 2, maxLat: 2 },
    update: {},
  });
});
const created: string[] = [];
afterAll(async () => {
  await t.prisma.placeSource.deleteMany({ where: { OR: [{ placeId: { in: created } }, { externalId: { startsWith: "unmapped-" } }] } });
  await t.prisma.place.deleteMany({ where: { id: { in: created } } });
  await t.prisma.syncRun.deleteMany({ where: { params: { path: ["area"], equals: "zz" } } });
  await t.prisma.syncJob.deleteMany({ where: { area: "zz" } });
  await t.prisma.geoArea.deleteMany({ where: { slug: "zz" } });
  await t.app.close();
});
beforeEach(() => {
  calls = [];
  airflowDown = false;
});

const put = (a: Agent, url: string, body: object) => a.raw.put(`/api/v1${url}`).set("X-Requested-With", "triply").send(body);

describe("access", () => {
  it("is admin-only", async () => {
    for (const url of ["/admin/areas", "/admin/sync-jobs", "/admin/sync-runs", "/admin/merge-candidates", "/admin/places", "/admin/categories", "/admin/category-maps"]) {
      expect((await minh.get(url)).status).toBe(403);
      expect((await t.anon().get(url)).status).toBe(401);
    }
    expect((await minh.post("/admin/sync-jobs", { name: "x", area: "zz", providers: ["osm"] })).status).toBe(403);
  });
});

describe("areas", () => {
  it("lists countries with counts", async () => {
    const res = await an.get("/admin/areas");
    expect(res.status).toBe(200);
    const zz = (res.body as AdminAreaView[]).find((a) => a.slug === "zz");
    expect(zz).toMatchObject({ name: "Testland", level: "COUNTRY", places: 0, regions: 0, bbox: [1, 1, 2, 2], lastRun: null });
    expect((await an.get("/admin/areas?parent=nope")).status).toBe(404);
  });
});

describe("sync jobs", () => {
  it("validates, creates, edits and deletes (audited)", async () => {
    expect((await an.post("/admin/sync-jobs", { name: "Bad", area: "zz", providers: ["osm"], schedule: "61 * * * *" })).status).toBe(422);
    expect((await an.post("/admin/sync-jobs", { name: "Bad", area: "nowhere", providers: ["osm"] })).status).toBe(422);
    expect((await an.post("/admin/sync-jobs", { name: "Bad", area: "zz", providers: ["yelp"] })).status).toBe(422);
    expect((await an.post("/admin/sync-jobs", { name: "Bad", providers: ["osm"] })).status).toBe(422);

    const res = await an.post("/admin/sync-jobs", { name: "Testland weekly", area: "ZZ", providers: ["overture", "osm"], schedule: "0 3 * * mon" });
    expect(res.status).toBe(201);
    const job = res.body as SyncJobView;
    expect(job).toMatchObject({ area: "zz", enabled: true, photos: true, schedule: "0 3 * * mon", lastRun: null });
    expect((await an.post("/admin/sync-jobs", { name: "Testland weekly", area: "zz", providers: ["osm"] })).status).toBe(409);

    const patched = (await an.patch(`/admin/sync-jobs/${job.id}`, { enabled: false, schedule: "@daily" })).body as SyncJobView;
    expect(patched).toMatchObject({ enabled: false, schedule: "@daily" });
    expect((await an.get("/admin/sync-jobs")).body.map((j: SyncJobView) => j.id)).toContain(job.id);
    const audits = await t.prisma.auditLog.findMany({ where: { entityId: job.id }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => a.action)).toEqual(["catalog.job.created", "catalog.job.updated"]);

    expect((await an.delete(`/admin/sync-jobs/${job.id}`)).status).toBe(204);
    expect((await an.delete(`/admin/sync-jobs/${job.id}`)).status).toBe(404);
  });
});

describe("runs", () => {
  it("'Run now' queues a run and triggers catalog_sync; a second one is refused while it's in progress", async () => {
    const job = (await an.post("/admin/sync-jobs", { name: "Run me", area: "zz", providers: ["osm"], categoryKeys: [] })).body as SyncJobView;
    const res = await an.post(`/admin/sync-jobs/${job.id}/run`, {});
    expect(res.status).toBe(201);
    const run = res.body as SyncRunDetail;
    expect(run).toMatchObject({ status: "queued", trigger: "admin", jobId: job.id, jobName: "Run me", area: "zz", requestedBy: "an.nguyen" });
    const trigger = calls.find((c) => c.url.includes("/dagRuns"))!;
    expect(trigger.url).toMatch(/\/api\/v2\/dags\/catalog_sync\/dagRuns$/);
    expect(trigger.body).toMatchObject({ logical_date: null, conf: { area: "zz", providers: ["osm"], sync_run_id: run.id, photos: true } });
    expect((await an.post(`/admin/sync-jobs/${job.id}/run`, {})).status).toBe(409);

    const list = (await an.get(`/admin/sync-runs?jobId=${job.id}`)).body as Paged<SyncRunSummary>;
    expect(list.items.map((r) => r.id)).toEqual([run.id]);
    expect((await an.get(`/admin/sync-jobs`)).body.find((j: SyncJobView) => j.id === job.id).lastRun.id).toBe(run.id);

    // Cancelling a queued run ends it at once; a running one is asked to stop.
    expect((await an.post(`/admin/sync-runs/${run.id}/cancel`)).body).toMatchObject({ status: "cancelled", cancelRequested: true });
    expect((await an.post(`/admin/sync-runs/${run.id}/cancel`)).status).toBe(409);
    const running = await t.prisma.syncRun.create({ data: { trigger: "schedule", status: "running", params: { area: "zz" } } });
    expect((await an.post(`/admin/sync-runs/${running.id}/cancel`)).body).toMatchObject({ status: "running", cancelRequested: true });
  });

  it("dry runs go to catalog_dry_run; errors are listed", async () => {
    const res = await an.post("/admin/sync-runs", { area: "zz", providers: ["osm"], dryRun: true });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ trigger: "dry_run", status: "queued" });
    expect(calls.find((c) => c.url.includes("/dagRuns"))!.url).toContain("/dags/catalog_dry_run/");
    await t.prisma.syncRunError.create({ data: { runId: res.body.id, provider: "osm", externalId: "n1", stage: "load", message: "bad geometry" } });
    const errors = (await an.get(`/admin/sync-runs/${res.body.id}/errors`)).body;
    expect(errors).toMatchObject([{ provider: "osm", stage: "load", message: "bad geometry" }]);
    expect((await an.get(`/admin/sync-runs/${res.body.id}`)).body.errorCount).toBe(1);
  });

  it("resumes a failed run as the same sync_runs row; finished runs can't be resumed", async () => {
    await t.prisma.syncRun.create({ data: { trigger: "schedule", status: "running", params: { area: "zz" } } });
    const blocked = await t.prisma.syncRun.create({ data: { trigger: "admin", status: "failed", params: { area: "zz", providers: ["osm"] } } });
    expect((await an.post(`/admin/sync-runs/${blocked.id}/resume`)).status).toBe(409); // another run of the area is going
    await t.prisma.syncRun.updateMany({ where: { status: { in: ["queued", "running"] } }, data: { status: "cancelled" } });
    const failed = await t.prisma.syncRun.create({
      data: { trigger: "admin", status: "failed", error: "worker lost", finishedAt: new Date(), params: { area: "zz", providers: ["osm"], category_keys: [], photos: false } },
    });
    expect((await an.get(`/admin/sync-runs/${failed.id}`)).body.resumable).toBe(true);
    const res = await an.post(`/admin/sync-runs/${failed.id}/resume`);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: failed.id, status: "queued", error: null, resumable: false });
    const trigger = calls.find((c) => c.url.includes("/dagRuns"))!;
    expect(trigger.url).toContain("/dags/catalog_sync/");
    expect(trigger.body).toMatchObject({ conf: { area: "zz", providers: ["osm"], photos: false, sync_run_id: failed.id } });
    expect((await an.post(`/admin/sync-runs/${failed.id}/resume`)).status).toBe(409); // queued now

    // Airflow down: the run goes back to how it was.
    const partial = await t.prisma.syncRun.create({ data: { trigger: "schedule", status: "partial", finishedAt: new Date(), params: { area: "zz", providers: ["osm"] } } });
    await t.prisma.syncRun.update({ where: { id: failed.id }, data: { status: "succeeded" } });
    airflowDown = true;
    expect((await an.post(`/admin/sync-runs/${partial.id}/resume`)).status).toBe(502);
    expect(await t.prisma.syncRun.findUniqueOrThrow({ where: { id: partial.id } })).toMatchObject({ status: "partial" });
    expect((await an.post(`/admin/sync-runs/${failed.id}/resume`)).status).toBe(409); // succeeded
    expect((await minh.post(`/admin/sync-runs/${partial.id}/resume`)).status).toBe(403);
  });

  it("when Airflow is down the run is marked failed with a helpful message", async () => {
    airflowDown = true;
    const res = await an.post("/admin/sync-runs", { area: "zz", providers: ["osm"] });
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/Can't reach Airflow/);
    const last = await t.prisma.syncRun.findFirstOrThrow({ orderBy: { startedAt: "desc" } });
    expect(last).toMatchObject({ status: "failed", trigger: "admin" });
  });

  it("forwards NOTIFY payloads to the admin room", () => {
    const realtime = t.app.get(RealtimeService);
    const spy = jest.spyOn(realtime, "admins").mockImplementation(() => undefined);
    const listener = t.app.get(SyncRunListener);
    listener.forward(JSON.stringify({ id: "r1", job_id: null, status: "running", progress: { done: 1, total: 4 } }));
    listener.forward("not json");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("sync_run", { id: "r1", jobId: null, status: "running", progress: { done: 1, total: 4 } });
    spy.mockRestore();
  });
});

async function makePlace(name: string) {
  const p = await t.prisma.place.create({ data: { name, category: "RESTAURANT", lat: 1.5, lng: 1.5, address: "1 Test St" } });
  created.push(p.id);
  return p;
}

/** merge_candidates stores each pair once, smaller id first. */
const pairOf = (x: string, y: string, score: number, signals: object = {}) =>
  t.prisma.mergeCandidate.create({ data: { placeAId: x < y ? x : y, placeBId: x < y ? y : x, score, signals } });

describe("duplicates", () => {
  it("merges (and undoes), or rejects, a pair", async () => {
    const a = await makePlace("Phở Lý");
    const b = await makePlace("Pho Ly");
    await t.prisma.placeSource.create({ data: { placeId: b.id, provider: "osm", externalId: `n-${b.id}`, raw: {}, normalized: {}, contentHash: "x", license: "ODbL", attribution: "© OpenStreetMap contributors", lat: 1.5, lng: 1.5 } });
    const pair = await pairOf(a.id, b.id, 0.7, { name: 0.9 });

    const queue = (await an.get("/admin/merge-candidates?area=")).body as Paged<MergeCandidateView>;
    const item = queue.items.find((c) => c.id === pair.id)!;
    expect(item).toMatchObject({ status: "PENDING", score: 0.7 });
    expect([item.a.name, item.b.name].sort()).toEqual(["Pho Ly", "Phở Lý"]);

    const merged = await an.post(`/admin/merge-candidates/${pair.id}/decide`, { decision: "merge" });
    expect(merged.status).toBe(201);
    expect(merged.body.status).toBe("MERGED");
    expect((await an.post(`/admin/merge-candidates/${pair.id}/decide`, { decision: "merge" })).status).toBe(409);
    const loserId = merged.body.winnerId === a.id ? b.id : a.id;
    expect((await t.prisma.place.findUniqueOrThrow({ where: { id: loserId } })).mergedIntoId).toBe(merged.body.winnerId);

    const undone = await an.post(`/admin/place-merges/${merged.body.mergeId}/undo`);
    expect(undone.status).toBe(201);
    expect((await t.prisma.place.findUniqueOrThrow({ where: { id: loserId } })).mergedIntoId).toBeNull();
    expect((await an.post(`/admin/place-merges/${merged.body.mergeId}/undo`)).status).toBe(409);

    const c = await makePlace("Cafe Một");
    const d = await makePlace("Cafe Hai");
    const pair2 = await pairOf(c.id, d.id, 0.62);
    expect((await an.post(`/admin/merge-candidates/${pair2.id}/decide`, { decision: "reject" })).body.status).toBe("REJECTED");
    const rejected = (await an.get("/admin/merge-candidates?status=rejected")).body as Paged<MergeCandidateView>;
    expect(rejected.items.map((x) => x.id)).toContain(pair2.id);
  });
});

describe("places", () => {
  it("edits lock fields, are recorded, and can be unlocked", async () => {
    const p = await makePlace("Bánh Mì Test");
    const res = await an.patch(`/admin/places/${p.id}`, { name: "Bánh Mì Phượng Test", phone: "+84 235 1234" });
    expect(res.status).toBe(200);
    const d = res.body as AdminPlaceDetail;
    expect(d).toMatchObject({ name: "Bánh Mì Phượng Test", phone: "+84 235 1234" });
    expect(d.lockedFields.sort()).toEqual(["name", "phone"]);
    expect(d.history.filter((h) => h.kind === "edit")).toHaveLength(2);
    const row = await t.prisma.place.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.searchText).toContain("phuong");
    expect(row.nameNorm).toContain("phuong");

    const found = (await an.get("/admin/places?q=phuong test")).body as Paged<AdminPlaceDetail>;
    expect(found.items.map((x) => x.id)).toContain(p.id);

    const unlocked = (await an.patch(`/admin/places/${p.id}`, { unlock: ["phone"] })).body as AdminPlaceDetail;
    expect(unlocked.lockedFields).toEqual(["name"]);
    expect((await t.prisma.place.findUniqueOrThrow({ where: { id: p.id } })).needsPublish).toBe(true);
    expect((await an.patch(`/admin/places/${p.id}`, { categoryKey: "nope" })).status).toBe(422);
    expect((await minh.patch(`/admin/places/${p.id}`, { name: "x" })).status).toBe(403);
  });
});

describe("categories", () => {
  it("lists categories, unmapped source categories, and maps them", async () => {
    const cats = (await an.get("/admin/categories")).body as { key: string }[];
    expect(cats.length).toBeGreaterThan(5);
    const key = cats.find((c) => c.key !== "")!.key;
    await t.prisma.placeSource.create({
      data: { provider: "osm", externalId: `unmapped-${Date.now()}`, raw: {}, normalized: { category_candidates: ["amenity=zz_test"] }, contentHash: "y", license: "ODbL", attribution: "© OpenStreetMap contributors", lat: 1, lng: 1 },
    });
    // The list is a background summary: not there until it's recounted.
    type Unmapped = UnmappedCategoriesView;
    const before = (await an.get("/admin/category-maps?unmapped=true&provider=osm")).body as Unmapped;
    expect(before.items.map((u) => u.externalCategory)).not.toContain("amenity=zz_test");
    const recount = await an.post("/admin/category-maps/recount");
    expect(recount.status).toBe(202);
    expect(recount.body).toEqual({ refreshing: true });
    let unmapped = before;
    for (let i = 0; i < 50 && !unmapped.items.some((u) => u.externalCategory === "amenity=zz_test"); i++) {
      await new Promise((r) => setTimeout(r, 100));
      unmapped = (await an.get("/admin/category-maps?unmapped=true&provider=osm")).body as Unmapped;
    }
    expect(unmapped.items.find((u) => u.externalCategory === "amenity=zz_test")?.records).toBe(1);
    expect(unmapped.refreshing).toBe(false);
    expect(Date.now() - Date.parse(unmapped.refreshedAt!)).toBeLessThan(60_000);
    expect((await minh.post("/admin/category-maps/recount")).status).toBe(403);

    const res = await put(an, "/admin/category-maps", { provider: "osm", externalCategory: "amenity=zz_test", categoryKey: key });
    expect(res.status).toBe(200);
    expect(res.body.records).toBe(1);
    const maps = (await an.get("/admin/category-maps?provider=osm")).body as { externalCategory: string; categoryKey: string }[];
    expect(maps.find((m) => m.externalCategory === "amenity=zz_test")?.categoryKey).toBe(key);
    const after = (await an.get("/admin/category-maps?unmapped=true&provider=osm")).body as Unmapped;
    expect(after.items.map((u) => u.externalCategory)).not.toContain("amenity=zz_test"); // mapped since the count
    expect((await put(an, "/admin/category-maps", { provider: "osm", externalCategory: "amenity=zz_test", categoryKey: null })).status).toBe(200);
    expect((await put(an, "/admin/category-maps", { provider: "osm", externalCategory: "x", categoryKey: "nope" })).status).toBe(422);
  });
});
