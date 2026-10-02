/**
 * Response shapes returned by /api/v1 — the contract between apps/api and apps/web.
 * Everything here is already filtered for the requesting viewer: private data
 * the viewer may not see is simply absent.
 */
import type { TripAction } from "./permissions";
import type {
  Destination,
  Interest,
  ItineraryItemType,
  NotificationType,
  TravelerType,
  TripRole,
  TripVisibility,
} from "./types";

export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
  avatarHue: number;
  avatarUrl: string | null;
}

export interface Me extends UserSummary {
  email: string;
  bio: string;
  homeBase: string | null;
  travelerType: TravelerType | null;
  interests: Interest[];
  onboarded: boolean;
}

export interface ProfileView {
  user: UserSummary & { bio: string; homeBase: string | null };
  followers: number;
  following: number;
  trips: number;
  followedByMe: boolean;
  isMe: boolean;
}

export interface PlaceView {
  id: string;
  name: string;
  category: ItineraryItemType;
  destinationId: string;
  destinationName: string;
  address: string;
  lat: number;
  lng: number;
  rating: number | null;
  savedByMe: boolean;
}

export interface TripStats {
  days: number;
  items: number;
  places: number;
  travelers: number;
}

export interface TripSummary {
  id: string;
  title: string;
  description: string;
  visibility: TripVisibility;
  cover: [string, string];
  coverUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  destinations: Pick<Destination, "id" | "slug" | "name" | "country">[];
  route: string;
  owner: UserSummary;
  stats: TripStats;
  forkCount: number;
  saveCount: number;
  savedByMe: boolean;
  myRole: TripRole | null;
  allowFork: boolean;
  allowComments: boolean;
  estimatedBudget: number | null;
  forkedFrom: { tripId: string; title: string; ownerUsername: string } | null;
  updatedAt: string;
}

export interface ItemView {
  id: string;
  dayId: string;
  type: ItineraryItemType;
  title: string;
  description: string | null;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  sortOrder: number;
  place: PlaceView | null;
  updatedBy: UserSummary | null;
  updatedAt: string;
}

export interface DayView {
  id: string;
  dayNumber: number;
  date: string | null;
  title: string | null;
  items: ItemView[];
}

export interface MemberView {
  user: UserSummary;
  role: TripRole;
  joinedAt: string;
}

export interface InvitationView {
  id: string;
  email: string | null;
  role: Exclude<TripRole, "OWNER">;
  expiresAt: string;
  createdAt: string;
  invitedBy: UserSummary;
}

export interface TripDetail extends TripSummary {
  days: DayView[];
  members: MemberView[];
  /** Actions the current viewer may perform — UI hints only; the API re-checks every request. */
  permissions: TripAction[];
  /** Only present for the owner. */
  pendingInvitations?: InvitationView[];
}

export interface CreatedInvitation extends InvitationView {
  /** Returned once, at creation. Never stored in plain text. */
  token: string;
  url: string;
}

export interface InvitationLookup {
  status: "valid" | "expired" | "revoked" | "accepted" | "invalid";
  role?: Exclude<TripRole, "OWNER">;
  invitedBy?: UserSummary;
  trip?: Pick<TripSummary, "id" | "title" | "cover" | "coverUrl" | "route" | "startDate" | "endDate"> & { members: UserSummary[] };
  alreadyMember?: boolean;
}

export interface PostView {
  id: string;
  title: string;
  body: string;
  visibility: "PUBLIC" | "FOLLOWERS" | "DRAFT";
  photos: { palette: [string, string]; url: string | null }[];
  author: UserSummary;
  destination: Pick<Destination, "id" | "slug" | "name" | "country"> | null;
  /** Null when the post has no trip OR the viewer can't see it. */
  trip: TripSummary | null;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  savedByMe: boolean;
  createdAt: string;
}

export interface CommentView {
  id: string;
  body: string;
  author: UserSummary;
  createdAt: string;
  canDelete: boolean;
}

export interface NotificationView {
  id: string;
  type: NotificationType;
  text: string;
  actor: UserSummary | null;
  tripId: string | null;
  postId: string | null;
  invitationId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface DestinationView extends Destination {
  tripCount: number;
}

export interface SearchResults {
  trips: TripSummary[];
  places: PlaceView[];
  people: (UserSummary & { homeBase: string | null })[];
  destinations: DestinationView[];
}

export interface DestinationPage {
  destination: Destination;
  popularTrips: TripSummary[];
  remixable: TripSummary[];
  places: PlaceView[];
  posts: PostView[];
}

export interface HomeFeed {
  posts: PostView[];
  nextCursor: string | null;
}

export interface MediaView {
  id: string;
  url: string;
  thumbUrl: string | null;
  width: number;
  height: number;
  mimeType: string;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

/** Error body every API error uses. `message` is always safe to show to users. */
export interface ApiErrorBody {
  statusCode: number;
  message: string;
  fields?: Record<string, string>;
}

/** WebSocket events (spec §31). */
export type TripEventName =
  | "trip.item.created"
  | "trip.item.updated"
  | "trip.item.deleted"
  | "trip.item.reordered"
  | "trip.day.created"
  | "trip.updated"
  | "trip.member.joined"
  | "trip.member.role_changed"
  | "trip.member.removed";

export interface TripEvent {
  tripId: string;
  actorId: string;
  event: TripEventName;
  entityId?: string;
}
