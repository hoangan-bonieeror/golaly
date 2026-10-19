import type { Locale } from "./i18n";
/**
 * Response shapes returned by /api/v1 — the contract between apps/api and apps/web.
 * Everything here is already filtered for the requesting viewer: private data
 * the viewer may not see is simply absent.
 */
import type { TripAction } from "./permissions";
import type { OpenState } from "./opening-hours";
import type {
  Destination,
  Interest,
  ItemSlot,
  ItemStatus,
  ItineraryItemType,
  NotificationType,
  TravelerType,
  TripRole,
  TripVisibility,
  VoteLevel,
  ExpenseCategory,
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
  /** False until the user opens the confirmation link (Google sign-in counts as verified). */
  emailVerified: boolean;
  bio: string;
  homeBase: string | null;
  travelerType: TravelerType | null;
  interests: Interest[];
  onboarded: boolean;
  /** False for accounts created with Google that haven't set a password yet. */
  hasPassword: boolean;
  providers: string[];
  /** Can moderate place photos (users.role = ADMIN). */
  isAdmin: boolean;
  /** Interface language chosen in the app (null = never chosen; the device language is used). */
  locale: Locale | null;
  /** Opted in to their trip activity improving planning suggestions (off by default). */
  analyticsConsent: boolean;
}

export interface ProfileView {
  user: UserSummary & { bio: string; homeBase: string | null; travelerType: TravelerType | null; interests: Interest[]; joinedAt: string };
  followers: number;
  following: number;
  trips: number;
  /** Distinct countries across the trips this viewer can see. */
  countries: number;
  followedByMe: boolean;
  /** The profile owner follows the viewer. */
  followsMe: boolean;
  isMe: boolean;
}

export interface FollowListItem extends UserSummary {
  homeBase: string | null;
  followedByMe: boolean;
  isMe: boolean;
}

export interface PlaceView {
  id: string;
  /** In the viewer's language (Accept-Language) when the place has a name in it, else the local name. */
  name: string;
  /** The on-the-ground name when `name` is a translation ("Chùa Cầu" under "Japanese Covered Bridge"); else null. */
  localName: string | null;
  category: ItineraryItemType;
  /** null for imported places outside any curated destination; destinationName then names their area. */
  destinationId: string | null;
  destinationName: string;
  /** The smallest administrative area the place is in (district / city), when known — names areas on the pool. */
  areaName: string | null;
  address: string;
  lat: number;
  lng: number;
  rating: number | null;
  /** CLOSED places stay visible inside existing itineraries but can't be added again. */
  status: "ACTIVE" | "CLOSED" | "HIDDEN";
  savedByMe: boolean;
  /** TRIPLY taxonomy key, e.g. "drink.cafe" (null only for legacy rows). The group is the part before the dot. */
  categoryKey: string | null;
  /** Human label of that category ("Café"); falls back to the item type label. */
  categoryLabel: string;
  /** OpenStreetMap opening_hours syntax, e.g. "Mo-Su 07:00-22:00" (for "open now"). */
  openingHours: string | null;
  /** Metres from the search centre, when the list was searched around a point. */
  distanceM?: number;
  /** The place's best approved photo (null → show the category icon), with its one-line credit. */
  photo: (ImageView & { credit: string }) | null;
}

/**
 * A photo on a place page. `credit` is what the licence requires next to the image: for imported
 * photos the title, author, licence and source (each linked when known); for user photos, the uploader.
 */
export interface PlacePhotoView {
  id: string;
  image: ImageView;
  source: "user" | "wikimedia" | (string & {});
  caption: string | null;
  status: "PENDING" | "APPROVED" | "HIDDEN";
  /** The viewer uploaded it (may remove it; sees it while it's pending). */
  mine: boolean;
  uploader: UserSummary | null;
  credit: {
    text: string;
    title: string | null;
    author: string | null;
    authorUrl: string | null;
    license: string | null;
    licenseUrl: string | null;
    sourceName: string;
    sourceUrl: string | null;
  };
  createdAt: string;
}

/** A photo in the moderation queue, with where it is and who sent it. */
export interface ModerationPhoto extends PlacePhotoView {
  place: { id: string; name: string; destinationName: string };
  reportCount: number;
}

/** One node of the place taxonomy: a group ("food") or a category inside it ("food.street_food"). */
export interface CategoryView {
  key: string;
  label: string;
  labelVi: string;
  itemType: ItineraryItemType;
  children?: CategoryView[];
}

