"use client";

import type { CategoryView, GeoAreaOption } from "@triply/shared";
import { List, LocateFixed, Map as MapIcon, MapPinned, SearchX } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PlacesMap } from "@/components/map/PlacesMap";
import { PlaceRow } from "@/components/social/PlaceRow";
import { Chip, EmptyState, ErrorState, LoadMore, Skeleton, cx, inputCls } from "@/components/ui";
import { useCategories, useDestinations, useGeoAreas, usePlaceBrowse } from "@/lib/api/queries";
import { useToast } from "@/lib/toast";
import { groupMeta } from "./categoryMeta";

const RADII = [2, 5, 10, 25] as const;
const KIND_LABEL: Record<GeoAreaOption["kind"], string> = { country: "Country", city: "Cities", province: "Provinces", region: "Regions" };

/** Countries that have places, each with its provinces/cities grouped by kind ("Cities", "Provinces"). */
function areaGroups(areas: GeoAreaOption[], selected?: string) {
  const shown = areas.filter((a) => a.placeCount > 0 || a.slug === selected);
  return shown
    .filter((a) => a.kind === "country")
    .map((country) => {
      const inside = shown.filter((a) => a.parentSlug === country.slug);
      const kinds = (["city", "province", "region"] as const)
        .map((kind) => ({ kind, areas: inside.filter((a) => a.kind === kind) }))
        .filter((g) => g.areas.length > 0);
      return { country, kinds };
    });
}

const SORTS = [
  ["recommended", "Recommended"],
  ["distance", "Nearest first"],
  ["rating", "Top rated"],
] as const;

/**
 * Explore → Places: where (a destination, the device's location or anywhere), how far, which kind of
 * place, in what order. Every filter lives in the URL, so results can be shared and Back works.
 */
