import { LOCALES } from "./i18n";
import { EXPENSE_CATEGORIES, isCurrency, MAX_AMOUNT } from "./money";
import { ITEM_SLOTS, ITEM_STATUSES, VOTE_LEVELS } from "./plan";
/**
 * Zod schemas shared by the API (request validation) and the web app (forms).
 * One definition → same rules on both sides (spec §41).
 */
import { z } from "zod";
import { isWeakPassword, passwordContainsIdentity } from "./passwords";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._]{3,24}$/, "Usernames are 3–24 characters: letters, numbers, dots or underscores.");
export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters for your password.")
  .max(128, "Passwords are limited to 128 characters.")
  .refine((p) => p.length < 8 || !isWeakPassword(p), "That password is too easy to guess. Try a few unrelated words.");
const isoDate = z.string().regex(ISO_DATE, "Use the format YYYY-MM-DD.");
const hhmm = z.string().regex(HHMM, "Use the format HH:mm.");
const uuid = z.string().uuid();

export const roleSchema = z.enum(["OWNER", "EDITOR", "VIEWER"]);
export const assignableRoleSchema = z.enum(["EDITOR", "VIEWER"]);
export const visibilitySchema = z.enum(["PRIVATE", "LINK_ONLY", "PUBLIC"]);
export const itemTypeSchema = z.enum(["PLACE", "RESTAURANT", "HOTEL", "FLIGHT", "TRANSPORTATION", "ACTIVITY", "NOTE"]);
export const travelerTypeSchema = z.enum(["SOLO", "COUPLE", "FRIENDS", "FAMILY", "ALL"]);
export const interestSchema = z.enum(["FOOD", "NATURE", "BEACH", "CITY", "CULTURE", "ADVENTURE", "SHOPPING", "PHOTOGRAPHY"]);
export const reportTargetSchema = z.enum(["POST", "COMMENT", "USER", "TRIP", "PLACE_PHOTO"]);
export const reportReasonSchema = z.enum(["SPAM", "HARASSMENT", "INAPPROPRIATE", "MISLEADING", "OTHER"]);

const dateRange = <T extends { startDate?: string | null; endDate?: string | null }>(v: T) =>
  !v.startDate || !v.endDate || v.endDate >= v.startDate;
const dateRangeMsg = { message: "End date can't be before the start date.", path: ["endDate"] };

// ── Auth ────────────────────────────────────────────────────────────────
export const registerSchema = z
  .object({ email: emailSchema, username: usernameSchema, password: passwordSchema })
  .refine((v) => !passwordContainsIdentity(v.password, v), { path: ["password"], message: "Don't use your username or email in your password." });
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password.").max(128) });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const changePasswordSchema = z.object({ currentPassword: z.string().max(128).optional(), newPassword: passwordSchema });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

// ── Users ───────────────────────────────────────────────────────────────
export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1, "Display name can't be empty.").max(50),
    bio: z.string().trim().max(160, "Bio is limited to 160 characters."),
    homeBase: z.string().trim().max(80),
    travelerType: travelerTypeSchema.nullable(),
    interests: z.array(interestSchema).max(8),
    avatarMediaId: uuid.nullable(),
    locale: z.enum(LOCALES),
    analyticsConsent: z.boolean(),
  })
  .partial();

// ── Trips ───────────────────────────────────────────────────────────────
/** A route can't visit the same destination twice (it's a set with an order). */
const destinationIdsSchema = z
  .array(uuid)
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, "Each destination can only be added once.");

export const tripTitleSchema = z.string().trim().min(2, "Give your trip a name (at least 2 characters).").max(120);
export const createTripSchema = z
  .object({
    title: tripTitleSchema,
    description: z.string().trim().max(2000).optional(),
    destinationIds: destinationIdsSchema.default([]),
    startDate: isoDate.optional().nullable(),
    endDate: isoDate.optional().nullable(),
  })
  .refine(dateRange, dateRangeMsg);

export const updateTripSchema = z
  .object({
    title: tripTitleSchema,
    description: z.string().trim().max(2000),
    destinationIds: destinationIdsSchema,
    startDate: isoDate.nullable(),
    endDate: isoDate.nullable(),
    visibility: visibilitySchema,
    allowComments: z.boolean(),
    allowFork: z.boolean(),
    // Per person, in whole units of the trip's currency (₫ amounts run into the millions).
    estimatedBudget: z.number().int().min(0).max(2_000_000_000).nullable(),
    coverMediaId: uuid.nullable(),
    /** ISO 4217; can't change once the trip has expenses. */
    currency: z.string().trim().toUpperCase().refine(isCurrency, "Pick a currency from the list."),
  })
  .partial()
  .refine(dateRange, dateRangeMsg);

