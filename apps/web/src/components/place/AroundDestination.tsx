"use client";

import Link from "next/link";
import { useState } from "react";
import { PlaceRow } from "@/components/social/PlaceRow";
import { Chip, SectionTitle, Skeleton } from "@/components/ui";
import { useCategories, usePlaceBrowse } from "@/lib/api/queries";
import { groupMeta } from "./categoryMeta";

/** Destination page: what's around, by kind of place, with a way into the full browser. */
export function AroundDestination({ slug, name }: { slug: string; name: string }) {
  const [group, setGroup] = useState<string | undefined>();
  const categories = useCategories().data ?? [];
  const browse = usePlaceBrowse({ destination: slug, group, limit: 6 });
  const meta = browse.meta;
  const facet = new Map(meta?.facets.map((f) => [f.key, f.count]) ?? []);
  const groups = categories.filter((g) => facet.get(g.key));
  if (meta && meta.total === 0 && !group) return null;
  const all = `/explore?tab=places&dest=${slug}${group ? `&group=${group}` : ""}`;

  return (
    <section>
      <SectionTitle
        action={
          <Link href={all} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">
            See all{meta ? ` ${meta.total}` : ""}
          </Link>
        }
      >
        Around {name}
      </SectionTitle>
      <div role="group" aria-label="Kind of place" className="scrollbar-none -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={!group} onClick={() => setGroup(undefined)} className="shrink-0">
          All
        </Chip>
        {groups.map((g) => {
          const Icon = groupMeta(g.key).icon;
          return (
            <Chip key={g.key} active={group === g.key} onClick={() => setGroup(group === g.key ? undefined : g.key)} className="shrink-0">
              <Icon className="size-4" aria-hidden />
              {g.label}
            </Chip>
          );
        })}
      </div>
      {browse.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {(browse.items ?? []).map((p) => (
            <li key={p.id} className="min-w-0">
              <PlaceRow place={p} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
