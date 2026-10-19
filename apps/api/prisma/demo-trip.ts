/**
 * Adds the demo trips for roadmap phases 2 and 3 to an EXISTING database — nothing else is touched.
 *
 *   npm run db:demo-trip -w @triply/api                           # both trips, owner an@golaly.dev
 *   npm run db:demo-trip -w @triply/api -- --owner you@mail.com   # owned by your own account
 *   npm run db:demo-trip -w @triply/api -- --trip hoian           # only one: saigon | hoian
 *
 * - "Saigon long weekend" (phase 2): dates yesterday → tomorrow on this computer, so it is always under way
 *   ("Today", "Where to now?", swipe to mark, the split afternoon and meet-up point).
 * - "Hội An with the crew" (phase 3): a public trip that's over (Aug 2026) with stops marked went / skipped,
 *   votes, expenses in đồng and a repayment — for the recap, the expenses panel and remix evidence.
 * - Running it again replaces only these demo trips (same ids); Saigon's dates move to the current day.
 * - Places: a catalog place with the same name within 300 m is reused as it is; only missing ones are added
 *   (with opening hours, so "Where to now?" can say what's open).
 * - Friends: minh@, linh@ and nam@golaly.dev join when those accounts exist. Without them a trip has fewer
 *   people: equal splits are shared among whoever is here; by-amount splits and repayments that involve a
 *   missing person are left out.
 * Refuses to run with NODE_ENV=production.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { normalizeSearch, orderBySlot, slotForTime, splitEqually, type ItemSlot } from "@triply/shared";
import { PrismaClient, type ItemType } from "../src/generated/prisma/client";
import { createSeed, type DB } from "./seed-data/data";
import { seedId } from "./seed-data/ids";

const TRIPS = ["saigon", "hoian"] as const;
type TripKey = (typeof TRIPS)[number];
const FRIENDS = ["minh", "linh", "nam"];
/** Extra places per trip that aren't on it (the nearby suggestions in "Where to now?"). */
const EXTRA_DESTINATION: Record<TripKey, string | null> = { saigon: "saigon", hoian: null };

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const date = (iso?: string | null) => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to add demo data in production.");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const ownerEmail = arg("--owner") ?? "an@golaly.dev";
  const only = arg("--trip");
  if (only && !TRIPS.includes(only as TripKey)) throw new Error(`--trip must be one of: ${TRIPS.join(", ")}`);
  const keys = only ? [only as TripKey] : [...TRIPS];

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const db = createSeed();

    // ── People: the owner must exist; the demo friends are optional. ──
    const owner = await prisma.user.findFirst({ where: { email: { equals: ownerEmail, mode: "insensitive" }, deletedAt: null }, select: { id: true } });
    if (!owner) throw new Error(`No account with the email ${ownerEmail}. Pass --owner <your email>.`);
    const userOf = new Map<string, string>([[seedId("user:an"), owner.id]]);
    for (const key of FRIENDS) {
      const u = await prisma.user.findFirst({ where: { email: `${key}@golaly.dev`, deletedAt: null }, select: { id: true } });
      if (u && u.id !== owner.id) userOf.set(seedId(`user:${key}`), u.id);
    }
    const categories = new Map((await prisma.category.findMany({ select: { id: true, key: true } })).map((c) => [c.key, c.id]));

    for (const key of keys) {
      const r = await addTrip(prisma, db, key, owner.id, userOf, categories);
      console.log(`✓ "${r.title}" (${r.start} → ${r.end}) for ${ownerEmail}: ${r.people} ${r.people === 1 ? "person" : "people"}${r.money ? `, ${r.money}` : ""}.`);
      console.log(`  Places: ${r.reused} reused from your catalog, ${r.added} added.`);
    }
    if (userOf.size < FRIENDS.length + 1) console.log("  (Some of minh@/linh@/nam@golaly.dev don't exist here, so their parts of the demo were left out.)");
    console.log("Nothing else was changed.");
  } finally {
    await prisma.$disconnect();
  }
}

