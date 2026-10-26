"use client";

/**
 * TanStack Query hooks — shared with the app in @golaly/client/react; the web adds hydration safety to `useMe`.
 * <WebClientProvider> (app/providers.tsx) gives them the API client, toasts and the offline overlay.
 */
import { useMe as useMeShared } from "@golaly/client/react";
import { useSyncExternalStore } from "react";

export { keys } from "@golaly/client";
export {
  useAction,
  useCategories,
  useComments,
  useDestination,
  useDestinations,
  useExpenses,
  useExplore,
  useFeed,
  useFollowList,
  useGeoAreas,
  useInvitation,
  useMyTrips,
  useNotifications,
  usePagedList,
  usePlace,
  usePlaceBrowse,
  usePlaceSearch,
  usePost,
  useProfile,
  useSavedPlaces,
  useSavedPosts,
  useSavedTrips,
  useSearch,
  useSuggestions,
  useTrip,
  useTripTargets,
  useUnreadCount,
  useUserPosts,
  useUserTrips,
} from "@golaly/client/react";

const noopSubscribe = () => () => {};
/**
 * False while React is hydrating server HTML, true afterwards (and from the start for anything mounted later).
 * The server never knows who is signed in, so it renders "nobody yet".
 */
export const useHydrated = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

/**
 * The signed-in user, or null when logged out (a 401 is not an error here).
 *
 * While a component is hydrating it always sees "loading, nobody yet" — exactly what the server rendered.
 * Pages are code-split: the app shell hydrates first and starts this request, and if it answers before a page's
 * code has loaded (fast networks, the offline service worker), that page would otherwise hydrate with the user
 * already known and not match the server's HTML (React #418). Anything mounted after hydration gets the data at once.
 */
export function useMe() {
  const hydrated = useHydrated();
  const q = useMeShared();
  return hydrated ? q : ({ ...q, data: undefined, isLoading: true, isPending: true, isSuccess: false, status: "pending" } as typeof q);
}
