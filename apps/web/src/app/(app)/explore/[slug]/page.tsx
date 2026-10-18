import { keys } from "@/lib/api/keys";
import { Prefetched } from "@/lib/api/Prefetched";
import { prefetch } from "@/lib/api/server";
import DestinationView from "./DestinationView";

/** A destination page. Server-prefetched so the HTML arrives with the content (lib/api/server.ts); the client view does the rest. */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Prefetched state={await prefetch([[keys.destination(slug), `/destinations/${slug}`]])}>
      <DestinationView />
    </Prefetched>
  );
}
