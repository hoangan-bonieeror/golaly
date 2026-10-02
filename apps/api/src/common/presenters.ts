/**
 * Maps database rows → API view models (packages/shared/src/api-types.ts).
 * Presenters are the only place that decides what a viewer gets to see.
 */
import type {
  CommentView,
  DayView,
  ItemView,
  NotificationView,
  PlaceView,
  PostView,
  TripRole,
  TripSummary,
  UserSummary,
} from "@triply/shared";
import type { Prisma } from "../generated/prisma/client";
import { fromDate } from "./dates";

export const mediaUrl = (key: string | null | undefined) => (key ? `/media/${key}` : null);

// ── Users ────────────────────────────────────────────────────────────────
export const userSummarySelect = {
  id: true,
  username: true,
  profile: { select: { displayName: true, avatarHue: true, avatar: { select: { thumbKey: true, storageKey: true } } } },
} satisfies Prisma.UserSelect;

export type UserSummaryRow = Prisma.UserGetPayload<{ select: typeof userSummarySelect }>;

export function toUserSummary(u: UserSummaryRow): UserSummary {
  return {
    id: u.id,
    username: u.username,
    displayName: u.profile?.displayName ?? u.username,
    avatarHue: u.profile?.avatarHue ?? 180,
    avatarUrl: mediaUrl(u.profile?.avatar?.thumbKey ?? u.profile?.avatar?.storageKey),
  };
}

// ── Places ───────────────────────────────────────────────────────────────
export const placeInclude = (viewerId: string | null) =>
  ({
    destination: { select: { name: true } },
    savedBy: { where: { userId: viewerId ?? "00000000-0000-0000-0000-000000000000" }, select: { userId: true } },
  }) satisfies Prisma.PlaceInclude;

export type PlaceRow = Prisma.PlaceGetPayload<{ include: ReturnType<typeof placeInclude> }>;

export function toPlaceView(p: PlaceRow): PlaceView {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    destinationId: p.destinationId,
    destinationName: p.destination.name,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    rating: p.rating,
    savedByMe: p.savedBy.length > 0,
  };
}

// ── Trips ────────────────────────────────────────────────────────────────
const NO_USER = "00000000-0000-0000-0000-000000000000";

export const tripSummaryInclude = (viewerId: string | null) =>
  ({
    owner: { select: userSummarySelect },
    cover: { select: { storageKey: true, thumbKey: true } },
    destinations: {
      orderBy: { position: "asc" },
      include: { destination: { select: { id: true, slug: true, name: true, country: true } } },
    },
    days: { select: { id: true, items: { select: { placeId: true } } } },
    members: { select: { userId: true, role: true } },
    savedBy: { where: { userId: viewerId ?? NO_USER }, select: { userId: true } },
  }) satisfies Prisma.TripInclude;

export type TripSummaryRow = Prisma.TripGetPayload<{ include: ReturnType<typeof tripSummaryInclude> }>;

export function roleOf(trip: { ownerId: string; members: { userId: string; role: TripRole }[] }, viewerId: string | null): TripRole | null {
  if (!viewerId) return null;
  if (trip.ownerId === viewerId) return "OWNER";
  return trip.members.find((m) => m.userId === viewerId)?.role ?? null;
}

export function toTripSummary(t: TripSummaryRow, viewerId: string | null): TripSummary {
  const items = t.days.flatMap((d) => d.items);
  const destinations = t.destinations.map((d) => d.destination);
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    visibility: t.visibility,
    cover: [t.coverA, t.coverB],
    coverUrl: mediaUrl(t.cover?.storageKey),
    startDate: fromDate(t.startDate),
    endDate: fromDate(t.endDate),
    destinations,
    route: destinations.map((d) => d.name).join(" → "),
    owner: toUserSummary(t.owner),
    stats: {
      days: t.days.length,
      items: items.length,
      places: new Set(items.map((i) => i.placeId).filter(Boolean)).size,
      travelers: Math.max(1, t.members.length),
    },
    forkCount: t.forkCount,
    saveCount: t.saveCount,
    savedByMe: t.savedBy.length > 0,
    myRole: roleOf(t, viewerId),
    allowFork: t.allowFork,
    allowComments: t.allowComments,
    estimatedBudget: t.estimatedBudget,
    forkedFrom:
      t.forkedFromTitle && t.forkedFromOwner
        ? { tripId: t.forkedFromId ?? "", title: t.forkedFromTitle, ownerUsername: t.forkedFromOwner }
        : null,
    updatedAt: t.updatedAt.toISOString(),
  };
}

