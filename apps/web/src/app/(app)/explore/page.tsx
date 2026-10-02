"use client";

import { Search, SearchX } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PlaceRow } from "@/components/social/PlaceRow";
import { DestinationTile } from "@/components/trip/DestinationTile";
import { TripCard } from "@/components/trip/TripCard";
import { Avatar, Chip, EmptyState, SectionTitle, inputCls, cx } from "@/components/ui";
import { discoverableTrips, search } from "@/lib/mock/selectors";
import { useStore } from "@/lib/store/store";

const CATS = ["Everything", "Trips", "Places", "People", "Destinations"] as const;
type Cat = (typeof CATS)[number];

export default function ExplorePage() {
  const { db } = useStore();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Cat>("Everything");
  const r = search(db, q);
  const show = (c: Cat) => cat === "Everything" || cat === c;
  const total = r.trips.length + r.places.length + r.people.length + r.destinations.length;
  const tripCount = (destId: string) => discoverableTrips(db).filter((t) => t.destinationIds.includes(destId)).length;

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <h1 className="font-display text-3xl font-semibold md:text-4xl">Explore</h1>
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" />
          <input
            className={cx(inputCls, "h-12 rounded-full pl-12 text-base")}
            placeholder="Search trips, places, people, destinations"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
            type="search"
          />
        </div>
        <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
          {CATS.map((c) => (
            <Chip key={c} active={cat === c} onClick={() => setCat(c)} className="shrink-0">
              {c}
            </Chip>
          ))}
        </div>
      </header>

      {total === 0 && (
        <EmptyState icon={<SearchX className="size-7" />} title={`No results for “${q}”`} body="Try a city, a country or a traveler's name." />
      )}

      {show("Destinations") && r.destinations.length > 0 && (
        <section>
          <SectionTitle>Destinations</SectionTitle>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {(cat === "Everything" && !q ? r.destinations.slice(0, 6) : r.destinations).map((d) => (
              <DestinationTile key={d.id} dest={d} count={tripCount(d.id)} />
            ))}
          </div>
        </section>
      )}

      {show("Trips") && r.trips.length > 0 && (
        <section>
          <SectionTitle>{q ? "Trips" : "Popular public trips"}</SectionTitle>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[...r.trips]
              .sort((a, b) => b.saveCount - a.saveCount)
              .map((t) => (
                <TripCard key={t.id} trip={t} />
              ))}
          </div>
        </section>
      )}

      {show("Places") && r.places.length > 0 && (
        <section>
          <SectionTitle>Places</SectionTitle>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {(cat === "Everything" ? r.places.slice(0, 6) : r.places).map((p) => (
              <PlaceRow key={p.id} place={p} />
            ))}
          </div>
        </section>
      )}

      {show("People") && r.people.length > 0 && (
        <section>
          <SectionTitle>Travelers</SectionTitle>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {r.people.map((u) => (
              <Link key={u.id} href={`/u/${u.username}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 hover:border-ink-2">
                <Avatar user={u} size={44} />
                <div className="min-w-0">
                  <div className="font-semibold">{u.displayName}</div>
                  <div className="truncate text-xs text-muted">@{u.username} · {u.homeBase}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
