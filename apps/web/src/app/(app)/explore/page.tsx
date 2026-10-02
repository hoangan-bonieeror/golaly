"use client";

import { Search, SearchX } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PlaceRow } from "@/components/social/PlaceRow";
import { DestinationTile } from "@/components/trip/DestinationTile";
import { TripCard } from "@/components/trip/TripCard";
import { Avatar, Chip, EmptyState, ErrorState, SectionTitle, Skeleton, cx, inputCls } from "@/components/ui";
import { useSearch } from "@/lib/api/queries";
import { useDebounced } from "@/lib/hooks";

const CATS = [
  ["Everything", "all"],
  ["Trips", "trips"],
  ["Places", "places"],
  ["People", "people"],
  ["Destinations", "destinations"],
] as const;
type Cat = (typeof CATS)[number][1];

const RECENT_KEY = "triply.recentSearches";
function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]").slice(0, 6);
  } catch {
    return [];
  }
}

export default function ExplorePage() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Cat>("all");
  const dq = useDebounced(q.trim(), 250);
  // Recent searches are a per-device convenience (browser storage), not account data.
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(readRecent()), []);
  useEffect(() => {
    if (dq.length < 2) return;
    const t = setTimeout(() => {
      const next = [dq, ...readRecent().filter((x) => x.toLowerCase() !== dq.toLowerCase())].slice(0, 6);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {}
      setRecent(next);
    }, 1200);
    return () => clearTimeout(t);
  }, [dq]);
  const res = useSearch(dq, cat);
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
              <button key={r} onClick={() => setQ(r)} className="rounded-full bg-sand-2 px-3 py-1 text-ink-2 hover:bg-line">
                {r}
              </button>
            ))}
            <button
              onClick={() => {
                try {
                  localStorage.removeItem(RECENT_KEY);
                } catch {}
                setRecent([]);
              }}
              className="text-xs text-muted underline-offset-2 hover:underline"
            >
              Clear
            </button>
          </div>
        )}
        <p className="sr-only" aria-live="polite">
          {r && dq ? `${total} results for ${dq}` : ""}
        </p>
        <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
          {CATS.map(([label, value]) => (
            <Chip key={value} active={cat === value} onClick={() => setCat(value)} className="shrink-0">
              {label}
            </Chip>
          ))}
        </div>
      </header>

      {res.isLoading && <Skeleton className="h-64" />}
      {res.isError && <ErrorState error={res.error} onRetry={() => res.refetch()} />}
      {r && total === 0 && <EmptyState icon={<SearchX className="size-7" />} title={`No results for “${dq}”`} body="Try a city, a country or a traveler's name. Accents and small typos are fine — “hoi an” or “tokio” work too." />}

      {r && show("destinations") && r.destinations.length > 0 && (
        <section>
          <SectionTitle>Destinations</SectionTitle>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {(cat === "all" && !dq ? r.destinations.slice(0, 6) : r.destinations).map((d) => (
              <DestinationTile key={d.id} dest={d} count={d.tripCount} />
            ))}
          </div>
        </section>
      )}

      {r && show("trips") && r.trips.length > 0 && (
        <section>
          <SectionTitle>{dq ? "Trips" : "Popular public trips"}</SectionTitle>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {r.trips.map((t) => (
              <TripCard key={t.id} trip={t} />
            ))}
          </div>
        </section>
      )}

      {r && show("places") && r.places.length > 0 && (
        <section>
          <SectionTitle>Places</SectionTitle>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {(cat === "all" ? r.places.slice(0, 6) : r.places).map((p) => (
              <PlaceRow key={p.id} place={p} />
            ))}
          </div>
        </section>
      )}

      {r && show("people") && r.people.length > 0 && (
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
