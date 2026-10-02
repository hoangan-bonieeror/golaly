/**
 * ⚠️ DEVELOPMENT / DEMO DATA ONLY (spec §54).
 *   npm run db:seed        — wipes app tables and loads demo users, trips and posts.
 * Demo accounts: an@ / sarah@ / minh@ / linh@ / nam@triply.dev — password "demo1234".
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "@node-rs/argon2";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient, type ItemType, type NotificationType } from "../src/generated/prisma/client";
import { createSeed } from "./seed-data/data";

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
    prisma.itineraryItem.deleteMany(),
    prisma.tripDay.deleteMany(),
    prisma.tripInvitation.deleteMany(),
    prisma.tripMember.deleteMany(),
    prisma.tripDestination.deleteMany(),
    prisma.trip.deleteMany(),
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
  await prisma.follow.createMany({ data: db.follows });

  await prisma.destination.createMany({
    data: db.destinations.map((x) => ({ id: x.id, slug: x.slug, name: x.name, country: x.country, lat: x.lat, lng: x.lng, blurb: x.blurb, paletteA: x.palette[0], paletteB: x.palette[1] })),
  });
  await prisma.place.createMany({
    data: db.places.map((p) => ({ id: p.id, name: p.name, category: p.category as ItemType, destinationId: p.destinationId, address: p.address, lat: p.lat, lng: p.lng, rating: p.rating ?? null })),
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
  await prisma.tripMember.createMany({ data: db.members.map((m) => ({ ...m, joinedAt: new Date(m.joinedAt) })) });
  await prisma.tripDay.createMany({ data: db.days.map((x) => ({ id: x.id, tripId: x.tripId, dayNumber: x.dayNumber, date: d(x.date), title: x.title ?? null })) });
  await prisma.itineraryItem.createMany({
    data: db.items.map((i) => ({
      id: i.id,
      dayId: i.dayId,
      type: i.type as ItemType,
      title: i.title,
      placeId: i.placeId ?? null,
      startTime: i.startTime ?? null,
      endTime: i.endTime ?? null,
      notes: i.notes ?? null,
      sortOrder: i.sortOrder,
      updatedById: i.updatedBy ?? null,
      updatedAt: i.updatedAt ? new Date(i.updatedAt) : new Date(),
    })),
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
      text: n.text,
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
