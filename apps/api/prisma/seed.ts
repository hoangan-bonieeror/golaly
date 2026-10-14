/**
 * ⚠️ DEVELOPMENT / DEMO DATA ONLY (spec §54).
 *   npm run db:seed        — wipes app tables and loads demo users, trips and posts.
 * Demo accounts: an@ / sarah@ / minh@ / linh@ / nam@triply.dev — password "demo1234".
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "@node-rs/argon2";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient, type ItemType, type NotificationType, type Prisma } from "../src/generated/prisma/client";
import { createSeed } from "./seed-data/data";
import { notificationText, orderBySlot, slotForTime, type ItemSlot } from "@triply/shared";

const DEMO_PASSWORD = "demo1234";

export async function seedDatabase(url: string | undefined = process.env.DATABASE_URL, { quiet = false } = {}) {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production.");
  if (!url) throw new Error("DATABASE_URL is not set");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const db = createSeed();
  const d = (iso?: string) => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);

  // Wipe in dependency order (dev only).
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.report.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.savedPlace.deleteMany(),
    prisma.savedPost.deleteMany(),
    prisma.savedTrip.deleteMany(),
    prisma.postComment.deleteMany(),
    prisma.postLike.deleteMany(),
    prisma.postMedia.deleteMany(),
    prisma.post.deleteMany(),
    prisma.tripEvent.deleteMany(),
    prisma.settlement.deleteMany(),
    prisma.expenseShare.deleteMany(),
    prisma.expense.deleteMany(),
    prisma.itemPhoto.deleteMany(),
    prisma.itemAssignee.deleteMany(),
    prisma.itemVote.deleteMany(),
    prisma.itineraryItem.deleteMany(),
    prisma.tripDay.deleteMany(),
    prisma.tripInvitation.deleteMany(),
    prisma.tripMember.deleteMany(),
    prisma.tripDestination.deleteMany(),
    prisma.trip.deleteMany(),
    prisma.placePhoto.deleteMany(),
    prisma.place.deleteMany(),
    prisma.destination.deleteMany(),
    prisma.follow.deleteMany(),
    prisma.session.deleteMany(),
    prisma.passwordResetToken.deleteMany(),
    prisma.userProfile.deleteMany(),
    prisma.media.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  const passwordHash = await hash(DEMO_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  for (const u of db.users) {
    await prisma.user.create({
      data: {
        id: u.id,
        email: `${u.displayName.toLowerCase()}@triply.dev`,
        username: u.username,
        passwordHash,
        isDemo: true,
        emailVerifiedAt: new Date(),
        profile: {
          create: {
            displayName: u.displayName,
            bio: u.bio,
            homeBase: u.homeBase,
            avatarHue: u.avatarHue,
            travelerType: u.travelerType,
            interests: u.interests ?? [],
            onboardedAt: new Date(),
          },
        },
      },
    });
  }
  // An moderates place photos in the demo (Settings → Moderation).
  await prisma.user.update({ where: { username: "an.nguyen" }, data: { role: "ADMIN" } });
  await prisma.follow.createMany({ data: db.follows });

  await prisma.destination.createMany({
    data: db.destinations.map((x) => ({ id: x.id, slug: x.slug, name: x.name, country: x.country, lat: x.lat, lng: x.lng, blurb: x.blurb, paletteA: x.palette[0], paletteB: x.palette[1] })),
  });
  // Categories come from the taxonomy migration; a place without an explicit key gets its item type's default.
  const categories = await prisma.category.findMany({ select: { id: true, key: true } });
  const categoryId = new Map(categories.map((c) => [c.key, c.id]));
  const defaults = new Map((await prisma.categoryMap.findMany({ where: { provider: "manual" } })).map((m) => [m.externalCategory, m.categoryId]));
  await prisma.place.createMany({
    data: db.places.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category as ItemType,
      categoryId: categoryId.get(db.placeCategories[p.id] ?? "") ?? defaults.get(p.category) ?? null,
      destinationId: p.destinationId,
      address: p.address,
      lat: p.lat,
      lng: p.lng,
      rating: p.rating ?? null,
      openingHours: db.placeHours[p.id] ?? null,
    })),
  });

  for (const t of db.trips) {
    await prisma.trip.create({
      data: {
        id: t.id,
        ownerId: t.ownerId,
        title: t.title,
        description: t.description,
        startDate: d(t.startDate),
        endDate: d(t.endDate),
        visibility: t.visibility,
        allowComments: t.allowComments,
        allowFork: t.allowFork,
        estimatedBudget: t.estimatedBudget ?? null,
        currency: t.currency ?? "USD",
        coverA: t.cover[0],
        coverB: t.cover[1],
        forkCount: t.forkCount,
        saveCount: t.saveCount,
        createdAt: new Date(t.createdAt),
        updatedAt: new Date(t.updatedAt),
        destinations: { create: t.destinationIds.map((destinationId, position) => ({ destinationId, position })) },
      },
    });
  }
  await prisma.tripMember.createMany({
    data: db.members.map((m) => {
      const dates = db.memberDates.find((x) => x.tripId === m.tripId && x.userId === m.userId);
      return { ...m, joinedAt: new Date(m.joinedAt), arriveOn: d(dates?.arriveOn ?? undefined), leaveOn: d(dates?.leaveOn ?? undefined) };
    }),
  });
  await prisma.tripDay.createMany({ data: db.days.map((x) => ({ id: x.id, tripId: x.tripId, dayNumber: x.dayNumber, date: d(x.date), title: x.title ?? null })) });
  // Flexible plans: timed items sit in their time's part of the day, untimed ones in the part of the
  // timed item before them (same rule as migration 20261017000000), each day grouped by part.
  const tripOfDay = new Map(db.days.map((x) => [x.id, x.tripId]));
  const slotOf = new Map<string, ItemSlot>();
  const order = new Map<string, number>();
  for (const day of db.days) {
    const list = db.items.filter((i) => i.dayId === day.id).sort((a, b) => a.sortOrder - b.sortOrder);
    list.forEach((i, idx) => {
      const before = list.slice(0, idx).reverse().find((x) => x.startTime);
      const after = list.slice(idx + 1).find((x) => x.startTime);
      const ref = i.startTime ?? before?.startTime ?? after?.startTime;
      slotOf.set(i.id, ref ? slotForTime(ref) : "ANY");
    });
    orderBySlot(list.map((i) => ({ id: i.id, slot: slotOf.get(i.id)!, startTime: i.startTime ?? null, sortOrder: i.sortOrder }))).forEach((id, n) => order.set(id, n));
  }
  await prisma.itineraryItem.createMany({
    data: db.items.map((i) => ({
      id: i.id,
      tripId: tripOfDay.get(i.dayId)!,
      dayId: i.dayId,
      slot: slotOf.get(i.id)!,
      addedById: i.updatedBy ?? null,
      type: i.type as ItemType,
      title: i.title,
      placeId: i.placeId ?? null,
      startTime: i.startTime ?? null,
      endTime: i.endTime ?? null,
      notes: i.notes ?? null,
      sortOrder: order.get(i.id)!,
      updatedById: i.updatedBy ?? null,
      updatedAt: i.updatedAt ? new Date(i.updatedAt) : new Date(),
    })),
  });
  await prisma.itineraryItem.createMany({
    data: db.pool.map((x) => ({ id: x.id, tripId: x.tripId, dayId: null, slot: "ANY" as const, type: x.type as ItemType, title: x.title, placeId: x.placeId, sortOrder: x.sortOrder, addedById: x.addedBy, updatedById: x.addedBy })),
  });
  await prisma.itemVote.createMany({ data: db.votes.map((v) => ({ ...v })) });
  // After the trip: what happened at each stop, and the money.
  await prisma.itemAssignee.createMany({ data: db.itemAssignees });
  await prisma.itineraryItem.updateMany({ where: { id: { in: db.meetups } }, data: { meetup: true } });
  for (const s of db.itemStatuses) await prisma.itineraryItem.update({ where: { id: s.itemId }, data: { status: s.status } });
  for (const e of db.expenses) {
    await prisma.expense.create({
      data: {
        id: e.id,
        tripId: e.tripId,
        paidById: e.paidBy,
        amount: BigInt(e.amount),
        description: e.description,
        category: e.category,
        spentOn: d(e.spentOn ?? undefined),
        itemId: e.itemId,
        createdById: e.paidBy,
        createdAt: new Date(e.createdAt),
        shares: { create: e.shares.map((x) => ({ userId: x.userId, amount: BigInt(x.amount) })) },
      },
    });
  }
  await prisma.settlement.createMany({
    data: db.settlements.map((x) => ({ id: x.id, tripId: x.tripId, fromId: x.fromId, toId: x.toId, amount: BigInt(x.amount), createdById: x.fromId, createdAt: new Date(x.createdAt) })),
  });

  // Demo invitations get fresh random tokens; only hashes are stored.
  for (const inv of db.invitations) {
    const token = randomBytes(32).toString("base64url");
    await prisma.tripInvitation.create({
      data: { id: inv.id, tripId: inv.tripId, email: inv.email ?? null, role: inv.role, tokenHash: createHash("sha256").update(token).digest("hex"), invitedBy: inv.invitedBy, expiresAt: new Date(inv.expiresAt) },
    });
  }

  for (const p of db.posts) {
    await prisma.post.create({
      data: {
        id: p.id,
        userId: p.userId,
        tripId: p.tripId ?? null,
        destinationId: p.destinationId ?? null,
        title: p.title,
        body: p.body,
        visibility: p.visibility,
        likeCount: p.likeCount,
        commentCount: db.comments.filter((c) => c.postId === p.id).length,
        createdAt: new Date(p.createdAt),
        media: { create: p.photos.map(([a, b], position) => ({ paletteA: a, paletteB: b, position })) },
      },
    });
  }
  await prisma.postComment.createMany({ data: db.comments.map((c) => ({ ...c, createdAt: new Date(c.createdAt) })) });
  await prisma.postLike.createMany({ data: db.likes });
  await prisma.savedTrip.createMany({ data: db.savedTrips });
  await prisma.savedPost.createMany({ data: db.savedPosts });
  await prisma.savedPlace.createMany({ data: db.savedPlaces });

  await prisma.notification.createMany({
    data: db.notifications.map((n) => ({
      id: n.id,
      userId: n.userId,
      actorId: n.actorId,
      type: n.type as NotificationType,
      text: notificationText(n.message, "en"),
      params: n.message as unknown as Prisma.InputJsonObject,
      tripId: n.tripId ?? null,
      postId: n.postId ?? null,
      invitationId: n.type === "TRIP_INVITE" ? (db.invitations.find((i) => i.tripId === n.tripId)?.id ?? null) : null,
      readAt: n.readAt ? new Date(n.readAt) : null,
      createdAt: new Date(n.createdAt),
    })),
  });

  if (!quiet) console.log(`Seeded ${db.users.length} demo users, ${db.trips.length} trips, ${db.items.length} itinerary items, ${db.posts.length} posts.`);
  if (!quiet) console.log(`Demo login: an@triply.dev / ${DEMO_PASSWORD}`);
  await prisma.$disconnect();
}

if (require.main === module)
  seedDatabase().catch((e) => {
    console.error(e);
    process.exit(1);
  });