export function PlaceBrowser({ q = "" }: { q?: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const categories = useCategories().data ?? [];
  const destinations = useDestinations().data ?? [];
  const areas = useGeoAreas().data ?? [];
  const [locating, setLocating] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");
  const [hovered, setHovered] = useState<string | null>(null);

  const dest = params.get("dest") ?? undefined;
  const area = params.get("area") ?? undefined;
  const near = params.get("near") ?? undefined;
  const radius = Number(params.get("r")) || undefined;
  const group = params.get("group") ?? undefined;
  const category = params.get("cat") ?? undefined;
  const sort = params.get("sort") ?? "recommended";
  // A destination or the device is a point to measure distance from; a province/city is a boundary.
  const hasPoint = !!(dest || near);

  /** Replace some URL params, keeping the rest (and the page's scroll position). */
  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const browse = usePlaceBrowse({ q: q || undefined, destination: dest, area, near, radius, group, category, sort, limit: 24 });
  const meta = browse.meta;
  const items = browse.items ?? [];
  const facet = new Map(meta?.facets.map((f) => [f.key, f.count]) ?? []);
  const groups = categories.filter((g) => facet.get(g.key) || g.key === group);
  const activeGroup: CategoryView | undefined = categories.find((g) => g.key === group);

  const locate = () => {
    if (!("geolocation" in navigator)) return toast("This browser can't share its location. Pick a destination instead.", "error");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        // ~10 m precision is plenty and keeps the exact position out of shared links.
        set({ near: `${pos.coords.latitude.toFixed(4)},${pos.coords.longitude.toFixed(4)}`, dest: undefined, area: undefined, sort: "distance" });
      },
      (err) => {
        setLocating(false);
        toast(err.code === err.PERMISSION_DENIED ? "Location access is off. Allow it in your browser, or pick a destination." : "Couldn't find your location. Try again or pick a destination.", "error");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  };

  const where = dest ? `dest:${dest}` : area ? `area:${area}` : near ? "near" : "";
  const summary = meta
    ? `${meta.total.toLocaleString()} place${meta.total === 1 ? "" : "s"}${meta.area ? ` in ${meta.center?.label ?? meta.area.name}` : meta.center ? ` within ${meta.radiusKm} km of ${meta.center.label}` : ""}${activeGroup ? ` · ${category ? activeGroup.children?.find((c) => c.key === category)?.label : activeGroup.label}` : ""}`
    : "";

  return (
    <div className="space-y-5">
      {/* Where + how far */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[220px] flex-1 sm:flex-none">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">Where</span>
          <select
            className={cx(inputCls, "pr-8")}
            value={where}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "near") return locate();
              const [kind, slug] = v.split(":");
              set({
                dest: kind === "dest" ? slug : undefined,
                area: kind === "area" ? slug : undefined,
                near: undefined,
                r: undefined,
                // Distance needs a point; a province or "anywhere" has none.
                sort: kind === "dest" || sort !== "distance" ? sort : undefined,
              });
            }}
          >
            <option value="">Anywhere</option>
            <option value="near">{near ? "Near me" : "Near me (uses your location)"}</option>
            <optgroup label="Destinations">
              {/* Province/city destinations are listed with their area below. */}
              {destinations.filter((d) => d.kind === "curated" || d.slug === dest).map((d) => (
                <option key={d.slug} value={`dest:${d.slug}`}>
                  {d.name}, {d.country}
                </option>
              ))}
            </optgroup>
            {areaGroups(areas, area).map(({ country, kinds }) => [
              <optgroup key={country.slug} label={country.shortName}>
                <option value={`area:${country.slug}`}>
                  All of {country.shortName} · {country.placeCount.toLocaleString()}
                </option>
              </optgroup>,
              ...kinds.map((g) => (
                <optgroup key={`${country.slug}-${g.kind}`} label={`${country.shortName} · ${KIND_LABEL[g.kind]}`}>
                  {g.areas.map((a) => (
                    <option key={a.slug} value={`area:${a.slug}`}>
                      {a.shortName} · {a.placeCount.toLocaleString()}
                    </option>
                  ))}
                </optgroup>
              )),
            ])}
          </select>
        </label>
        <button
          type="button"
          onClick={locate}
          disabled={locating}
          className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink-2 hover:border-ink-2 disabled:opacity-60"
        >
          <LocateFixed className={cx("size-4", locating && "animate-pulse")} aria-hidden />
          {locating ? "Locating…" : "Near me"}
        </button>
        {hasPoint && (
          <div role="group" aria-label="Distance" className="flex items-center gap-1.5">
            {RADII.map((r) => (
              <Chip key={r} active={(meta?.radiusKm ?? radius) === r} onClick={() => set({ r: String(r) })} className="h-9 px-3">
                {r} km
              </Chip>
            ))}
          </div>
        )}
        <label className="block w-full sm:ml-auto sm:w-auto">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">Sort</span>
          <select className={cx(inputCls, "pr-8 sm:w-44")} value={hasPoint || sort !== "distance" ? sort : "recommended"} onChange={(e) => set({ sort: e.target.value === "recommended" ? undefined : e.target.value })}>
            {SORTS.map(([v, label]) => (
              <option key={v} value={v} disabled={v === "distance" && !hasPoint}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* What kind of place */}
      <div className="space-y-2">
        <div role="group" aria-label="Kind of place" className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <Chip active={!group} onClick={() => set({ group: undefined, cat: undefined })} className="shrink-0">
            All
          </Chip>
          {groups.map((g) => {
            const Icon = groupMeta(g.key).icon;
            return (
              <Chip key={g.key} active={group === g.key} onClick={() => set({ group: group === g.key ? undefined : g.key, cat: undefined })} className="shrink-0">
                <Icon className="size-4" aria-hidden />
                {g.label}
                <span className={cx("text-xs font-medium", group === g.key ? "text-white/80" : "text-muted")}>{facet.get(g.key) ?? 0}</span>
              </Chip>
            );
          })}
        </div>
        {activeGroup?.children && activeGroup.children.length > 0 && (
          <div role="group" aria-label={`Kinds of ${activeGroup.label.toLowerCase()}`} className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {activeGroup.children.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-pressed={category === c.key}
                onClick={() => set({ cat: category === c.key ? undefined : c.key })}
                className={cx(
                  "h-11 shrink-0 rounded-full px-3 text-sm font-medium transition-colors",
                  category === c.key ? "bg-primary text-white" : "bg-sand-2 text-ink-2 hover:bg-line",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-2" aria-live="polite">
          {summary}
        </p>
        <div className="flex rounded-full border border-line bg-surface p-0.5 lg:hidden" role="group" aria-label="Show as">
          {(["list", "map"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cx("inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold", view === v ? "bg-ink text-white" : "text-ink-2")}
            >
              {v === "list" ? <List className="size-4" aria-hidden /> : <MapIcon className="size-4" aria-hidden />}
              {v === "list" ? "List" : "Map"}
            </button>
          ))}
        </div>
      </div>

      {browse.isError && <ErrorState error={browse.error} onRetry={() => browse.refetch()} />}
      {browse.isLoading && <Skeleton className="h-72" />}
      {meta && items.length === 0 && (
        <EmptyState
          icon={<SearchX className="size-7" />}
          level="h3"
          title="No places match"
          body={hasPoint ? "Try a wider distance, another kind of place, or clear the filters." : "Try another kind of place, another spelling, or clear the filters."}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {hasPoint && (meta.radiusKm ?? 0) < 25 && (
                <Chip onClick={() => set({ r: String(RADII.find((r) => r > (meta.radiusKm ?? 0)) ?? 25) })}>Search wider</Chip>
              )}
              {(group || category) && <Chip onClick={() => set({ group: undefined, cat: undefined })}>Clear filters</Chip>}
            </div>
          }
        />
      )}

      {items.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,440px)]">
          <div className={cx("space-y-4", view === "map" && "hidden lg:block")}>
            {/* Previous results stay visible (dimmed) while new filters load, so the page doesn't jump. */}
            <ol
              className={cx("grid gap-2.5 transition-opacity sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2", browse.isPlaceholderData && "opacity-50")}
              aria-label="Places"
              aria-busy={browse.isPlaceholderData}
            >
              {items.map((p, i) => (
                <li key={p.id} className="min-w-0">
                  <PlaceRow place={p} index={i + 1} active={hovered === p.id} onHover={setHovered} />
                </li>
              ))}
            </ol>
            <LoadMore hasMore={browse.hasNextPage} loading={browse.isFetchingNextPage} onClick={() => browse.fetchNextPage()} label="More places" />
          </div>
          <div className={cx(view === "list" && "hidden lg:block")}>
            <div className="lg:sticky lg:top-20">
              <PlacesMap places={items} center={meta?.center} radiusKm={meta?.radiusKm} activeId={hovered} label="Map of these places" />
              {!hasPoint && !area && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                  <MapPinned className="size-3.5" aria-hidden /> Pick a destination, a province or city, or use “Near me” to see what’s around.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
