"use client";

/**
 * TanStack Query hooks for the Golaly API — the only way screens read server state, on the web and in the app.
 * They take the API client and the few platform-specific pieces (toasts, offline overlays) from <ClientProvider>.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { localizeMessage, type Locale } from "@golaly/shared";
import type {
  CategoryView,
  GeoAreaOption,
  CommentView,
  DestinationPage,
  DestinationView,
  ExpensesView,
  FollowListItem,
  HomeFeed,
  InvitationLookup,
  Me,
  NotificationView,
  Paged,
  PlaceBrowse,
  PlaceDetail,
  PlaceView,
  PostView,
  ProfileView,
  SearchResults,
  SearchSuggestions,
  TripDetail,
  TripSummary,
  TripTarget,
} from "@golaly/shared";
import { ApiError, GENERIC_ERROR } from "./errors";
import type { Api } from "./http";
import { keys } from "./keys";
import { qs } from "./qs";

export interface ClientContextValue {
  api: Api;
  /** Interface language, for messages made on the client (e.g. the generic error). */
  getLocale: () => Locale;
  /** Show a short message (a toast on the web, a snackbar in the app). */
  notify: (message: string, kind?: "error") => void;
  /** False when this device has certainly never signed in: `useMe` then skips the request. Defaults to true. */
  mightBeSignedIn?: () => boolean;
  /** Post-process a loaded trip (the web overlays marks queued offline). Defaults to as-is. */
  selectTrip?: (trip: TripDetail) => TripDetail;
}

const ClientContext = createContext<ClientContextValue | null>(null);

export function ClientProvider({ value, children }: { value: ClientContextValue; children: React.ReactNode }) {
  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}

export function useClient(): ClientContextValue & { selectTrip: (trip: TripDetail) => TripDetail } {
  const c = useContext(ClientContext);
  if (!c) throw new Error("Golaly hooks need a <ClientProvider> above them");
  return { ...c, selectTrip: c.selectTrip ?? identity };
}
const identity = <T,>(x: T) => x;

