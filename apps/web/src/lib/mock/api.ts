/**
 * Mock API — PROTOTYPE ONLY.
 *
 * Each function mirrors a planned REST endpoint (spec §27) and enforces the
 * same rules the NestJS services will: authentication, membership, role,
 * privacy. Functions mutate the `db` draft they receive; the store clones
 * before calling, so a thrown error leaves state untouched (like a DB
 * transaction rollback).
 *
 * Swapping to the real backend = replacing these bodies with fetch() calls
 * to /api/v1/... — screens only talk to the store's `actions`.
 */
import {
  assertCan,
  can,
  type ItineraryItem,
  type ItineraryItemType,
  type NotificationType,
  type Post,
  type ReportReason,
  type ReportTarget,
  type Trip,
  type TripDay,
  type TripRole,
  type TripVisibility,
  type UUID,
} from "@triply/shared";
import { newId, newToken } from "./ids";
import type { DB } from "./seed";

export class ApiError extends Error {
  constructor(
    public status: 401 | 403 | 404 | 409 | 422 | 429 | 500,
    message: string,
  ) {
    super(message);
  }
}

const now = () => new Date().toISOString();

function requireUser(me: UUID | null): UUID {
  if (!me) throw new ApiError(401, "Please log in to continue.");
  return me;
}

function getTrip(db: DB, id: UUID): Trip {
  const trip = db.trips.find((t) => t.id === id && !t.deletedAt);
  if (!trip) throw new ApiError(404, "We couldn't find that trip.");
  return trip;
}

function dayOf(db: DB, dayId: UUID): TripDay {
  const day = db.days.find((d) => d.id === dayId);
  if (!day) throw new ApiError(404, "That day no longer exists.");
  return day;
}

function itemOf(db: DB, itemId: UUID): ItineraryItem {
  const item = db.items.find((i) => i.id === itemId);
  if (!item) throw new ApiError(404, "That item was removed by someone else.");
  return item;
}

function ctx(db: DB, trip: Trip, me: UUID | null) {
  return { trip, members: db.members, userId: me };
}

function guard(fn: () => void) {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Error && e.name === "PermissionError")
      throw new ApiError(403, "You no longer have permission to edit this trip.");
    throw e;
  }
}

function notify(
  db: DB,
  recipients: UUID[],
  actorId: UUID,
  type: NotificationType,
  text: string,
  extra: { tripId?: UUID; postId?: UUID; invitationToken?: string } = {},
) {
  for (const userId of new Set(recipients)) {
    if (userId === actorId) continue;
    db.notifications.unshift({ id: newId(), userId, actorId, type, text, createdAt: now(), ...extra });
  }
}

const tripMemberIds = (db: DB, tripId: UUID) =>
  db.members.filter((m) => m.tripId === tripId).map((m) => m.userId);

// ── Trips ────────────────────────────────────────────────────────────────
export function createTrip(
  db: DB,
  me: UUID | null,
  input: { title: string; destinationIds: UUID[]; startDate?: string; endDate?: string; description?: string },
): Trip {
  const userId = requireUser(me);
  const title = input.title.trim();
  if (title.length < 2) throw new ApiError(422, "Give your trip a name (at least 2 characters).");
  if (input.startDate && input.endDate && input.endDate < input.startDate)
    throw new ApiError(422, "End date can't be before the start date.");

  const dest = db.destinations.find((d) => d.id === input.destinationIds[0]);
  const trip: Trip = {
    id: newId(),
    ownerId: userId,
    title,
    description: input.description?.trim() ?? "",
    destinationIds: input.destinationIds,
    startDate: input.startDate || undefined,
    endDate: input.endDate || undefined,
    visibility: "PRIVATE", // spec §17: default PRIVATE
    allowComments: true,
    allowFork: true,
    cover: dest?.palette ?? ["#0e6e6a", "#f26b4e"],
    forkCount: 0,
    saveCount: 0,
    createdAt: now(),
    updatedAt: now(),
  };
  db.trips.unshift(trip);
  db.members.push({ tripId: trip.id, userId, role: "OWNER", joinedAt: now() });

  const n = dayCount(trip.startDate, trip.endDate) ?? 1;
  for (let i = 0; i < n; i++) {
    db.days.push({
      id: newId(),
      tripId: trip.id,
      dayNumber: i + 1,
      date: trip.startDate ? shiftDate(trip.startDate, i) : undefined,
    });
  }
  return trip;
}