/** A country, province or city places can be filtered by (from the imported administrative boundaries). */
export interface GeoAreaOption {
  slug: string;
  /** Official name, e.g. "Thành phố Đà Nẵng". */
  name: string;
  /** Without the type prefix, e.g. "Đà Nẵng". */
  shortName: string;
  /** English name shown in pickers: the destination that stands for it ("Da Nang", "Hanoi"), or the English
   *  name for countries ("Vietnam"); falls back to `shortName`. */
  displayName: string;
  /** "city" / "province" when the name says so (Vietnam), otherwise the boundary level. */
  kind: "country" | "city" | "province" | "region";
  countryCode: string;
  /** Parent area's slug (a province's country); null for countries. */
  parentSlug: string | null;
  /** Visible places inside, at any depth. */
  placeCount: number;
}

/** Explore → Places: a page of results plus what the filters were resolved to. */
export interface PlaceBrowse extends Paged<PlaceView> {
  /** The point results are measured from (a destination, the device, or none for a global list). */
  center: { lat: number; lng: number; label: string } | null;
  /** The province/city/country filter, when one is set. */
  area: { slug: string; name: string } | null;
  radiusKm: number | null;
  /** Places per category group inside the same area + text filter (ignores the group filter), for the chips. */
  facets: { key: string; count: number }[];
  total: number;
  /** True when a very broad text query was ranked on a sample: `total` and the facets are lower bounds ("1,500+"). */
  totalIsEstimate?: boolean;
}

export interface PlaceDetail extends PlaceView {
  phone: string | null;
  website: string | null;
  groupKey: string | null;
  groupLabel: string | null;
  destinationSlug: string | null;
  areaName: string | null;
  /** The place's name in other languages (BCP 47 tag → name), from imported sources. */
  names: { lang: string; name: string }[];
  /** Licence credits required by the data sources this place was built from. */
  attribution: string[];
  /** Approved photos, best first, plus the viewer's own pending ones (marked). */
  photos: PlacePhotoView[];
  nearby: PlaceView[];
  /** Public trips that include this place (most saved first) and how many there are in total. */
  inTrips: TripSummary[];
  tripCount: number;
  /** Public trips whose group marked this place as visited / skipped (after the trip). */
  visits: { visited: number; skipped: number };
}

/** A trip the viewer may add items to, as offered by "Add to trip". */
export interface TripTarget {
  id: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  role: "OWNER" | "EDITOR";
  destinations: string[];
  cover: [string, string];
  days: { id: string; dayNumber: number; date: string | null; title: string | null; itemCount: number; hasPlace: boolean }[];
  /** One of the trip's destinations is within 50 km of the place: offered first. */
  nearby: boolean;
}

/** An uploaded image in three widths: thumb (640px), url (1280px), fullUrl (≤2400px). */
export interface ImageView {
  url: string;
  thumbUrl: string;
  fullUrl: string;
  /** Average colour, used as a placeholder while loading. */
  color: string | null;
  width: number;
  height: number;
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
  coverImage: ImageView | null;
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
  /** ISO 4217 code expenses are kept in. */
  currency: string;
  outcome: TripOutcome | null;
  forkedFrom: { tripId: string; title: string; ownerUsername: string } | null;
  updatedAt: string;
}

export interface ItemPhotoView {
  id: string;
  image: ImageView;
  /** null for people outside the trip unless the uploader is its owner (members stay private). */
  uploadedBy: UserSummary | null;
  createdAt: string;
}

export interface ItemEvidence {
  status: ItemStatus;
  /** Members of the original trip who really wanted it. */
  loves: number;
  votes: number;
}

/** How a trip actually went: counts over its planned stops (places). null until someone marks one. */
export interface TripOutcome {
  planned: number;
  visited: number;
  skipped: number;
}

export interface ItemVoteView {
  userId: string;
  level: VoteLevel;
}

export interface ItemView {
  id: string;
  tripId: string;
  /** null = in the trip's place pool. */
  dayId: string | null;
  /** Part of the day (ANY = whenever). Items with a startTime are anchors and keep their clock time. */
  slot: ItemSlot;
  status: ItemStatus;
  /** Members' interest, one vote per member. */
  votes: ItemVoteView[];
  /** Who put it on the trip. */
  addedBy: UserSummary | null;
  /** The trip's own photos of this stop (memories for the recap). */
  photos: ItemPhotoView[];
  /**
   * For a remixed trip: what the original group did at this stop, while the original is still
   * public or link-shared. Counts only — never who.
   */
  evidence: ItemEvidence | null;
  /** Who goes there when the group splits up (user ids); empty = everyone. */
  assignees: string[];
  /** Where the group meets again after splitting up. */
  meetup: boolean;
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
  /** The part of the trip they're there for (inclusive); null = from the start / to the end. */
  arriveOn: string | null;
  leaveOn: string | null;
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
  /** Places the group wants to fit in somewhere, not yet on a day. */
  pool: ItemView[];
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
  photos: { palette: [string, string]; url: string | null; image: ImageView | null }[];
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
  /** The sentence after the actor's name, in the reader's language. */
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
  /** "curated" (hand-picked, e.g. Hội An) or "area" (created for a whole province/city by the catalog import). */
  kind: "curated" | "area";
}

