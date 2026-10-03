"use client";

import { Search, SearchX } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PlaceBrowser } from "@/components/place/PlaceBrowser";
import { PlaceRow } from "@/components/social/PlaceRow";
import { DestinationTile } from "@/components/trip/DestinationTile";
import { TripCard } from "@/components/trip/TripCard";
import { Avatar, Chip, EmptyState, ErrorState, PageLoader, SectionTitle, Skeleton, cx, inputCls } from "@/components/ui";
import { useSearch } from "@/lib/api/queries";
import { useRecentSearches } from "@/lib/recentSearches";
import { useDebounced } from "@/lib/hooks";

const CATS = [
  ["Everything", "all"],
  ["Trips", "trips"],
  ["Places", "places"],
  ["People", "people"],
  ["Destinations", "destinations"],
] as const;
type Cat = (typeof CATS)[number][1];

export default function ExplorePage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense fallback={<PageLoader />}>
      <Explore />
    </Suspense>
  );
}

function Explore() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(params.get("q") ?? "");
  // The tab is in the URL so links like /explore?tab=places&dest=hoi-an open the place browser.
  const tab = params.get("tab");
  const cat: Cat = CATS.some(([, v]) => v === tab) ? (tab as Cat) : "all";
  const setCat = (c: Cat) => {
    const next = new URLSearchParams(c === "places" ? params.toString() : "");
    if (c === "all") next.delete("tab");
    else next.set("tab", c);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  const dq = useDebounced(q.trim(), 250);
  // Recent searches are a per-device convenience (browser storage), not account data.
  const { recent, remember, clear } = useRecentSearches();
  useEffect(() => {
    if (dq.length < 2) return;
    const t = setTimeout(() => remember(dq), 1200);
    return () => clearTimeout(t);
    // `remember` is a stable module function in practice; only a new query should restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  const browsing = cat === "places";
  const res = useSearch(dq, cat, !browsing);
  const r = res.data;
  const show = (c: Cat) => cat === "all" || cat === c;
  const total = r ? r.trips.length + r.places.length + r.people.length + r.destinations.length : 0;

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <h1 className="font-display text-3xl font-semibold md:text-4xl">Explore</h1>
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" />
          <input
            className={cx(inputCls, "h-12 rounded-full pl-12 text-base")}
            placeholder="Search trips, places, people — try “hoi an” or “tokio”"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
            type="search"
            maxLength={100}
          />
        </div>
        {!q && recent.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Recent:</span>
            {recent.map((r) => (
              <button key={r} onClick={() => setQ(r)} className="min-h-9 rounded-full bg-sand-2 px-3 py-1 text-ink-2 hover:bg-line">
                {r}
              </button>
            ))}
            <button onClick={clear} className="min-h-11 px-1 text-xs text-muted underline-offset-2 hover:underline" aria-label="Clear recent searches">
              Clear
            </button>
          </div>
        )}
        <p className="sr-only" aria-live="polite">
          {r && dq && !browsing ? `${total} results for ${dq}` : ""}
        </p>
        <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
          {CATS.map(([label, value]) => (
            <Chip key={value} active={cat === value} onClick={() => setCat(value)} className="shrink-0">
              {label}
            </Chip>
          ))}
        </div>
      </header>

      {browsing && <PlaceBrowser q={dq} />}

      {!browsing && res.isLoading && <Skeleton className="h-64" />}
      {!browsing && res.isError && <ErrorState error={res.error} onRetry={() => res.refetch()} />}
      {!browsing && r && total === 0 && <EmptyState icon={<SearchX className="size-7" />} title={`No results for “${dq}”`} body="Try a city, a country or a traveler's name. Accents and small typos are fine — “hoi an” or “tokio” work too." />}

      {!browsing && r && show("destinations") && r.destinations.length > 0 && (
        <section>
          <SectionTitle>Destinations</SectionTitle>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {(cat === "all" && !dq ? r.destinations.slice(0, 6) : r.destinations).map((d) => (
              <DestinationTile key={d.id} dest={d} count={d.tripCount} />
            ))}
          </div>
        </section>
      )}

      {!browsing && r && show("trips") && r.trips.length > 0 && (
        <section>
          <SectionTitle>{dq ? "Trips" : "Popular public trips"}</SectionTitle>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {r.trips.map((t) => (
              <TripCard key={t.id} trip={t} />
            ))}
          </div>
        </section>
      )}

      {!browsing && r && show("places") && r.places.length > 0 && (
        <section>
          <SectionTitle
            action={
              <button type="button" onClick={() => setCat("places")} className="min-h-11 text-sm font-semibold text-primary hover:underline">
                Browse all places
              </button>
            }
          >
            Places
          </SectionTitle>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {(cat === "all" ? r.places.slice(0, 6) : r.places).map((p) => (
              <PlaceRow key={p.id} place={p} />
            ))}
          </div>
        </section>
      )}

      {!browsing && r && show("people") && r.people.length > 0 && (
        <section>
          <SectionTitle>Travelers</SectionTitle>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {(cat === "all" ? r.people.slice(0, 6) : r.people).map((u) => (
              <Link key={u.id} href={`/u/${u.username}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 hover:border-ink-2">
                <Avatar user={u} size={44} />
                <div className="min-w-0">
                  <div className="font-semibold">{u.displayName}</div>
                  <div className="truncate text-xs text-muted">
                    @{u.username}
                    {u.homeBase && ` · ${u.homeBase}`}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