export function updateTrip(
  db: DB,
  me: UUID | null,
  tripId: UUID,
  patch: Partial<Pick<Trip, "title" | "description" | "startDate" | "endDate" | "visibility" | "allowComments" | "allowFork" | "destinationIds" | "estimatedBudget">>,
) {
  requireUser(me);
  const trip = getTrip(db, tripId);
  guard(() => {
    assertCan("trip.edit_details", ctx(db, trip, me));
    if (patch.visibility && patch.visibility !== trip.visibility)
      assertCan("trip.change_visibility", ctx(db, trip, me));
  });
  if (patch.title !== undefined && patch.title.trim().length < 2)
    throw new ApiError(422, "Trip name needs at least 2 characters.");
  if ((patch.endDate ?? trip.endDate) && (patch.startDate ?? trip.startDate) && (patch.endDate ?? trip.endDate)! < (patch.startDate ?? trip.startDate)!)
    throw new ApiError(422, "End date can't be before the start date.");
  Object.assign(trip, patch, { updatedAt: now() });
}

export function deleteTrip(db: DB, me: UUID | null, tripId: UUID) {
  requireUser(me);
  const trip = getTrip(db, tripId);
  guard(() => assertCan("trip.delete", ctx(db, trip, me)));
  trip.deletedAt = now(); // soft delete
}

// ── Days & items ─────────────────────────────────────────────────────────
export function addDay(db: DB, me: UUID | null, tripId: UUID): TripDay {
  const trip = getTrip(db, tripId);
  guard(() => assertCan("itinerary.add", ctx(db, trip, me)));
  const existing = db.days.filter((d) => d.tripId === tripId);
  const last = existing.sort((a, b) => a.dayNumber - b.dayNumber).at(-1);
  const day: TripDay = {
    id: newId(),
    tripId,
    dayNumber: (last?.dayNumber ?? 0) + 1,
    date: last?.date ? shiftDate(last.date, 1) : trip.startDate,
  };
  db.days.push(day);
  if (day.date && (!trip.endDate || day.date > trip.endDate)) trip.endDate = day.date;
  return day;
}

export interface ItemInput {
  type: ItineraryItemType;
  title: string;
  placeId?: UUID;
  startTime?: string;
  endTime?: string;
  notes?: string;
  description?: string;
}

function validateItem(input: Partial<ItemInput>) {
  if (input.title !== undefined && input.title.trim().length === 0) throw new ApiError(422, "Add a title for this item.");
  if (input.startTime && input.endTime && input.endTime < input.startTime)
    throw new ApiError(422, "End time should be after the start time.");
}

export function addItem(db: DB, me: UUID | null, dayId: UUID, input: ItemInput): ItineraryItem {
  const userId = requireUser(me);
  const day = dayOf(db, dayId);
  const trip = getTrip(db, day.tripId);
  guard(() => assertCan("itinerary.add", ctx(db, trip, me)));
  validateItem(input);
  const siblings = db.items.filter((i) => i.dayId === dayId);
  const item: ItineraryItem = {
    id: newId(),
    dayId,
    ...input,
    title: input.title.trim(),
    sortOrder: siblings.length,
    updatedBy: userId,
    updatedAt: now(),
  };
  db.items.push(item);
  sortDayByTime(db, dayId);
  trip.updatedAt = now();
  notify(db, tripMemberIds(db, trip.id), userId, "TRIP_ITEM_ADDED", `added “${item.title}” to Day ${day.dayNumber} of ${trip.title}`, { tripId: trip.id });
  return item;
}

export function updateItem(db: DB, me: UUID | null, itemId: UUID, patch: Partial<ItemInput>) {
  const userId = requireUser(me);
  const item = itemOf(db, itemId);
  const day = dayOf(db, item.dayId);
  const trip = getTrip(db, day.tripId);
  guard(() => assertCan("itinerary.edit", ctx(db, trip, me)));
  validateItem({ ...item, ...patch });
  const timeChanged = patch.startTime !== undefined && patch.startTime !== item.startTime;
  Object.assign(item, patch, { updatedBy: userId, updatedAt: now() });
  if (timeChanged) sortDayByTime(db, item.dayId);
  trip.updatedAt = now();
  notify(db, tripMemberIds(db, trip.id), userId, "TRIP_ITEM_UPDATED", `updated “${item.title}” in ${trip.title}`, { tripId: trip.id });
}