export interface SearchResults {
  trips: TripSummary[];
  places: PlaceView[];
  people: (UserSummary & { homeBase: string | null })[];
  destinations: DestinationView[];
}

/** Type-ahead under the search field: the best few places and destinations for what's typed so far. */
export interface SearchSuggestions {
  places: PlaceView[];
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

export interface MediaView extends ImageView {
  id: string;
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
  | "trip.item.voted"
  | "trip.day.created"
  | "trip.updated"
  | "trip.member.joined"
  | "trip.member.role_changed"
  | "trip.member.removed"
  | "trip.member.updated"
  | "trip.expenses.updated";

export interface TripEvent {
  tripId: string;
  actorId: string;
  event: TripEventName;
  entityId?: string;
}

/**
 * Who has the trip open right now (`trip.presence`, sent to the trip room whenever it changes).
 * `editingDay` is the day a member has an item editor open on, or null while they're just looking.
 */
export interface TripPresence {
  tripId: string;
  users: { userId: string; editingDay: number | null }[];
}

/** A route from the viewer's position to a stop (`GET /directions`, OpenRouteService behind the API). */
export type DirectionsMode = "walk" | "bike" | "car";
export interface DirectionsView {
  mode: DirectionsMode;
  distanceM: number;
  durationS: number;
  /** [lng, lat] pairs, GeoJSON order. */
  geometry: [number, number][];
  attribution: string;
}

// ── Expenses (members only) ───────────────────────────────────────────────
/** Amounts are integers of the trip currency's smallest unit (`digits` decimal places). */
export interface ExpenseView {
  id: string;
  description: string;
  amount: number;
  category: ExpenseCategory;
  paidBy: UserSummary;
  spentOn: string | null;
  item: { id: string; title: string } | null;
  shares: { user: UserSummary; amount: number }[];
  createdBy: UserSummary;
  createdAt: string;
  /** The viewer may edit or delete it (who added it, who paid, or the trip owner). */
  canEdit: boolean;
}

export interface SettlementView {
  id: string;
  from: UserSummary;
  to: UserSummary;
  amount: number;
  createdBy: UserSummary;
  createdAt: string;
  canDelete: boolean;
}

export interface ExpensesView {
  currency: string;
  digits: number;
  expenses: ExpenseView[];
  settlements: SettlementView[];
  /** Per person: paid, their shares, and the difference (+ = is owed money). */
  balances: { user: UserSummary; paid: number; owed: number; net: number }[];
  /** The fewest repayments that settle everyone up. */
  transfers: { from: UserSummary; to: UserSummary; amount: number }[];
  total: number;
  byCategory: { category: ExpenseCategory; amount: number }[];
  /** Spending per day of the trip (expenses with a date). */
  byDay: { date: string; amount: number }[];
  /** The trip's estimated budget PER PERSON, in whole currency units (as entered in Trip settings). */
  budget: number | null;
  /** The currency is fixed: the trip already has expenses or repayments. */
  currencyLocked: boolean;
}

// ── During the trip (phase 2) ──────────────────────────────────────────

/** One answer to "Where to now?": a stop from the plan or the ideas, or a place nearby that isn't in the trip. */
export interface NextCandidate {
  item: { id: string; title: string; dayId: string | null; slot: ItemSlot; startTime: string | null } | null;
  place: PlaceView;
  /** Straight-line metres from the traveller (null without their location). */
  distanceM: number | null;
  /** Estimated walk (≈ 1.3 × straight line at 4.8 km/h), minutes. */
  walkMin: number | null;
  open: OpenState;
}
export interface NextSuggestions {
  date: string;
  /** The part of the day it is now (from the traveller's clock). */
  slot: ItemSlot;
  /** Today's day of the trip, if it has one. */
  dayId: string | null;
  located: boolean;
  /** What's left today, best first (open, close by). */
  plan: NextCandidate[];
  pool: NextCandidate[];
  /** Well-rated places within walking distance that aren't in the trip and aren't closed. */
  nearby: NextCandidate[];
}