/** The signed-in user, or null when logged out (a 401 is not an error here). */
export function useMe() {
  const { api, mightBeSignedIn } = useClient();
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      // A device that has never signed in: no need to ask (or to try a refresh) on every screen.
      if (mightBeSignedIn && !mightBeSignedIn()) return null;
      try {
        return await api.get<Me>("/users/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export const useExpenses = (tripId: string, enabled = true) => {
  const { api } = useClient();
  return useQuery({ queryKey: keys.expenses(tripId), queryFn: () => api.get<ExpensesView>(`/trips/${tripId}/expenses`), enabled, retry: false });
};
/** A trip, passed through the platform's `selectTrip` (the web overlays went/skipped marks still waiting to sync). */
export const useTrip = (id: string, enabled = true) => {
  const { api, selectTrip } = useClient();
  return useQuery({ queryKey: keys.trip(id), queryFn: () => api.get<TripDetail>(`/trips/${id}`), retry: false, enabled, select: selectTrip });
};
/**
 * Cursor-paginated list ("Load more"). `items` is every page loaded so far, flattened.
 * The API returns `{ items, nextCursor }` for all list endpoints that can grow without bound.
 */
export function usePagedList<T>(queryKey: QueryKey, path: string, params: Record<string, string | number | undefined> = {}, enabled = true) {
  const { api } = useClient();
  const q = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => api.get<Paged<T>>(`${path}${qs({ ...params, cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.items) };
}

export const useMyTrips = (filter = "all", enabled = true) => {
  return usePagedList<TripSummary>(keys.myTrips(filter), "/trips", { filter, limit: 24 }, enabled);
};
export const useSavedTrips = () => {
  return usePagedList<TripSummary>(keys.savedTrips, "/trips/saved", { limit: 24 });
};
export const useExplore = () => {
  const { api } = useClient();
  return useQuery({ queryKey: keys.explore, queryFn: () => api.get<{ destinations: DestinationView[]; trips: TripSummary[]; places: PlaceView[] }>("/explore") });
};
export const useDestinations = () => {
  const { api } = useClient();
  return useQuery({ queryKey: keys.destinations, queryFn: () => api.get<DestinationView[]>("/destinations"), staleTime: 5 * 60_000 });
};
export const useDestination = (slug: string) => {
  const { api } = useClient();
  return useQuery({ queryKey: keys.destination(slug), queryFn: () => api.get<DestinationPage>(`/destinations/${slug}`), retry: false });
};
/** Type-ahead under the navbar search: keeps the previous list while the next one loads, so it doesn't flicker. */
export const useSuggestions = (q: string) => {
  const { api } = useClient();
  return useQuery({
    queryKey: keys.suggest(q),
    queryFn: ({ signal }) => api.get<SearchSuggestions>(`/search/suggest${qs({ q })}`, signal),
    enabled: q.length >= 2,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
};
export const useSearch = (q: string, type: string, enabled = true) => {
  const { api } = useClient();
  return useQuery({ queryKey: keys.search(q, type), queryFn: () => api.get<SearchResults>(`/search${qs({ q, type, limit: 30 })}`), placeholderData: (prev) => prev, enabled });
};
export const usePlaceSearch = (q: string, tripId?: string) => {
  const { api } = useClient();
  return useQuery({ queryKey: keys.places(q, tripId), queryFn: () => api.get<PlaceView[]>(`/places/search${qs({ q, tripId, limit: 8 })}`), placeholderData: (prev) => prev });
};
export const useCategories = () => {
  const { api } = useClient();
  return useQuery({ queryKey: keys.categories, queryFn: () => api.get<CategoryView[]>("/places/categories"), staleTime: 30 * 60_000 });
};
export const useGeoAreas = () => {
  const { api } = useClient();
  return useQuery({ queryKey: keys.geoAreas, queryFn: () => api.get<GeoAreaOption[]>("/places/areas"), staleTime: 30 * 60_000 });
};
export const usePlace = (id: string) => {
  const { api } = useClient();
  return useQuery({ queryKey: keys.place(id), queryFn: () => api.get<PlaceDetail>(`/places/${id}`), retry: false });
};
export const useTripTargets = (placeId: string, enabled: boolean) => {
  const { api } = useClient();
  return useQuery({ queryKey: keys.tripTargets(placeId), queryFn: () => api.get<TripTarget[]>(`/places/${placeId}/trip-targets`), enabled });
};

/** Explore → Places. Pages are offset-based; `meta` is the first page's area/facets/total. */
export function usePlaceBrowse(params: Record<string, string | number | undefined>, enabled = true) {
  const { api } = useClient();
  const q = useInfiniteQuery({
    queryKey: keys.placeBrowse(params),
    queryFn: ({ pageParam }) => api.get<PlaceBrowse>(`/places/browse${qs({ ...params, cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: (prev) => prev,
    enabled,
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.items), meta: q.data?.pages[0] };
}
export const useSavedPlaces = () => {
  const { api } = useClient();
  return useQuery({ queryKey: keys.savedPlaces, queryFn: () => api.get<PlaceView[]>("/places/saved") });
};
export const usePost = (id: string) => {
  const { api } = useClient();
  return useQuery({ queryKey: keys.post(id), queryFn: () => api.get<PostView>(`/posts/${id}`), retry: false });
};
export const useComments = (id: string) => {
  return usePagedList<CommentView>(keys.comments(id), `/posts/${id}/comments`, { limit: 50 });
};
export const useSavedPosts = () => {
  return usePagedList<PostView>(keys.savedPosts, "/posts/saved", { limit: 20 });
};
export const useProfile = (handle: string) => {
  const { api } = useClient();
  return useQuery({ queryKey: keys.profile(handle), queryFn: () => api.get<ProfileView>(`/users/${handle}`), retry: false });
};
export const useUserTrips = (handle: string) => {
  const { api } = useClient();
  return useQuery({ queryKey: keys.userTrips(handle), queryFn: () => api.get<TripSummary[]>(`/users/${handle}/trips`) });
};
export const useUserPosts = (handle: string) => {
  const { api } = useClient();
  return useQuery({ queryKey: keys.userPosts(handle), queryFn: () => api.get<PostView[]>(`/users/${handle}/posts`) });
};
export const useFollowList = (handle: string, which: "followers" | "following" | null) => {
  const { api } = useClient();
  return useQuery({ queryKey: keys.follows(handle, which ?? ""), queryFn: () => api.get<FollowListItem[]>(`/users/${handle}/${which}`), enabled: !!which });
};
export const useUnreadCount = (enabled: boolean) => {
  const { api } = useClient();
  return useQuery({ queryKey: keys.unread, queryFn: () => api.get<{ count: number }>("/notifications/unread-count").then((r) => r.count), enabled, refetchInterval: 60_000 });
};
export const useInvitation = (by: { token: string } | { id: string }) => {
  const { api } = useClient();
  return useQuery({
    queryKey: keys.invitation("token" in by ? by.token : by.id),
    queryFn: () => api.get<InvitationLookup>("token" in by ? `/invitations/${encodeURIComponent(by.token)}` : `/invitations/id/${by.id}`),
    retry: false,
  });
};

export function useFeed(mode: "for-you" | "following") {
  const { api } = useClient();
  return useInfiniteQuery({
    queryKey: keys.feed(mode),
    queryFn: ({ pageParam }) => api.get<HomeFeed>(`/feed${qs({ mode, cursor: pageParam, limit: 10 })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useNotifications() {
  const { api } = useClient();
  return useInfiniteQuery({
    queryKey: keys.notifications,
    queryFn: ({ pageParam }) => api.get<Paged<NotificationView>>(`/notifications${qs({ cursor: pageParam, limit: 30 })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/**
 * Mutation helper: shows the API's friendly error via `notify`, an optional success message,
 * and invalidates the given query keys (prefix match).
 */
export function useAction<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  opts: { invalidate?: QueryKey[] | ((args: TArgs, result: TResult) => QueryKey[]); success?: string | ((result: TResult) => string | null); silentErrors?: boolean } = {},
) {
  const qc = useQueryClient();
  const { notify, getLocale } = useClient();
  const m = useMutation({
    mutationFn: fn,
    onSuccess: async (result, args) => {
      const list = typeof opts.invalidate === "function" ? opts.invalidate(args, result) : opts.invalidate ?? [];
      await Promise.all(list.map((queryKey) => qc.invalidateQueries({ queryKey })));
      const msg = typeof opts.success === "function" ? opts.success(result) : opts.success;
      if (msg) notify(msg);
    },
    onError: (e) => {
      if (!opts.silentErrors) notify(e instanceof ApiError ? e.message : localizeMessage(GENERIC_ERROR, getLocale()), "error");
    },
  });
  return {
    ...m,
    /** Resolves to the result, or undefined if the call failed (error already shown). */
    run: (args: TArgs) => m.mutateAsync(args).catch(() => undefined),
  };
}
