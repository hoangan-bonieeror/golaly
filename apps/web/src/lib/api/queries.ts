"use client";

/**
 * TanStack Query hooks — the only way screens read server state.
 * Keys are centralised so mutations and realtime events can invalidate precisely.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import type {
  CommentView,
  DestinationPage,
  DestinationView,
  HomeFeed,
  InvitationLookup,
  Me,
  NotificationView,
  Paged,
  PlaceView,
  PostView,
  ProfileView,
  SearchResults,
  TripDetail,
  TripSummary,
} from "@triply/shared";
import { useToast } from "../toast";
import { api, ApiError, qs } from "./client";

export const keys = {
  me: ["me"] as const,
  trip: (id: string) => ["trip", id] as const,
  myTrips: (filter: string) => ["trips", "mine", filter] as const,
  savedTrips: ["trips", "saved"] as const,
  feed: (mode: string) => ["feed", mode] as const,
  explore: ["explore"] as const,
  destinations: ["destinations"] as const,
  destination: (slug: string) => ["destination", slug] as const,
  search: (q: string, type: string) => ["search", q, type] as const,
  places: (q: string, tripId?: string) => ["places", q, tripId ?? ""] as const,
  savedPlaces: ["places", "saved"] as const,
  post: (id: string) => ["post", id] as const,
  comments: (id: string) => ["post", id, "comments"] as const,
  savedPosts: ["posts", "saved"] as const,
  profile: (handle: string) => ["profile", handle] as const,
  userTrips: (handle: string) => ["profile", handle, "trips"] as const,
  userPosts: (handle: string) => ["profile", handle, "posts"] as const,
  notifications: ["notifications"] as const,
  unread: ["notifications", "unread"] as const,
  invitation: (by: string) => ["invitation", by] as const,
};

/** The signed-in user, or null when logged out (a 401 is not an error here). */
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
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

export const useTrip = (id: string) => useQuery({ queryKey: keys.trip(id), queryFn: () => api.get<TripDetail>(`/trips/${id}`), retry: false });
export const useMyTrips = (filter = "all", enabled = true) =>
  useQuery({ queryKey: keys.myTrips(filter), queryFn: () => api.get<TripSummary[]>(`/trips${qs({ filter })}`), enabled });
export const useSavedTrips = () => useQuery({ queryKey: keys.savedTrips, queryFn: () => api.get<TripSummary[]>("/trips/saved") });
export const useExplore = () =>
  useQuery({ queryKey: keys.explore, queryFn: () => api.get<{ destinations: DestinationView[]; trips: TripSummary[]; places: PlaceView[] }>("/explore") });
export const useDestinations = () => useQuery({ queryKey: keys.destinations, queryFn: () => api.get<DestinationView[]>("/destinations"), staleTime: 5 * 60_000 });
export const useDestination = (slug: string) => useQuery({ queryKey: keys.destination(slug), queryFn: () => api.get<DestinationPage>(`/destinations/${slug}`), retry: false });
export const useSearch = (q: string, type: string) =>
  useQuery({ queryKey: keys.search(q, type), queryFn: () => api.get<SearchResults>(`/search${qs({ q, type, limit: 30 })}`), placeholderData: (prev) => prev });
export const usePlaceSearch = (q: string, tripId?: string) =>
  useQuery({ queryKey: keys.places(q, tripId), queryFn: () => api.get<PlaceView[]>(`/places/search${qs({ q, tripId, limit: 8 })}`), placeholderData: (prev) => prev });
export const useSavedPlaces = () => useQuery({ queryKey: keys.savedPlaces, queryFn: () => api.get<PlaceView[]>("/places/saved") });
export const usePost = (id: string) => useQuery({ queryKey: keys.post(id), queryFn: () => api.get<PostView>(`/posts/${id}`), retry: false });
export const useComments = (id: string) => useQuery({ queryKey: keys.comments(id), queryFn: () => api.get<CommentView[]>(`/posts/${id}/comments`) });
export const useSavedPosts = () => useQuery({ queryKey: keys.savedPosts, queryFn: () => api.get<PostView[]>("/posts/saved") });
export const useProfile = (handle: string) => useQuery({ queryKey: keys.profile(handle), queryFn: () => api.get<ProfileView>(`/users/${handle}`), retry: false });
export const useUserTrips = (handle: string) => useQuery({ queryKey: keys.userTrips(handle), queryFn: () => api.get<TripSummary[]>(`/users/${handle}/trips`) });
export const useUserPosts = (handle: string) => useQuery({ queryKey: keys.userPosts(handle), queryFn: () => api.get<PostView[]>(`/users/${handle}/posts`) });
export const useUnreadCount = (enabled: boolean) =>
  useQuery({ queryKey: keys.unread, queryFn: () => api.get<{ count: number }>("/notifications/unread-count").then((r) => r.count), enabled, refetchInterval: 60_000 });
export const useInvitation = (by: { token: string } | { id: string }) =>
  useQuery({
    queryKey: keys.invitation("token" in by ? by.token : by.id),
    queryFn: () => api.get<InvitationLookup>("token" in by ? `/invitations/${encodeURIComponent(by.token)}` : `/invitations/id/${by.id}`),
    retry: false,
  });

export function useFeed(mode: "for-you" | "following") {
  return useInfiniteQuery({
    queryKey: keys.feed(mode),
    queryFn: ({ pageParam }) => api.get<HomeFeed>(`/feed${qs({ mode, cursor: pageParam, limit: 10 })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: keys.notifications,
    queryFn: ({ pageParam }) => api.get<Paged<NotificationView>>(`/notifications${qs({ cursor: pageParam, limit: 30 })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/**
 * Mutation helper: shows the API's friendly error as a toast, optional success toast,
 * and invalidates the given query keys (prefix match).
 */
export function useAction<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  opts: { invalidate?: QueryKey[] | ((args: TArgs, result: TResult) => QueryKey[]); success?: string | ((result: TResult) => string | null); silentErrors?: boolean } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: fn,
    onSuccess: async (result, args) => {
      const list = typeof opts.invalidate === "function" ? opts.invalidate(args, result) : opts.invalidate ?? [];
      await Promise.all(list.map((queryKey) => qc.invalidateQueries({ queryKey })));
      const msg = typeof opts.success === "function" ? opts.success(result) : opts.success;
      if (msg) toast(msg);
    },
    onError: (e) => {
      if (!opts.silentErrors) toast(e instanceof ApiError ? e.message : "Something went wrong. Please try again.", "error");
    },
  });
  return {
    ...m,
    /** Resolves to the result, or undefined if the call failed (error already toasted). */
    run: (args: TArgs) => m.mutateAsync(args).catch(() => undefined),
  };
}
