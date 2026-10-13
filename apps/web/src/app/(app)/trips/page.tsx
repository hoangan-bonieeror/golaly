"use client";

import { Luggage, Plus } from "lucide-react";
import { useState } from "react";
import { TripCard } from "@/components/trip/TripCard";
import { Button, Chip, EmptyState, ErrorState, LoadMore, Skeleton } from "@/components/ui";
import { useT } from "@/i18n/client";
import { useMyTrips } from "@/lib/api/queries";

type Filter = "all" | "mine" | "shared" | "past";

export default function TripsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const trips = useMyTrips(filter);
  const t = useT();
  const l = t.trips.list;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold md:text-4xl">{t.nav.trips}</h1>
          <p className="text-sm text-muted">{l.subtitle}</p>
        </div>
        <Button href="/trips/new" className="hidden sm:inline-flex">
          <Plus className="size-4" /> {l.newTrip}
        </Button>
      </header>

      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
        {(["all", "mine", "shared", "past"] as const).map((v) => (
          <Chip key={v} active={filter === v} onClick={() => setFilter(v)} className="shrink-0">
            {l.filters[v]}
          </Chip>
        ))}
      </div>

      {trips.isLoading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-[5/4]" />
          ))}
        </div>
      ) : trips.isError ? (
        <ErrorState error={trips.error} onRetry={() => trips.refetch()} />
      ) : !trips.items?.length ? (
        <EmptyState
          icon={<Luggage className="size-7" />}
          title={l.emptyTitle}
          body={filter === "all" ? l.emptyBody : l.emptyFiltered}
          action={
            <div className="flex gap-2">
              <Button href="/trips/new">{l.createTrip}</Button>
              <Button href="/explore" variant="secondary">
                {l.exploreTrips}
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {trips.items.map((trip) => (
              <TripCard key={trip.id} trip={trip} showRole level="h2" morph />
            ))}
          </div>
          <LoadMore hasMore={trips.hasNextPage} loading={trips.isFetchingNextPage} onClick={() => trips.fetchNextPage()} label={l.showMore} />
        </>
      )}
    </div>
  );
}
