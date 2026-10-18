import { keys } from "@/lib/api/keys";
import { Prefetched } from "@/lib/api/Prefetched";
import { prefetch } from "@/lib/api/server";
import PlaceView from "./PlaceView";

/** A place page. Server-prefetched so the HTML arrives with the content (lib/api/server.ts); the client view does the rest. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Prefetched state={await prefetch([[keys.place(id), `/places/${id}`]])}>
      <PlaceView />
    </Prefetched>
  );
}