// ── Itinerary ───────────────────────────────────────────────────────────
const itemBase = z.object({
  type: itemTypeSchema,
  title: z.string().trim().min(1, "Add a title for this item.").max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  placeId: uuid.nullable().optional(),
  startTime: hhmm.nullable().optional(),
  endTime: hhmm.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  /** Part of the day; set from startTime when one is given (see slotForTime). */
  slot: z.enum(ITEM_SLOTS).optional(),
  status: z.enum(ITEM_STATUSES).optional(),
  meetup: z.boolean().optional(),
});
const timeOrder = (v: { startTime?: string | null; endTime?: string | null }) => !v.startTime || !v.endTime || v.endTime >= v.startTime;
const timeMsg = { message: "End time should be after the start time.", path: ["endTime"] };

export const createItemSchema = itemBase.refine(timeOrder, timeMsg);
export const updateItemSchema = itemBase.partial().refine(timeOrder, timeMsg);
/** Move an item: `dayId` null = to the place pool; `index` is its position in the target list; `slot` its new part of the day. */
export const reorderItemSchema = z.object({ dayId: uuid.nullable(), index: z.number().int().min(0).max(10_000), slot: z.enum(ITEM_SLOTS).optional() });
export const voteSchema = z.object({ level: z.enum(VOTE_LEVELS) });
/** After the trip: mark many stops at once (visited / skipped / back to planned). */
export const itemStatusBatchSchema = z.object({
  items: z.array(z.object({ id: uuid, status: z.enum(ITEM_STATUSES) })).min(1).max(300),
});
export const itemPhotoSchema = z.object({ mediaId: uuid });
/** Who goes to a stop when the group splits up; an empty list means everyone. */
export const itemAssigneesSchema = z.object({ userIds: z.array(uuid).max(50) });
export type ItemAssigneesInput = z.infer<typeof itemAssigneesSchema>;

// ── Expenses (amounts in the currency's smallest unit) ──────────────────
const minor = z.number().int("Amounts are whole numbers of the currency's smallest unit.").positive("Enter an amount above zero.").max(MAX_AMOUNT, "That amount is too large.");
const splitSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("equal"), userIds: z.array(uuid).min(1, "Choose who shares it.").max(50) }),
  z.object({ mode: z.literal("custom"), shares: z.array(z.object({ userId: uuid, amount: z.number().int().min(0).max(MAX_AMOUNT) })).min(1, "Choose who shares it.").max(50) }),
]);
export const expenseSchema = z
  .object({
    description: z.string().trim().min(1, "Say what it was for.").max(120),
    amount: minor,
    category: z.enum(EXPENSE_CATEGORIES).default("OTHER"),
    paidById: uuid,
    spentOn: isoDate.nullable().optional(),
    itemId: uuid.nullable().optional(),
    split: splitSchema,
  })
  .refine((v) => (v.split.mode === "equal" ? new Set(v.split.userIds).size === v.split.userIds.length : new Set(v.split.shares.map((s) => s.userId)).size === v.split.shares.length), {
    message: "Each person can only appear once.",
    path: ["split"],
  })
  .refine((v) => v.split.mode === "equal" || v.split.shares.reduce((a, s) => a + s.amount, 0) === v.amount, {
    message: "The shares have to add up to the total.",
    path: ["split"],
  });
export const settlementSchema = z
  .object({ fromId: uuid, toId: uuid, amount: minor })
  .refine((v) => v.fromId !== v.toId, { message: "Choose two different people.", path: ["toId"] });
export const memberDatesSchema = z
  .object({ arriveOn: isoDate.nullable(), leaveOn: isoDate.nullable() })
  .refine((v) => !v.arriveOn || !v.leaveOn || v.arriveOn <= v.leaveOn, { message: "The leaving date should be on or after the arrival date.", path: ["leaveOn"] });
export const updateDaySchema = z.object({ title: z.string().trim().max(120).nullable() });

// ── Members & invitations ───────────────────────────────────────────────
export const createInvitationSchema = z.object({ email: emailSchema.optional(), role: assignableRoleSchema });
export const changeRoleSchema = z.object({ role: assignableRoleSchema });

