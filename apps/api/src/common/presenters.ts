import { ITEM_TYPE_LABEL_VI, notificationText, type NotificationMessage } from "@triply/shared";
import { requestLocale } from "./locale";
/**
 * Maps database rows → API view models (packages/shared/src/api-types.ts).
 * Presenters are the only place that decides what a viewer gets to see.
 */
import type {
  PlacePhotoView,
  CommentView,
  ImageView,
  DayView,
  ItemEvidence,
  ItemStatus,
  ItemView,
  TripOutcome,
  NotificationView,
  PlaceView,
  PostView,
  TripRole,
  TripSummary,
  UserSummary,
} from "@triply/shared";
import { pickPlaceName } from "./locale";
import { ITEM_TYPE_LABEL } from "@triply/shared";
import type { Prisma } from "../generated/prisma/client";
import { fromDate } from "./dates";

export const mediaUrl = (key: string | null | undefined) => (key ? `/media/${key}` : null);

/** Every stored image comes in 3 widths so clients can pick via srcset. */
export const imageSelect = { id: true, storageKey: true, mediumKey: true, thumbKey: true, dominantColor: true, width: true, height: true, mimeType: true } as const;
type ImageRow = { id: string; storageKey: string; mediumKey: string | null; thumbKey: string | null; dominantColor: string | null; width: number; height: number; mimeType?: string };

export function toImage(m: ImageRow): ImageView & { id: string; mimeType: string } {
  return {
    id: m.id,
    url: mediaUrl(m.mediumKey ?? m.storageKey)!,
    fullUrl: mediaUrl(m.storageKey)!,
    thumbUrl: mediaUrl(m.thumbKey ?? m.storageKey)!,
    color: m.dominantColor,
    width: m.width,
    height: m.height,
    mimeType: m.mimeType ?? "image/webp",
  };
}

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
    area: { select: { name: true } },
    categoryRef: { select: { key: true, labelEn: true, labelVi: true } },
    names: { where: { kind: "primary" }, select: { lang: true, name: true } },
    photos: { where: visiblePhoto, orderBy: photoOrder, take: 1, include: { media: true, uploadedBy: { select: userSummarySelect } } },
    savedBy: { where: { userId: viewerId ?? "00000000-0000-0000-0000-000000000000" }, select: { userId: true } },
  }) satisfies Prisma.PlaceInclude;

/** Places users may pick, browse or search: active and not merged into another record. */
export const listablePlace = { status: "ACTIVE", mergedIntoId: null } satisfies Prisma.PlaceWhereInput;

export type PlaceRow = Prisma.PlaceGetPayload<{ include: ReturnType<typeof placeInclude> }>;

export function toPlaceView(p: PlaceRow): PlaceView {
  return {
    id: p.id,
    // In the viewer's language when the place has a name in it; `localName` keeps the on-the-ground name.
    ...pickPlaceName(p.name, p.names),
    category: p.category,
    destinationId: p.destinationId,
    // Imported places outside a curated destination fall back to their administrative area.
    destinationName: p.destination?.name ?? p.area?.name ?? "",
    areaName: p.area?.name ?? null,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    rating: p.rating,
    status: p.status,
    savedByMe: p.savedBy.length > 0,
    categoryKey: p.categoryRef?.key ?? null,
    categoryLabel: requestLocale() === "vi" ? (p.categoryRef?.labelVi ?? ITEM_TYPE_LABEL_VI[p.category]) : (p.categoryRef?.labelEn ?? ITEM_TYPE_LABEL[p.category]),
    photo: p.photos[0]?.media ? { ...toImage(p.photos[0].media), credit: photoCredit(p.photos[0]).text } : null,
  };
}

// ── Place photos ─────────────────────────────────────────────────────────
/** Shown to everyone: approved and already processed into our own media. */
export const visiblePhoto = { status: "APPROVED", mediaId: { not: null } } satisfies Prisma.PlacePhotoWhereInput;
export const photoOrder = [{ score: "desc" }, { createdAt: "asc" }] satisfies Prisma.PlacePhotoOrderByWithRelationInput[];
export const placePhotoInclude = { media: true, uploadedBy: { select: userSummarySelect } } satisfies Prisma.PlacePhotoInclude;
export type PlacePhotoRow = Prisma.PlacePhotoGetPayload<{ include: typeof placePhotoInclude }>;

const SOURCE_NAME: Record<string, string> = { wikimedia: "Wikimedia Commons", mapillary: "Mapillary", user: "TRIPLY" };

/**
 * The attribution the licence asks for (title, author, source, licence — "TASL" for Creative Commons),
 * or the uploader for photos shared on TRIPLY.
 */
export function photoCredit(p: Pick<PlacePhotoRow, "source" | "title" | "author" | "authorUrl" | "license" | "licenseUrl" | "pageUrl" | "uploadedBy">): PlacePhotoView["credit"] {
  const sourceName = SOURCE_NAME[p.source] ?? p.source;
  if (p.source === "user") {
    const by = p.uploadedBy ? toUserSummary(p.uploadedBy).displayName : "a TRIPLY traveler";
    return { text: `Photo by ${by}`, title: null, author: by, authorUrl: p.uploadedBy ? `/u/${p.uploadedBy.username}` : null, license: null, licenseUrl: null, sourceName, sourceUrl: null };
  }
  const parts = [p.author ? `Photo: ${p.author}` : "Photo", p.license, `via ${sourceName}`].filter(Boolean);
  return { text: parts.join(" · "), title: p.title, author: p.author, authorUrl: p.authorUrl, license: p.license, licenseUrl: p.licenseUrl, sourceName, sourceUrl: p.pageUrl };
}

