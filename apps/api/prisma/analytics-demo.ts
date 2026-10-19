/**
 * Synthetic activity for the admin analytics dashboard — so its charts have something to show in dev and in
 * screenshots. Adds people who signed up over the last N days, with logins that fade over time (retention),
 * trips (some planned together, some public), stops, marked visits and posts. Nothing existing is touched.
 *
 *   npm run db:analytics-demo -w @triply/api                 # 90 days of history
 *   npm run db:analytics-demo -w @triply/api -- --days 60
 *   npm run db:analytics-demo -w @triply/api -- --reset      # remove the generated data and make it again
 *   npm run db:analytics-demo -w @triply/api -- --remove     # only remove it
 *
 * Generated accounts use `@demo.golaly.invalid` addresses, are flagged `is_demo`, and can't log in (no password).
 * Deterministic (seeded random), so two runs on the same day give the same shape. Refuses NODE_ENV=production.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type ItemType } from "../src/generated/prisma/client";

const DOMAIN = "demo.golaly.invalid";
const DAY = 86_400_000;
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** mulberry32: small, seeded, good enough for fake data. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Linh", "Minh", "An", "Huy", "Mai", "Nam", "Thảo", "Khoa", "Vy", "Bảo", "Sam", "Alex", "Jordan", "Taylor", "Kai", "Noah", "Mia", "Leo"];
const TITLES = ["Long weekend", "Food crawl", "Slow week", "Road trip", "Family visit", "Beach days", "City break", "Hiking loop"];
const COVERS: [string, string][] = [
  ["#1f5e52", "#d9a441"],
  ["#2f4858", "#f26419"],
  ["#5b3758", "#f9a03f"],
  ["#264653", "#e9c46a"],
];

async function remove(prisma: PrismaClient) {
  const users = await prisma.user.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) return 0;
  await prisma.post.deleteMany({ where: { userId: { in: ids } } });
  await prisma.trip.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  return ids.length;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to add demo data in production.");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const days = Math.min(365, Math.max(14, Number(arg("--days") ?? 90)));
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    if (process.argv.includes("--reset") || process.argv.includes("--remove")) {
      const n = await remove(prisma);
      console.log(`Removed ${n} generated people (and their trips and posts).`);
      if (process.argv.includes("--remove")) return;
    } else if (await prisma.user.count({ where: { email: { endsWith: `@${DOMAIN}` } } })) {
      throw new Error("Generated analytics data is already there. Use --reset to make it again, or --remove.");
    }

    const destinations = await prisma.destination.findMany({ where: { autoCreated: false }, select: { id: true, name: true } });
    if (!destinations.length) throw new Error("No destinations: seed or import the catalog first.");
    const places = await prisma.place.findMany({
      where: { destinationId: { in: destinations.map((d) => d.id) }, status: "ACTIVE" },
      select: { id: true, name: true, destinationId: true, category: true },
    });
    const placesBy = new Map<string, typeof places>();
    for (const p of places) placesBy.set(p.destinationId!, [...(placesBy.get(p.destinationId!) ?? []), p]);

    const r = rng(20261015);
    const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const between = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
    const now = Date.now();
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
    const at = (t: number) => new Date(Math.min(t, now - 60_000));

    const users: { id: string; email: string; username: string; createdAt: Date; isDemo: boolean; emailVerifiedAt: Date }[] = [];
    const profiles: { userId: string; displayName: string; avatarHue: number }[] = [];
    const sessions: { userId: string; tokenHash: string; createdAt: Date; lastUsedAt: Date; expiresAt: Date }[] = [];
    const trips: { id: string; ownerId: string; title: string; coverA: string; coverB: string; startDate: Date; endDate: Date; visibility: "PRIVATE" | "PUBLIC"; createdAt: Date }[] = [];
    const tripDest: { tripId: string; destinationId: string; position: number }[] = [];
    const members: { tripId: string; userId: string; role: "OWNER" | "EDITOR"; joinedAt: Date }[] = [];
    const tripDays: { id: string; tripId: string; dayNumber: number; date: Date }[] = [];
    const items: { id: string; tripId: string; dayId: string; type: ItemType; title: string; sortOrder: number; placeId: string | null; addedById: string; status: "PLANNED" | "VISITED" | "SKIPPED"; createdAt: Date }[] = [];
    const events: { tripId: string; actorId: string; itemId: string; type: string; at: Date }[] = [];
    const posts: { userId: string; tripId: string; title: string; body: string; createdAt: Date }[] = [];

    let n = 0;
    for (let d = days - 1; d >= 0; d--) {
      const dayStart = today - d * DAY;
      const growth = 2 + 7 * ((days - d) / days); // 2 → 9 sign-ups a day over the period
      const weekend = [0, 6].includes(new Date(dayStart).getUTCDay()) ? 1.4 : 1;
      const count = Math.max(0, Math.round(growth * weekend * (0.6 + r() * 0.8)));
      for (let k = 0; k < count; k++) {
        const created = dayStart + between(7, 22) * 3_600_000 + between(0, 59) * 60_000;
        if (created > now) continue;
        n++;
        const id: string = randomUUID();
        const name = `${pick(FIRST)} ${String.fromCharCode(65 + (n % 26))}.`;
        users.push({ id, email: `user${n}@${DOMAIN}`, username: `demo_user_${n}`, createdAt: new Date(created), isDemo: true, emailVerifiedAt: new Date(created) });
        profiles.push({ userId: id, displayName: name, avatarHue: between(0, 359) });

        // Logins: the day they join, then fading — a few stay for weeks.
        const keen = r();
        for (let age = 0; dayStart + age * DAY <= today; age++) {
          const p = age === 0 ? 1 : 0.55 * keen * Math.exp(-age / (6 + keen * 20)) + 0.015;
          if (r() < p) {
            const t = age === 0 ? created : dayStart + age * DAY + between(6, 23) * 3_600_000;
            if (t > now) break;
            sessions.push({ userId: id, tokenHash: randomUUID(), createdAt: new Date(t), lastUsedAt: new Date(t), expiresAt: new Date(t + 30 * DAY) });
          }
        }

        // A trip for most of them.
        if (r() < 0.68) {
          const tripId = randomUUID();
          const tCreated = Math.min(created + between(0, 3) * DAY + between(1, 120) * 60_000, now - 120_000);
          const start = new Date(new Date(tCreated + between(4, 50) * DAY).toISOString().slice(0, 10) + "T00:00:00Z");
          const len = between(2, 6);
          const end = new Date(start.getTime() + (len - 1) * DAY);
          const dest = pick(destinations);
          const cover = pick(COVERS);
          trips.push({ id: tripId, ownerId: id, title: `${dest.name} · ${pick(TITLES)}`, coverA: cover[0], coverB: cover[1], startDate: start, endDate: end, visibility: r() < 0.25 ? "PUBLIC" : "PRIVATE", createdAt: new Date(tCreated) });
          tripDest.push({ tripId, destinationId: dest.id, position: 0 });
          members.push({ tripId, userId: id, role: "OWNER", joinedAt: new Date(tCreated) });
          // Planned together: friends from the people who joined before.
          const crew: string[] = [id];
          if (r() < 0.45 && users.length > 5) {
            for (let f = between(1, 3); f > 0; f--) {
              const friend = users[between(0, users.length - 2)];
              if (crew.includes(friend.id)) continue;
              crew.push(friend.id);
              members.push({ tripId, userId: friend.id, role: "EDITOR", joinedAt: at(tCreated + between(1, 48) * 3_600_000) });
            }
          }
          const dayIds = Array.from({ length: len }, (_, i) => {
            const dayId = randomUUID();
            tripDays.push({ id: dayId, tripId, dayNumber: i + 1, date: new Date(start.getTime() + i * DAY) });
            return dayId;
          });
          if (r() < 0.86) {
            const pool = placesBy.get(dest.id) ?? [];
            const happened = end.getTime() < today && r() < 0.62;
            for (let s = 0, stops = between(3, 10); s < stops; s++) {
              const itemId = randomUUID();
              const place = pool.length ? pick(pool) : null;
              const who = pick(crew);
              const added = at(tCreated + between(5, 60 * 24 * 3) * 60_000);
              const status = happened ? (r() < 0.78 ? "VISITED" : "SKIPPED") : "PLANNED";
              items.push({ id: itemId, tripId, dayId: dayIds[s % len], type: (place?.category ?? "NOTE") as ItemType, title: place?.name ?? "Free time", sortOrder: s, placeId: place?.id ?? null, addedById: who, status, createdAt: added });
              events.push({ tripId, actorId: who, itemId, type: "item.added", at: added });
              if (status !== "PLANNED") events.push({ tripId, actorId: pick(crew), itemId, type: "item.status", at: at(end.getTime() + between(10, 40) * 3_600_000) });
            }
            if (happened && r() < 0.3) {
              posts.push({ userId: id, tripId, title: `Back from ${dest.name}`, body: "What we actually did, stop by stop.", createdAt: at(end.getTime() + between(1, 5) * DAY) });
            }
          }
        }
      }
    }

    const chunk = async <T>(rows: T[], f: (part: T[]) => Promise<unknown>) => {
      for (let i = 0; i < rows.length; i += 2000) await f(rows.slice(i, i + 2000));
    };
    await chunk(users, (p) => prisma.user.createMany({ data: p }));
    await chunk(profiles, (p) => prisma.userProfile.createMany({ data: p }));
    await chunk(sessions, (p) => prisma.session.createMany({ data: p }));
    await chunk(trips, (p) => prisma.trip.createMany({ data: p }));
    await chunk(tripDest, (p) => prisma.tripDestination.createMany({ data: p }));
    await chunk(members, (p) => prisma.tripMember.createMany({ data: p, skipDuplicates: true }));
    await chunk(tripDays, (p) => prisma.tripDay.createMany({ data: p }));
    await chunk(items, (p) => prisma.itineraryItem.createMany({ data: p }));
    await chunk(events, (p) => prisma.tripEvent.createMany({ data: p }));
    await chunk(posts, (p) => prisma.post.createMany({ data: p }));
    console.log(
      `✓ ${users.length} people over ${days} days · ${sessions.length} logins · ${trips.length} trips (${new Set(members.filter((m) => m.role === "EDITOR").map((m) => m.tripId)).size} planned together) · ${items.length} stops · ${posts.length} posts`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