export function deleteItem(db: DB, me: UUID | null, itemId: UUID) {
  const item = itemOf(db, itemId);
  const trip = getTrip(db, dayOf(db, item.dayId).tripId);
  guard(() => assertCan("itinerary.delete", ctx(db, trip, me)));
  db.items = db.items.filter((i) => i.id !== itemId);
  renumber(db, item.dayId);
}

export function duplicateItem(db: DB, me: UUID | null, itemId: UUID) {
  const item = itemOf(db, itemId);
  const trip = getTrip(db, dayOf(db, item.dayId).tripId);
  guard(() => assertCan("itinerary.add", ctx(db, trip, me)));
  const copy: ItineraryItem = { ...item, id: newId(), title: `${item.title} (copy)`, sortOrder: item.sortOrder + 0.5, updatedBy: me!, updatedAt: now() };
  db.items.push(copy);
  renumber(db, item.dayId);
}

/** POST /items/:itemId/reorder — move within a day or to another day. */
export function reorderItem(db: DB, me: UUID | null, itemId: UUID, to: { dayId: UUID; index: number }) {
  const item = itemOf(db, itemId);
  const trip = getTrip(db, dayOf(db, item.dayId).tripId);
  const target = dayOf(db, to.dayId);
  if (target.tripId !== trip.id) throw new ApiError(422, "Items can only move within the same trip.");
  guard(() => assertCan("itinerary.reorder", ctx(db, trip, me)));
  const fromDay = item.dayId;
  const list = db.items.filter((i) => i.dayId === to.dayId && i.id !== itemId).sort((a, b) => a.sortOrder - b.sortOrder);
  list.splice(Math.max(0, Math.min(to.index, list.length)), 0, item);
  item.dayId = to.dayId;
  list.forEach((it, idx) => (it.sortOrder = idx));
  if (fromDay !== to.dayId) renumber(db, fromDay);
}

