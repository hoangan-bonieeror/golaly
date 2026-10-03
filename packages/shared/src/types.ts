/**
 * TRIPLY shared domain types.
 * These mirror the planned PostgreSQL/Prisma schema (spec §24–26) so the
 * prototype's mock layer and the future NestJS API speak the same language.
 * Public identifiers are UUID-like strings — never sequential IDs.
 */

export type UUID = string;
export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string;

export type TripVisibility = "PRIVATE" | "LINK_ONLY" | "PUBLIC";
export type TripRole = "OWNER" | "EDITOR" | "VIEWER";

export type ItineraryItemType =
  | "PLACE"
  | "RESTAURANT"
  | "HOTEL"
  | "FLIGHT"
  | "TRANSPORTATION"
  | "ACTIVITY"
  | "NOTE";

export type TravelerType = "SOLO" | "COUPLE" | "FRIENDS" | "FAMILY" | "ALL";
export type Interest =
  | "FOOD"
  | "NATURE"
  | "BEACH"
  | "CITY"
  | "CULTURE"
  | "ADVENTURE"
  | "SHOPPING"
  | "PHOTOGRAPHY";

export interface User {
  id: UUID;
  username: string;
  displayName: string;
  bio: string;
  avatarHue: number; // prototype stand-in for avatar media
  homeBase?: string;
  travelerType?: TravelerType;
  interests?: Interest[];
}

export interface Destination {
  id: UUID;
  slug: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  blurb: string;
  palette: [string, string]; // cover art colors (prototype)
}

export interface Place {
  id: UUID;
  name: string;
  category: ItineraryItemType;
  destinationId: UUID;
  address: string;
  lat: number;
  lng: number;
  rating?: number;
}

export interface ItineraryItem {
  id: UUID;
  dayId: UUID;
  type: ItineraryItemType;
  title: string;
  description?: string;
  placeId?: UUID;
  startTime?: string; // HH:mm
  endTime?: string;
  notes?: string;
  sortOrder: number;
  updatedBy?: UUID;
  updatedAt?: ISODateTime;
}

export interface TripDay {
  id: UUID;
  tripId: UUID;
  dayNumber: number;
  date?: ISODate;
  title?: string;
}

export interface TripMember {
  tripId: UUID;
  userId: UUID;
  role: TripRole;
  joinedAt: ISODateTime;
}

export interface TripInvitation {
  id: UUID;
  tripId: UUID;
  email?: string;
  role: Exclude<TripRole, "OWNER">;
  /** Opaque, unguessable token. Never log it. Never expose internal IDs. */
  token: string;
  expiresAt: ISODateTime;
  revokedAt?: ISODateTime;
  acceptedAt?: ISODateTime;
  invitedBy: UUID;
}

export interface ForkAttribution {
  sourceTripId: UUID;
  sourceTripTitle: string;
  sourceOwnerId: UUID;
  sourceOwnerUsername: string;
}

export interface Trip {
  id: UUID;
  ownerId: UUID;
  title: string;
  description: string;
  destinationIds: UUID[];
  startDate?: ISODate;
  endDate?: ISODate;
  visibility: TripVisibility;
  allowComments: boolean;
  allowFork: boolean;
  estimatedBudget?: number;
  currency?: string;
  cover: [string, string];
  forkedFrom?: ForkAttribution;
  forkCount: number;
  saveCount: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt?: ISODateTime;
}

export interface Post {
  id: UUID;
  userId: UUID;
  tripId?: UUID;
  destinationId?: UUID;
  title: string;
  body: string;
  photos: [string, string][]; // prototype: gradient pairs instead of media URLs
  visibility: "PUBLIC" | "FOLLOWERS" | "DRAFT";
  likeCount: number;
  commentCount: number;
  createdAt: ISODateTime;
}

export interface Comment {
  id: UUID;
  postId: UUID;
  userId: UUID;
  body: string;
  createdAt: ISODateTime;
}

export type NotificationType =
  | "TRIP_INVITE"
  | "TRIP_ITEM_ADDED"
  | "TRIP_ITEM_UPDATED"
  | "TRIP_MEMBER_ROLE_CHANGED"
  | "COMMENT"
  | "LIKE"
  | "FOLLOW"
  | "TRIP_SAVED"
  | "TRIP_FORKED";

export interface Notification {
  id: UUID;
  userId: UUID; // recipient
  actorId: UUID;
  type: NotificationType;
  tripId?: UUID;
  postId?: UUID;
  invitationToken?: string; // only ever shown to the invitee
  text: string;
  readAt?: ISODateTime;
  createdAt: ISODateTime;
}

export type ReportTarget = "POST" | "COMMENT" | "USER" | "TRIP" | "PLACE_PHOTO";
export type ReportReason =
  | "SPAM"
  | "HARASSMENT"
  | "INAPPROPRIATE"
  | "MISLEADING"
  | "OTHER";
