"use client";

import { Luggage, Plus } from "lucide-react";
import { useState } from "react";
import { TripCard } from "@/components/trip/TripCard";
import { Button, Chip, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useMyTrips } from "@/lib/api/queries";

type Filter = "all" | "mine" | "shared" | "past";

export default function TripsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const trips = useMyTrips(filter);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold md:text-4xl">My trips</h1>
          <p className="text-sm text-muted">Trips you own and trips you&apos;ve been invited to.</p>
        </div>
        <Button href="/trips/new" className="hidden sm:inline-flex">
          <Plus className="size-4" /> New trip
        </Button>
      </header>

      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4">
        {(
          [
            ["all", "All"],
            ["mine", "Created by me"],
            ["shared", "Shared with me"],
            ["past", "Past"],
          ] as const
        ).map(([v, l]) => (
          <Chip key={v} active={filter === v} onClick={() => setFilter(v)} className="shrink-0">
            {l}
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
      ) : !trips.data?.length ? (
        <EmptyState
          icon={<Luggage className="size-7" />}
          title="Your next adventure starts here."
          body={filter === "all" ? "Create a trip from scratch or remix one from Explore." : "No trips match this filter."}
          action={
            <div className="flex gap-2">
              <Button href="/trips/new">Create trip</Button>
              <Button href="/explore" variant="secondary">
                Explore trips
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {trips.data.map((t) => (
            <TripCard key={t.id} trip={t} showRole />
          ))}
        </div>
      )}
    </div>
  );
}