// ── Social ──────────────────────────────────────────────────────────────
export const createPostSchema = z.object({
  title: z.string().trim().min(3, "Give your post a title.").max(160),
  body: z.string().trim().max(5000).default(""),
  tripId: uuid.nullable().optional(),
  visibility: z.enum(["PUBLIC", "FOLLOWERS", "DRAFT"]).default("PUBLIC"),
  mediaIds: z.array(uuid).max(10).default([]),
});
export const updatePostSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    body: z.string().trim().max(5000),
    visibility: z.enum(["PUBLIC", "FOLLOWERS", "DRAFT"]),
  })
  .partial();
export const createCommentSchema = z.object({
  body: z.string().trim().min(1, "Write something first.").max(1000, "Comments are limited to 1,000 characters."),
});
export const createReportSchema = z.object({ target: reportTargetSchema, targetId: uuid, reason: reportReasonSchema, details: z.string().trim().max(1000).optional() });

// ── Queries ─────────────────────────────────────────────────────────────
export const searchQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  type: z.enum(["all", "trips", "places", "people", "destinations"]).default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const latLng = z
  .string()
  .regex(/^-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?$/, "Use “lat,lng”.")
  .transform((v) => v.split(",").map(Number) as [number, number])
  .refine(([lat, lng]) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180, "That location is out of range.");
/** Explore → Places. Either a destination slug or a "lat,lng" point (e.g. the device) sets the area. */
export const placeBrowseQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  group: z.string().regex(/^[a-z_]+$/).max(40).optional(),
  category: z.string().regex(/^[a-z_]+\.[a-z_]+$/).max(60).optional(),
  destination: z.string().regex(/^[a-z0-9-]+$/).max(80).optional(),
  /** A geo area slug (country, province or city): places inside it, at any depth. */
  area: z.string().regex(/^[a-z0-9-]+$/).max(80).optional(),
  near: latLng.optional(),
  radius: z.coerce.number().min(0.5).max(50).optional(),
  sort: z.enum(["recommended", "distance", "rating"]).default("recommended"),
  // Offset cursor (results can be ordered by distance, which has no stable row key).
  cursor: z.string().regex(/^\d{1,5}$/, "That page link is invalid.").optional(),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});
export type PlaceBrowseQuery = z.infer<typeof placeBrowseQuerySchema>;

// ── Place photos ────────────────────────────────────────────────────────
export const addPlacePhotoSchema = z.object({
  /** An image the viewer uploaded through POST /media (or one of their post's photos). */
  mediaId: uuid,
  caption: z.string().trim().max(200).optional(),
  /** Set when the photo is shared from one of the viewer's posts. */
  postId: uuid.optional(),
});
export const moderatePhotoSchema = z.object({ status: z.enum(["APPROVED", "HIDDEN"]) });
export type AddPlacePhotoInput = z.infer<typeof addPlacePhotoSchema>;

export const pageQuerySchema = z.object({
  // Cursors are row ids; anything else is a 422, never a database error.
  cursor: z.uuid("That page link is invalid.").optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateTripInput = z.input<typeof createTripSchema>;
export type UpdateTripInput = z.infer<typeof updateTripSchema>;
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type ReorderItemInput = z.infer<typeof reorderItemSchema>;
export type VoteInput = z.infer<typeof voteSchema>;
export type ItemStatusBatchInput = z.infer<typeof itemStatusBatchSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;
export type SettlementInput = z.infer<typeof settlementSchema>;
export type MemberDatesInput = z.infer<typeof memberDatesSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type CreatePostInput = z.input<typeof createPostSchema>;
export type CreateReportInput = z.infer<typeof createReportSchema>;

// ── Directions ──────────────────────────────────────────────────────────
export const DIRECTIONS_MODES = ["walk", "bike", "car"] as const;
const latLngParam = z
  .string()
  .regex(/^-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?$/, "Use “lat,lng”.")
  .transform((v) => v.split(",").map(Number) as [number, number])
  .refine(([lat, lng]) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180, "That location is out of range.");
export const directionsQuerySchema = z.object({
  from: latLngParam,
  to: latLngParam,
  mode: z.enum(DIRECTIONS_MODES).default("walk"),
});
export type DirectionsQuery = z.infer<typeof directionsQuerySchema>;

/** "Where to now?": the traveller's local date and time (the trip's clock), and where they are if they shared it. */
export const nextQuerySchema = z.object({
  near: latLngParam.optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date."),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use an HH:mm time."),
});
export type NextQuery = z.infer<typeof nextQuerySchema>;
