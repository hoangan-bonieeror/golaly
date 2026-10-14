/**
 * Adds the in-progress demo trip "Saigon long weekend" to an EXISTING database — nothing else is touched.
 *
 *   npm run db:demo-trip -w @triply/api                          # owner: an@triply.dev
 *   npm run db:demo-trip -w @triply/api -- --owner you@mail.com  # owner: your own account
 *
 * - The trip's dates are yesterday → tomorrow on this computer, so it is always under way ("Today",
 *   "Where to now?", swipe to mark, the split afternoon). Running it again replaces only this demo trip
 *   (same id), which also moves its dates to the current day.
 * - Places: a catalog place with the same name within 300 m is reused as it is; only missing ones are
 *   added (with opening hours, so "Where to now?" can say what's open).
 * - Members: minh@ and nam@triply.dev join as editors when those accounts exist (the split afternoon
 *   and meet-up point need them); without them it's a one-person trip.
 * Refuses to run with NODE_ENV=production.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { orderBySlot, slotForTime, type ItemSlot } from "@triply/shared";
import { PrismaClient, type ItemType } from "../src/generated/prisma/client";
import { createSeed } from "./seed-data/data";
import { seedId } from "./seed-data/ids";

const TRIP_KEY = "saigon";
const MEMBERS = [
  { key: "minh", email: "minh@triply.dev" },
  { key: "nam", email: "nam@triply.dev" },
];

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to add demo data in production.");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const i = process.argv.indexOf("--owner");
  const ownerEmail = (i >= 0 ? process.argv[i + 1] : undefined) ?? "an@triply.dev";

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const db = createSeed();
    const tripId = seedId(`trip:${TRIP_KEY}`);
    const seedTrip = db.trips.find((t) => t.id === tripId)!;
    const days = db.days.filter((d) => d.tripId === tripId);
    const items = db.items.filter((it) => days.some((d) => d.id === it.dayId));
    const pool = db.pool.filter((p) => p.tripId === tripId);
    const date = (iso?: string) => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);

    // ── People: the owner must exist; the demo friends are optional. ──
    const owner = await prisma.user.findFirst({ where: { email: { equals: ownerEmail, mode: "insensitive" }, deletedAt: null }, select: { id: true } });
    if (!owner) throw new Error(`No account with the email ${ownerEmail}. Pass --owner <your email>.`);
    const userOf = new Map<string, string>([[seedId("user:an"), owner.id]]);
    for (const m of MEMBERS) {
      const u = await prisma.user.findFirst({ where: { email: m.email, deletedAt: null }, select: { id: true } });
      if (u && u.id !== owner.id) userOf.set(seedId(`user:${m.key}`), u.id);
    }

    // ── Places: reuse the catalog's, add only what's missing. ──
    const placeIds = [...new Set([...items.map((it) => it.placeId), ...pool.map((p) => p.placeId)].filter((x): x is string => !!x))];
    const saigon = seedId("dest:saigon");
    // The nearby suggestions in "Where to now?" need a few places that aren't in the trip.
    const extras = db.places.filter((p) => p.destinationId === saigon && !placeIds.includes(p.id)).map((p) => p.id);
    const wanted = db.places.filter((p) => placeIds.includes(p.id) || extras.includes(p.id));

    let destinationId = (await prisma.destination.findFirst({ where: { slug: "ho-chi-minh-city" }, select: { id: true } }))?.id;
    if (!destinationId) {
      const dest = db.destinations.find((d) => d.id === saigon)!;
      destinationId = (
        await prisma.destination.create({
          data: { id: dest.id, slug: dest.slug, name: dest.name, country: dest.country, lat: dest.lat, lng: dest.lng, blurb: dest.blurb, paletteA: dest.palette[0], paletteB: dest.palette[1] },
          select: { id: true },
        })
      ).id;
    }
    const categories = new Map((await prisma.category.findMany({ select: { id: true, key: true } })).map((c) => [c.key, c.id]));
    const placeOf = new Map<string, string>();
    let added = 0;
    for (const p of wanted) {
      const same = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM places
        WHERE lower(name) = lower(${p.name}) AND merged_into_id IS NULL
          AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography, 300)
        ORDER BY (id = ${p.id}::uuid) DESC LIMIT 1`;
      if (same[0]) {
        placeOf.set(p.id, same[0].id);
        continue;
      }
      await prisma.place.create({
        data: {
          id: p.id,
          name: p.name,
          category: p.category as ItemType,
          categoryId: categories.get(db.placeCategories[p.id] ?? "") ?? null,
          destinationId,
          address: p.address,
          lat: p.lat,
          lng: p.lng,
          rating: p.rating ?? null,
          openingHours: db.placeHours[p.id] ?? null,
        },
      });
      placeOf.set(p.id, p.id);
      added++;
    }

    // ── The trip: replace the previous copy of this demo trip only. ──
    await prisma.$transaction(async (tx) => {
      await tx.trip.deleteMany({ where: { id: tripId } });
      await tx.trip.create({
        data: {
          id: tripId,
          ownerId: owner.id,
          title: seedTrip.title,
          description: seedTrip.description ?? null,
          startDate: date(seedTrip.startDate),
          endDate: date(seedTrip.endDate),
          visibility: seedTrip.visibility,
          allowComments: seedTrip.allowComments,
          allowFork: seedTrip.allowFork,
          estimatedBudget: seedTrip.estimatedBudget ?? null,
          currency: seedTrip.currency ?? "VND",
          coverA: seedTrip.cover[0],
          coverB: seedTrip.cover[1],
          destinations: { create: [{ destinationId: destinationId!, position: 0 }] },
        },
      });
      const members = db.members.filter((m) => m.tripId === tripId && userOf.has(m.userId));
      await tx.tripMember.createMany({ data: members.map((m) => ({ tripId, userId: userOf.get(m.userId)!, role: m.role, joinedAt: new Date() })) });
      await tx.tripDay.createMany({ data: days.map((d) => ({ id: d.id, tripId, dayNumber: d.dayNumber, date: date(d.date), title: d.title ?? null })) });

      // Same rule as the seed: a timed item sits in its time's part of the day, an untimed one with its neighbour.
      for (const day of days) {
        const list = items.filter((it) => it.dayId === day.id).sort((a, b) => a.sortOrder - b.sortOrder);
        const slotOf = new Map<string, ItemSlot>();
        list.forEach((it, idx) => {
          const ref = it.startTime ?? list.slice(0, idx).reverse().find((x) => x.startTime)?.startTime ?? list.slice(idx + 1).find((x) => x.startTime)?.startTime;
          slotOf.set(it.id, ref ? slotForTime(ref) : "ANY");
        });
        const order = orderBySlot(list.map((it) => ({ id: it.id, slot: slotOf.get(it.id)!, startTime: it.startTime ?? null, sortOrder: it.sortOrder })));
        await tx.itineraryItem.createMany({
          data: list.map((it) => ({
            id: it.id,
            tripId,
            dayId: day.id,
            slot: slotOf.get(it.id)!,
            type: it.type as ItemType,
            title: it.title,
            placeId: it.placeId ? placeOf.get(it.placeId)! : null,
            startTime: it.startTime ?? null,
            endTime: it.endTime ?? null,
            notes: it.notes ?? null,
            sortOrder: order.indexOf(it.id),
            addedById: owner.id,
            updatedById: owner.id,
          })),
        });
      }
      await tx.itineraryItem.createMany({
        data: pool.map((p) => ({ id: p.id, tripId, dayId: null, slot: "ANY" as const, type: p.type as ItemType, title: p.title, placeId: placeOf.get(p.placeId)!, sortOrder: p.sortOrder, addedById: userOf.get(p.addedBy) ?? owner.id, updatedById: owner.id })),
      });
      const mine = new Set(items.map((it) => it.id));
      for (const s of db.itemStatuses.filter((x) => mine.has(x.itemId))) await tx.itineraryItem.update({ where: { id: s.itemId }, data: { status: s.status } });
      await tx.itemAssignee.createMany({ data: db.itemAssignees.filter((a) => mine.has(a.itemId) && userOf.has(a.userId)).map((a) => ({ itemId: a.itemId, userId: userOf.get(a.userId)! })) });
      await tx.itineraryItem.updateMany({ where: { id: { in: db.meetups.filter((id) => mine.has(id)) } }, data: { meetup: true } });
    });

    const friends = userOf.size - 1;
    console.log(`Added "${seedTrip.title}" (${seedTrip.startDate} → ${seedTrip.endDate}) for ${ownerEmail}` + `${friends ? ` with ${friends} friend${friends > 1 ? "s" : ""}` : " (minh@/nam@triply.dev not found: no split afternoon)"}.`);
    console.log(`Places: ${wanted.length - added} reused from your catalog, ${added} added. Nothing else was changed.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