export const dayInclude = (viewerId: string | null) =>
  ({
    items: {
      orderBy: { sortOrder: "asc" },
      include: { place: { include: placeInclude(viewerId) }, updatedBy: { select: userSummarySelect } },
    },
  }) satisfies Prisma.TripDayInclude;

export type DayRow = Prisma.TripDayGetPayload<{ include: ReturnType<typeof dayInclude> }>;
export type ItemRow = DayRow["items"][number];

export function toItemView(i: ItemRow): ItemView {
  return {
    id: i.id,
    dayId: i.dayId,
    type: i.type,
    title: i.title,
    description: i.description,
    startTime: i.startTime,
    endTime: i.endTime,
    notes: i.notes,
    sortOrder: i.sortOrder,
    place: i.place ? toPlaceView(i.place) : null,
    updatedBy: i.updatedBy ? toUserSummary(i.updatedBy) : null,
    updatedAt: i.updatedAt.toISOString(),
  };
}

export function toDayView(d: DayRow): DayView {
  return { id: d.id, dayNumber: d.dayNumber, date: fromDate(d.date), title: d.title, items: d.items.map(toItemView) };
}

// ── Posts ────────────────────────────────────────────────────────────────
export const postInclude = (viewerId: string | null) =>
  ({
    user: { select: userSummarySelect },
    destination: { select: { id: true, slug: true, name: true, country: true } },
    media: { orderBy: { position: "asc" }, include: { media: { select: { storageKey: true, thumbKey: true } } } },
    trip: { include: tripSummaryInclude(viewerId) },
    likes: { where: { userId: viewerId ?? NO_USER }, select: { userId: true } },
    savedBy: { where: { userId: viewerId ?? NO_USER }, select: { userId: true } },
  }) satisfies Prisma.PostInclude;

export type PostRow = Prisma.PostGetPayload<{ include: ReturnType<typeof postInclude> }>;

/** A post's trip is only embedded if the viewer is allowed to see that trip. */
export function toPostView(p: PostRow, viewerId: string | null): PostView {
  const trip = p.trip && !p.trip.deletedAt && (p.trip.visibility !== "PRIVATE" || roleOf(p.trip, viewerId)) ? toTripSummary(p.trip, viewerId) : null;
  return {
    id: p.id,
    title: p.title,
    body: p.body,
    visibility: p.visibility,
    photos: p.media.map((m) => ({ palette: [m.paletteA, m.paletteB], url: mediaUrl(m.media?.storageKey) })),
    author: toUserSummary(p.user),
    destination: p.destination,
    trip,
    likeCount: p.likeCount,
    commentCount: p.commentCount,
    likedByMe: p.likes.length > 0,
    savedByMe: p.savedBy.length > 0,
    createdAt: p.createdAt.toISOString(),
  };
}

export const commentInclude = { user: { select: userSummarySelect } } satisfies Prisma.PostCommentInclude;
export type CommentRow = Prisma.PostCommentGetPayload<{ include: typeof commentInclude }>;

export function toCommentView(c: CommentRow, viewerId: string | null, postAuthorId: string): CommentView {
  return {
    id: c.id,
    body: c.body,
    author: toUserSummary(c.user),
    createdAt: c.createdAt.toISOString(),
    canDelete: !!viewerId && (viewerId === c.userId || viewerId === postAuthorId),
  };
}

// ── Notifications ────────────────────────────────────────────────────────
export const notificationInclude = { actor: { select: userSummarySelect } } satisfies Prisma.NotificationInclude;
export type NotificationRow = Prisma.NotificationGetPayload<{ include: typeof notificationInclude }>;

export function toNotificationView(n: NotificationRow): NotificationView {
  return {
    id: n.id,
    type: n.type,
    text: n.text,
    actor: n.actor ? toUserSummary(n.actor) : null,
    tripId: n.tripId,
    postId: n.postId,
    invitationId: n.invitationId,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}
