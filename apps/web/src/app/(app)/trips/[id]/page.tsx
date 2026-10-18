import { keys } from "@/lib/api/keys";
import { Prefetched } from "@/lib/api/Prefetched";
import { prefetch } from "@/lib/api/server";
import TripView from "./TripView";

/** A trip page — often opened from a shared link. Server-prefetched so the HTML arrives with the content (lib/api/server.ts); the client view does the rest. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Prefetched state={await prefetch([[keys.trip(id), `/trips/${id}`]])}>
      <TripView />
    </Prefetched>
  );
}