export function toPlacePhotoView(p: PlacePhotoRow & { media: NonNullable<PlacePhotoRow["media"]> }, viewerId: string | null): PlacePhotoView {
  return {
    id: p.id,
    image: toImage(p.media),
    source: p.source,
    caption: p.caption,
    status: p.status,
    mine: !!viewerId && p.uploadedById === viewerId,
    uploader: p.uploadedBy ? toUserSummary(p.uploadedBy) : null,
    credit: photoCredit(p),
    createdAt: p.createdAt.toISOString(),
  };
}

// ── Trips ────────────────────────────────────────────────────────────────
const NO_USER = "00000000-0000-0000-0000-000000000000";

export const tripSummaryInclude = (viewerId: string | null) =>
  ({
    owner: { select: userSummarySelect },
    cover: { select: imageSelect },
    destinations: {
      orderBy: { position: "asc" },
      include: { destination: { select: { id: true, slug: true, name: true, country: true } } },
    },
    days: { select: { id: true, items: { select: { placeId: true, status: true } } } },
    members: { select: { userId: true, role: true } },
    savedBy: { where: { userId: viewerId ?? NO_USER }, select: { userId: true } },
    forkedFrom: { select: { visibility: true, deletedAt: true } },
  }) satisfies Prisma.TripInclude;

export type TripSummaryRow = Prisma.TripGetPayload<{ include: ReturnType<typeof tripSummaryInclude> }>;

export function roleOf(trip: { ownerId: string; members: { userId: string; role: TripRole }[] }, viewerId: string | null): TripRole | null {
  if (!viewerId) return null;
  if (trip.ownerId === viewerId) return "OWNER";
  return trip.members.find((m) => m.userId === viewerId)?.role ?? null;
}

/** How the trip went, over its planned places; null until someone has marked a stop. */
function outcomeOf(items: { placeId: string | null; status: ItemStatus }[]): TripOutcome | null {
  const places = items.filter((i) => i.placeId);
  const visited = places.filter((i) => i.status === "VISITED").length;
  const skipped = places.filter((i) => i.status === "SKIPPED").length;
  return visited + skipped ? { planned: places.length, visited, skipped } : null;
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
    coverUrl: t.cover ? mediaUrl(t.cover.mediumKey ?? t.cover.storageKey) : null,
    coverImage: t.cover ? toImage(t.cover) : null,
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
    currency: t.currency,
    outcome: outcomeOf(items),
    forkedFrom:
      t.forkedFromTitle && t.forkedFromOwner
        ? {
            // Credit always stays; the link only while the source is still viewable (not deleted, not private).
            tripId: t.forkedFrom && !t.forkedFrom.deletedAt && t.forkedFrom.visibility !== "PRIVATE" ? (t.forkedFromId ?? "") : "",
            title: t.forkedFromTitle,
            ownerUsername: t.forkedFromOwner,
          }
        : null,
    updatedAt: t.updatedAt.toISOString(),
  };
}

export const itemInclude = (viewerId: string | null) =>
  ({
    place: { include: placeInclude(viewerId) },
    updatedBy: { select: userSummarySelect },
    addedBy: { select: userSummarySelect },
    votes: { select: { userId: true, level: true }, orderBy: { createdAt: "asc" } },
    photos: { orderBy: { createdAt: "asc" }, take: 24, include: { media: true, uploader: { select: userSummarySelect } } },
    // A fork's item: what the original group did there (only shown while the original is viewable).
    source: { select: { status: true, votes: { select: { level: true } }, trip: { select: { visibility: true, deletedAt: true } } } },
  }) satisfies Prisma.ItineraryItemInclude;

export const dayInclude = (viewerId: string | null) =>
  ({
    items: { orderBy: { sortOrder: "asc" }, include: itemInclude(viewerId) },
  }) satisfies Prisma.TripDayInclude;

export type DayRow = Prisma.TripDayGetPayload<{ include: ReturnType<typeof dayInclude> }>;
export type ItemRow = Prisma.ItineraryItemGetPayload<{ include: ReturnType<typeof itemInclude> }>;

function evidenceOf(src: ItemRow["source"]): ItemEvidence | null {
  if (!src || src.trip.deletedAt || src.trip.visibility === "PRIVATE") return null;
  if (src.status === "PLANNED" && !src.votes.length) return null;
  return { status: src.status, loves: src.votes.filter((v) => v.level === "LOVE").length, votes: src.votes.length };
}

export function toItemView(i: ItemRow): ItemView {
  return {
    id: i.id,
    tripId: i.tripId,
    dayId: i.dayId,
    slot: i.slot,
    status: i.status,
    votes: i.votes.map((v) => ({ userId: v.userId, level: v.level })),
    addedBy: i.addedBy ? toUserSummary(i.addedBy) : null,
    photos: i.photos.map((p) => ({ id: p.id, image: toImage(p.media), uploadedBy: toUserSummary(p.uploader), createdAt: p.createdAt.toISOString() })),
    evidence: evidenceOf(i.source),
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
    media: { orderBy: { position: "asc" }, include: { media: { select: imageSelect } } },
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
    photos: p.media.map((m) => ({ palette: [m.paletteA, m.paletteB], url: m.media ? mediaUrl(m.media.mediumKey ?? m.media.storageKey) : null, image: m.media ? toImage(m.media) : null })),
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
    // Built in the reader's language from the stored message; older rows only have the English sentence.
    text: n.params ? notificationText(n.params as unknown as NotificationMessage, requestLocale()) : n.text,
    actor: n.actor ? toUserSummary(n.actor) : null,
    tripId: n.tripId,
    postId: n.postId,
    invitationId: n.invitationId,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}