function renumber(db: DB, dayId: UUID) {
  db.items
    .filter((i) => i.dayId === dayId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .forEach((it, idx) => (it.sortOrder = idx));
}

/** New/edited timed items slot into place; untimed items keep their position. */
function sortDayByTime(db: DB, dayId: UUID) {
  const list = db.items.filter((i) => i.dayId === dayId).sort((a, b) => a.sortOrder - b.sortOrder);
  const timed = list.filter((i) => i.startTime).sort((a, b) => a.startTime!.localeCompare(b.startTime!));
  let ti = 0;
  list.map((i) => (i.startTime ? timed[ti++] : i)).forEach((it, idx) => (it.sortOrder = idx));
}

// ── Members & invitations ────────────────────────────────────────────────
export function createInvitation(
  db: DB,
  me: UUID | null,
  tripId: UUID,
  input: { email?: string; role: Exclude<TripRole, "OWNER"> },
) {
  const userId = requireUser(me);
  const trip = getTrip(db, tripId);
  guard(() => assertCan("members.invite", ctx(db, trip, me)));
  if (input.email !== undefined) {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(422, "That email doesn't look right.");
    if (db.invitations.some((i) => i.tripId === tripId && i.email === email && !i.revokedAt && !i.acceptedAt))
      throw new ApiError(409, "That person already has a pending invite.");
    input.email = email;
  }
  const inv = {
    id: newId(),
    tripId,
    email: input.email,
    role: input.role,
    token: newToken(),
    expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    invitedBy: userId,
  };
  db.invitations.push(inv);

  // Demo nicety: if the email matches a demo user, they get an in-app notification.
  const handle = input.email?.split("@")[0];
  const invitee = db.users.find((u) => u.username.split(/[._]/)[0] === handle || u.displayName.toLowerCase() === handle);
  if (invitee)
    notify(db, [invitee.id], userId, "TRIP_INVITE", `invited you to ${input.role === "EDITOR" ? "edit" : "view"} ${trip.title}`, { tripId, invitationToken: inv.token });
  return inv;
}

export function revokeInvitation(db: DB, me: UUID | null, invitationId: UUID) {
  const inv = db.invitations.find((i) => i.id === invitationId);
  if (!inv) throw new ApiError(404, "Invitation not found.");
  const trip = getTrip(db, inv.tripId);
  guard(() => assertCan("members.invite", ctx(db, trip, me)));
  inv.revokedAt = now();
}

export function lookupInvitation(db: DB, token: string) {
  const inv = db.invitations.find((i) => i.token === token);
  if (!inv) return { status: "invalid" as const };
  if (inv.revokedAt) return { status: "revoked" as const, inv };
  if (inv.acceptedAt) return { status: "accepted" as const, inv };
  if (Date.parse(inv.expiresAt) < Date.now()) return { status: "expired" as const, inv };
  return { status: "valid" as const, inv };
}

export function acceptInvitation(db: DB, me: UUID | null, token: string): UUID {
  const userId = requireUser(me);
  const res = lookupInvitation(db, token);
  if (res.status === "invalid") throw new ApiError(404, "This invitation link isn't valid.");
  if (res.status === "expired") throw new ApiError(422, "This invitation has expired.");
  if (res.status === "revoked") throw new ApiError(422, "This invitation was cancelled by the trip owner.");
  const inv = res.inv;
  const trip = getTrip(db, inv.tripId);
  const existing = db.members.find((m) => m.tripId === trip.id && m.userId === userId);
  if (!existing) {
    db.members.push({ tripId: trip.id, userId, role: inv.role, joinedAt: now() });
    notify(db, [trip.ownerId], userId, "TRIP_INVITE", `joined ${trip.title} as ${inv.role === "EDITOR" ? "an Editor" : "a Viewer"}`, { tripId: trip.id });
  }
  if (inv.email) inv.acceptedAt = now(); // link invites stay reusable until revoked/expired
  return trip.id;
}

export function rejectInvitation(db: DB, me: UUID | null, token: string) {
  requireUser(me);
  const inv = db.invitations.find((i) => i.token === token);
  if (inv && inv.email) inv.revokedAt = now();
}

export function changeRole(db: DB, me: UUID | null, tripId: UUID, userId: UUID, role: Exclude<TripRole, "OWNER">) {
  const actor = requireUser(me);
  const trip = getTrip(db, tripId);
  guard(() => assertCan("members.change_role", ctx(db, trip, me)));
  if (userId === trip.ownerId) throw new ApiError(422, "The owner's role can't be changed.");
  const m = db.members.find((x) => x.tripId === tripId && x.userId === userId);
  if (!m) throw new ApiError(404, "That person isn't on this trip anymore.");
  m.role = role;
  notify(db, [userId], actor, "TRIP_MEMBER_ROLE_CHANGED", `made you ${role === "EDITOR" ? "an Editor" : "a Viewer"} on ${trip.title}`, { tripId });
}

export function removeMember(db: DB, me: UUID | null, tripId: UUID, userId: UUID) {
  const trip = getTrip(db, tripId);
  guard(() => assertCan("members.remove", ctx(db, trip, me)));
  if (userId === trip.ownerId) throw new ApiError(422, "The owner can't be removed.");
  db.members = db.members.filter((m) => !(m.tripId === tripId && m.userId === userId));
}

// ── Fork / Remix (spec §20) ──────────────────────────────────────────────
export function forkTrip(db: DB, me: UUID | null, tripId: UUID): Trip {
  const userId = requireUser(me);
  const src = getTrip(db, tripId);
  if (src.ownerId === userId) throw new ApiError(422, "This is already your trip — duplicate it from Settings instead.");
  if (!can("trip.fork", ctx(db, src, me))) throw new ApiError(403, "The creator hasn't allowed remixing this trip.");
  const owner = db.users.find((u) => u.id === src.ownerId)!;

  const fork: Trip = {
    // Copied: title, description, dates, destinations, days, items, places
    id: newId(),
    ownerId: userId, // newTrip.owner = currentUser
    title: src.title,
    description: src.description,
    destinationIds: [...src.destinationIds],
    startDate: src.startDate,
    endDate: src.endDate,
    estimatedBudget: src.estimatedBudget,
    currency: src.currency,
    cover: src.cover,
    // Reset: privacy, social counters. NOT copied: members, invitations, comments, media.
    visibility: "PRIVATE",
    allowComments: true,
    allowFork: true,
    forkCount: 0,
    saveCount: 0,
    forkedFrom: { sourceTripId: src.id, sourceTripTitle: src.title, sourceOwnerId: owner.id, sourceOwnerUsername: owner.username },
    createdAt: now(),
    updatedAt: now(),
  };
  db.trips.unshift(fork);
  db.members.push({ tripId: fork.id, userId, role: "OWNER", joinedAt: now() });

  const srcDays = db.days.filter((d) => d.tripId === src.id).sort((a, b) => a.dayNumber - b.dayNumber);
  for (const d of srcDays) {
    const nd: TripDay = { ...d, id: newId(), tripId: fork.id };
    db.days.push(nd);
    db.items
      .filter((i) => i.dayId === d.id)
      .forEach((i) => db.items.push({ ...i, id: newId(), dayId: nd.id, updatedBy: userId, updatedAt: now() }));
  }
  src.forkCount += 1; // the source trip content itself is never modified
  notify(db, [src.ownerId], userId, "TRIP_FORKED", `remixed your trip ${src.title}`, { tripId: src.id });
  return fork;
}

// ── Social ───────────────────────────────────────────────────────────────
export function toggleSaveTrip(db: DB, me: UUID | null, tripId: UUID): boolean {
  const userId = requireUser(me);
  const trip = getTrip(db, tripId);
  if (!can("trip.view", ctx(db, trip, me))) throw new ApiError(403, "This trip is private.");
  const i = db.savedTrips.findIndex((s) => s.userId === userId && s.tripId === tripId);
  if (i >= 0) {
    db.savedTrips.splice(i, 1);
    trip.saveCount = Math.max(0, trip.saveCount - 1);
    return false;
  }
  db.savedTrips.push({ userId, tripId });
  trip.saveCount += 1;
  notify(db, [trip.ownerId], userId, "TRIP_SAVED", `saved your trip ${trip.title}`, { tripId });
  return true;
}

export function toggleSavePost(db: DB, me: UUID | null, postId: UUID): boolean {
  const userId = requireUser(me);
  const i = db.savedPosts.findIndex((s) => s.userId === userId && s.postId === postId);
  if (i >= 0) return db.savedPosts.splice(i, 1), false;
  db.savedPosts.push({ userId, postId });
  return true;
}

export function toggleSavePlace(db: DB, me: UUID | null, placeId: UUID): boolean {
  const userId = requireUser(me);
  const i = db.savedPlaces.findIndex((s) => s.userId === userId && s.placeId === placeId);
  if (i >= 0) return db.savedPlaces.splice(i, 1), false;
  db.savedPlaces.push({ userId, placeId });
  return true;
}

export function toggleLike(db: DB, me: UUID | null, postId: UUID): boolean {
  const userId = requireUser(me);
  const post = db.posts.find((p) => p.id === postId);
  if (!post) throw new ApiError(404, "This post was removed.");
  const i = db.likes.findIndex((l) => l.userId === userId && l.postId === postId);
  if (i >= 0) {
    db.likes.splice(i, 1);
    post.likeCount -= 1;
    return false;
  }
  db.likes.push({ userId, postId });
  post.likeCount += 1;
  notify(db, [post.userId], userId, "LIKE", `liked your post ${post.title}`, { postId });
  return true;
}

export function addComment(db: DB, me: UUID | null, postId: UUID, body: string) {
  const userId = requireUser(me);
  const post = db.posts.find((p) => p.id === postId);
  if (!post) throw new ApiError(404, "This post was removed.");
  const text = body.trim();
  if (!text) throw new ApiError(422, "Write something first.");
  if (text.length > 1000) throw new ApiError(422, "Comments are limited to 1,000 characters.");
  db.comments.push({ id: newId(), postId, userId, body: text, createdAt: now() });
  post.commentCount += 1;
  notify(db, [post.userId], userId, "COMMENT", `commented on ${post.title}`, { postId });
}

export function deleteComment(db: DB, me: UUID | null, commentId: UUID) {
  const userId = requireUser(me);
  const c = db.comments.find((x) => x.id === commentId);
  if (!c) return;
  const post = db.posts.find((p) => p.id === c.postId);
  if (c.userId !== userId && post?.userId !== userId) throw new ApiError(403, "You can only delete your own comments.");
  db.comments = db.comments.filter((x) => x.id !== commentId);
  if (post) post.commentCount -= 1;
}

export function toggleFollow(db: DB, me: UUID | null, targetId: UUID): boolean {
  const userId = requireUser(me);
  if (userId === targetId) throw new ApiError(422, "You can't follow yourself.");
  const i = db.follows.findIndex((f) => f.followerId === userId && f.followingId === targetId);
  if (i >= 0) return db.follows.splice(i, 1), false;
  db.follows.push({ followerId: userId, followingId: targetId });
  notify(db, [targetId], userId, "FOLLOW", "started following you");
  return true;
}

export function createPost(
  db: DB,
  me: UUID | null,
  input: { title: string; body: string; tripId?: UUID; visibility: Post["visibility"] },
): Post {
  const userId = requireUser(me);
  if (input.title.trim().length < 3) throw new ApiError(422, "Give your post a title.");
  let destinationId: UUID | undefined;
  let photos: Post["photos"] = [["#0e6e6a", "#f26b4e"]];
  if (input.tripId) {
    const trip = getTrip(db, input.tripId);
    if (trip.ownerId !== userId) throw new ApiError(403, "You can only share your own trips.");
    if (input.visibility === "PUBLIC" && trip.visibility === "PRIVATE")
      throw new ApiError(422, "Make the trip Public or Link-only before sharing it publicly.");
    destinationId = trip.destinationIds[0];
    photos = [trip.cover, ...trip.destinationIds.slice(1).map((id) => db.destinations.find((d) => d.id === id)!.palette)];
  }
  const post: Post = {
    id: newId(),
    userId,
    tripId: input.tripId,
    destinationId,
    title: input.title.trim(),
    body: input.body.trim(),
    photos,
    visibility: input.visibility,
    likeCount: 0,
    commentCount: 0,
    createdAt: now(),
  };
  db.posts.unshift(post);
  return post;
}

export function report(db: DB, me: UUID | null, target: ReportTarget, targetId: UUID, reason: ReportReason) {
  const userId = requireUser(me);
  db.reports.push({ id: newId(), reporterId: userId, target, targetId, reason, createdAt: now() });
}

export function markRead(db: DB, me: UUID | null, id: UUID) {
  const n = db.notifications.find((x) => x.id === id && x.userId === me);
  if (n && !n.readAt) n.readAt = now();
}

export function markAllRead(db: DB, me: UUID | null) {
  db.notifications.filter((n) => n.userId === me && !n.readAt).forEach((n) => (n.readAt = now()));
}

export function setVisibility(db: DB, me: UUID | null, tripId: UUID, visibility: TripVisibility) {
  updateTrip(db, me, tripId, { visibility });
}

// ── helpers ──────────────────────────────────────────────────────────────
export function shiftDate(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayCount(start?: string, end?: string) {
  if (!start || !end) return undefined;
  return Math.round((Date.parse(end) - Date.parse(start)) / 86400_000) + 1;
}

// ── Auth & profile ───────────────────────────────────────────────────────
export function register(db: DB, _me: UUID | null, input: { email: string; username: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  const username = input.username.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(422, "Enter a valid email address.");
  if (!/^[a-z0-9._]{3,24}$/.test(username)) throw new ApiError(422, "Usernames are 3–24 characters: letters, numbers, dots or underscores.");
  if (input.password.length < 8) throw new ApiError(422, "Use at least 8 characters for your password.");
  if (db.users.some((u) => u.username === username)) throw new ApiError(409, "That username is taken.");
  const user = {
    id: newId(),
    username,
    displayName: username.split(/[._]/)[0].replace(/^\w/, (c) => c.toUpperCase()),
    bio: "",
    avatarHue: Math.floor(Math.random() * 360),
  };
  db.users.push(user);
  return user;
}

export function updateProfile(
  db: DB,
  me: UUID | null,
  patch: Partial<Pick<import("@triply/shared").User, "displayName" | "bio" | "homeBase" | "travelerType" | "interests">>,
) {
  const userId = requireUser(me);
  const user = db.users.find((u) => u.id === userId)!;
  if (patch.displayName !== undefined && !patch.displayName.trim()) throw new ApiError(422, "Display name can't be empty.");
  if (patch.bio && patch.bio.length > 160) throw new ApiError(422, "Bio is limited to 160 characters.");
  Object.assign(user, patch);
}