async function addTrip(prisma: PrismaClient, db: DB, key: TripKey, ownerId: string, userOf: Map<string, string>, categories: Map<string, string>) {
  const tripId = seedId(`trip:${key}`);
  const seedTrip = db.trips.find((t) => t.id === tripId)!;
  const days = db.days.filter((d) => d.tripId === tripId);
  const items = db.items.filter((it) => days.some((d) => d.id === it.dayId));
  const pool = db.pool.filter((p) => p.tripId === tripId);
  const itemIds = new Set([...items.map((i) => i.id), ...pool.map((p) => p.id)]);
  const mapped = (id: string) => userOf.get(id);

  // ── Destinations and places: reuse what's there, add only what's missing. ──
  const destOf = new Map<string, string>();
  for (const id of seedTrip.destinationIds) {
    const dest = db.destinations.find((d) => d.id === id)!;
    const found = await prisma.destination.findFirst({ where: { slug: dest.slug }, select: { id: true } });
    destOf.set(
      id,
      found?.id ??
        (
          await prisma.destination.create({
            data: { id: dest.id, slug: dest.slug, name: dest.name, country: dest.country, lat: dest.lat, lng: dest.lng, blurb: dest.blurb, paletteA: dest.palette[0], paletteB: dest.palette[1] },
            select: { id: true },
          })
        ).id,
    );
  }
  const placeIds = new Set([...items.map((it) => it.placeId), ...pool.map((p) => p.placeId)].filter((x): x is string => !!x));
  const extraDest = EXTRA_DESTINATION[key] && seedId(`dest:${EXTRA_DESTINATION[key]}`);
  const wanted = db.places.filter((p) => placeIds.has(p.id) || (extraDest && p.destinationId === extraDest));
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
    const destinationId = destOf.get(p.destinationId) ?? (await prisma.destination.findFirst({ where: { id: p.destinationId }, select: { id: true } }))?.id ?? null;
    await prisma.place.create({
      data: {
        id: p.id,
        name: p.name,
        nameNorm: normalizeSearch(p.name),
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
  let money = "";
  const members = db.members.filter((m) => m.tripId === tripId && mapped(m.userId));
  await prisma.$transaction(async (tx) => {
    await tx.trip.deleteMany({ where: { id: tripId } });
    await tx.trip.create({
      data: {
        id: tripId,
        ownerId,
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
        destinations: { create: seedTrip.destinationIds.map((id, position) => ({ destinationId: destOf.get(id)!, position })) },
      },
    });
    await tx.tripMember.createMany({ data: members.map((m) => ({ tripId, userId: mapped(m.userId)!, role: m.role, joinedAt: new Date() })) });
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
          addedById: ownerId,
          updatedById: ownerId,
        })),
      });
    }
    if (pool.length)
      await tx.itineraryItem.createMany({
        data: pool.map((p) => ({ id: p.id, tripId, dayId: null, slot: "ANY" as const, type: p.type as ItemType, title: p.title, placeId: placeOf.get(p.placeId)!, sortOrder: p.sortOrder, addedById: mapped(p.addedBy) ?? ownerId, updatedById: ownerId })),
      });

    // What happened, who wanted what, who's going where.
    for (const s of db.itemStatuses.filter((x) => itemIds.has(x.itemId))) await tx.itineraryItem.update({ where: { id: s.itemId }, data: { status: s.status } });
    await tx.itemVote.createMany({ data: db.votes.filter((v) => itemIds.has(v.itemId) && mapped(v.userId)).map((v) => ({ itemId: v.itemId, userId: mapped(v.userId)!, level: v.level })) });
    await tx.itemAssignee.createMany({ data: db.itemAssignees.filter((a) => itemIds.has(a.itemId) && mapped(a.userId)).map((a) => ({ itemId: a.itemId, userId: mapped(a.userId)! })) });
    await tx.itineraryItem.updateMany({ where: { id: { in: db.meetups.filter((id) => itemIds.has(id)) } }, data: { meetup: true } });

    // The money. An equal split is re-split among whoever is here; a by-amount split needs everyone on it.
    const expenses = db.expenses
      .filter((e) => e.tripId === tripId && mapped(e.paidBy))
      .flatMap((e) => {
        if (e.shares.every((s) => mapped(s.userId))) return [e];
        const amounts = e.shares.map((s) => s.amount);
        const here = e.shares.filter((s) => mapped(s.userId)).map((s) => s.userId);
        return Math.max(...amounts) - Math.min(...amounts) <= 1 && here.length ? [{ ...e, shares: splitEqually(e.amount, here) }] : [];
      });
    for (const e of expenses)
      await tx.expense.create({
        data: {
          id: e.id,
          tripId,
          paidById: mapped(e.paidBy)!,
          amount: BigInt(e.amount),
          description: e.description,
          category: e.category,
          spentOn: date(e.spentOn),
          itemId: e.itemId,
          createdById: mapped(e.paidBy)!,
          createdAt: new Date(e.createdAt),
          shares: { create: e.shares.map((s) => ({ userId: mapped(s.userId)!, amount: BigInt(s.amount) })) },
        },
      });
    const settlements = db.settlements.filter((s) => s.tripId === tripId && mapped(s.fromId) && mapped(s.toId));
    if (settlements.length)
      await tx.settlement.createMany({
        data: settlements.map((s) => ({ id: s.id, tripId, fromId: mapped(s.fromId)!, toId: mapped(s.toId)!, amount: BigInt(s.amount), createdById: mapped(s.fromId)!, createdAt: new Date(s.createdAt) })),
      });
    const all = db.expenses.filter((e) => e.tripId === tripId).length;
    if (all) money = `${expenses.length}/${all} expenses${settlements.length ? `, ${settlements.length} repayment` : ""}`;
  });

  return { title: seedTrip.title, start: seedTrip.startDate, end: seedTrip.endDate, people: members.length, reused: wanted.length - added, added, money };
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
