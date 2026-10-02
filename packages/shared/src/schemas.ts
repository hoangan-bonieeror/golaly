/**
 * Zod schemas shared by the API (request validation) and the web app (forms).
 * One definition → same rules on both sides (spec §41).
 */
import { z } from "zod";

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
  .max(128, "Passwords are limited to 128 characters.");
const isoDate = z.string().regex(ISO_DATE, "Use the format YYYY-MM-DD.");
const hhmm = z.string().regex(HHMM, "Use the format HH:mm.");
const uuid = z.string().uuid();

export const roleSchema = z.enum(["OWNER", "EDITOR", "VIEWER"]);
export const assignableRoleSchema = z.enum(["EDITOR", "VIEWER"]);
export const visibilitySchema = z.enum(["PRIVATE", "LINK_ONLY", "PUBLIC"]);
export const itemTypeSchema = z.enum(["PLACE", "RESTAURANT", "HOTEL", "FLIGHT", "TRANSPORTATION", "ACTIVITY", "NOTE"]);
export const travelerTypeSchema = z.enum(["SOLO", "COUPLE", "FRIENDS", "FAMILY", "ALL"]);
export const interestSchema = z.enum(["FOOD", "NATURE", "BEACH", "CITY", "CULTURE", "ADVENTURE", "SHOPPING", "PHOTOGRAPHY"]);
export const reportTargetSchema = z.enum(["POST", "COMMENT", "USER", "TRIP"]);
export const reportReasonSchema = z.enum(["SPAM", "HARASSMENT", "INAPPROPRIATE", "MISLEADING", "OTHER"]);

const dateRange = <T extends { startDate?: string | null; endDate?: string | null }>(v: T) =>
  !v.startDate || !v.endDate || v.endDate >= v.startDate;
const dateRangeMsg = { message: "End date can't be before the start date.", path: ["endDate"] };

// ── Auth ────────────────────────────────────────────────────────────────
export const registerSchema = z.object({ email: emailSchema, username: usernameSchema, password: passwordSchema });
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
    estimatedBudget: z.number().int().min(0).max(10_000_000).nullable(),
    coverMediaId: uuid.nullable(),
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
});
const timeOrder = (v: { startTime?: string | null; endTime?: string | null }) => !v.startTime || !v.endTime || v.endTime >= v.startTime;
const timeMsg = { message: "End time should be after the start time.", path: ["endTime"] };

export const createItemSchema = itemBase.refine(timeOrder, timeMsg);
export const updateItemSchema = itemBase.partial().refine(timeOrder, timeMsg);
export const reorderItemSchema = z.object({ dayId: uuid, index: z.number().int().min(0).max(10_000) });
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
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type CreatePostInput = z.input<typeof createPostSchema>;
export type CreateReportInput = z.infer<typeof createReportSchema>;
