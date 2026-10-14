"use client";

import { localNowAt, openStateAt, type CategoryView } from "@triply/shared";
import { Clock, List, LocateFixed, Map as MapIcon, MapPinned } from "lucide-react";
import { BinocularsArt } from "../art/EmptyArt";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { PlacesMap } from "@/components/map/PlacesMap";
import { PlaceRow } from "@/components/social/PlaceRow";
import { Chip, EmptyState, ErrorState, LoadMore, Skeleton, cx, inputCls } from "@/components/ui";
import { useFormat, useT } from "@/i18n/client";
import { useCategories, useDestinations, useGeoAreas, useHydrated, usePlaceBrowse } from "@/lib/api/queries";
import { useNow } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import { groupMeta } from "./categoryMeta";
import { WherePicker, type WhereValue } from "./WherePicker";

const RADII = [2, 5, 10, 25] as const;
const SORTS = ["recommended", "distance", "rating"] as const;

/**
 * Explore → Places: where (a destination, the device's location or anywhere), how far, which kind of
 * place, in what order. Every filter lives in the URL, so results can be shared and Back works.
 */
export function PlaceBrowser({ q = "" }: { q?: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const t = useT();
  const b = t.explore.browser;
  const f = useFormat();
  const categories = useCategories().data ?? [];
  const destinations = useDestinations().data ?? [];
  const areas = useGeoAreas().data ?? [];
  const [locating, setLocating] = useState(false);
  const whereId = useId();
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
  const loaded = browse.items ?? [];
  // "Open now" is judged here, in each place's own local time, over the results loaded so far (the server
  // can't filter on opening_hours text); the note under the list says so.
  const openOnly = params.get("open") === "1";
  const hydrated = useHydrated();
  const now = useNow();
  const items =
    openOnly && hydrated
      ? loaded.filter((p) => {
          const l = localNowAt(p.lat, p.lng, now);
          return openStateAt(p.openingHours, l.date, l.time).state === "open";
        })
      : loaded;
  const facet = new Map(meta?.facets.map((f) => [f.key, f.count]) ?? []);
  const groups = categories.filter((g) => facet.get(g.key) || g.key === group);
  const activeGroup: CategoryView | undefined = categories.find((g) => g.key === group);

  const locate = () => {
    if (!("geolocation" in navigator)) return toast(b.noGeolocation, "error");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        // ~10 m precision is plenty and keeps the exact position out of shared links.
        set({ near: `${pos.coords.latitude.toFixed(4)},${pos.coords.longitude.toFixed(4)}`, dest: undefined, area: undefined, sort: "distance" });
      },
      (err) => {
        setLocating(false);
        toast(err.code === err.PERMISSION_DENIED ? b.locationDenied : b.locationFailed, "error");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  };

  const whereValue: WhereValue = dest ? { kind: "dest", slug: dest } : area ? { kind: "area", slug: area } : near ? { kind: "near" } : { kind: "any" };
  const whereLabel = (() => {
    if (dest) {
      const d = destinations.find((x) => x.slug === dest);
      return d ? `${d.name}, ${d.country}` : (meta?.center?.label ?? b.destination);
    }
    if (area) {
      const a = areas.find((x) => x.slug === area);
      const country = a?.kind === "country" ? null : areas.find((x) => x.slug === a?.parentSlug);
      return a ? (country ? `${a.displayName}, ${country.displayName}` : b.allOf(a.displayName)) : (meta?.center?.label ?? b.area);
    }
    return near ? b.nearMe : b.anywhere;
  })();
  const pickWhere = (v: WhereValue) => {
    if (v.kind === "near") return locate();
    set({
      dest: v.kind === "dest" ? v.slug : undefined,
      area: v.kind === "area" ? v.slug : undefined,
      near: undefined,
      r: undefined,
      // Distance needs a point; a province or "anywhere" has none.
      sort: v.kind === "dest" || sort !== "distance" ? sort : undefined,
    });
  };
  const summary = meta
    ? b.summary({
        count: `${f.number(meta.total)}${meta.totalIsEstimate ? "+" : ""}`,
        n: meta.total,
        area: meta.area ? (meta.center?.label ?? meta.area.name) : undefined,
        within: !meta.area && meta.center && meta.radiusKm != null ? { km: meta.radiusKm, label: meta.center.label } : undefined,
        kind: activeGroup ? (category ? activeGroup.children?.find((c) => c.key === category)?.label : activeGroup.label) : undefined,
      })
    : "";

  return (
    <div className="space-y-5">
      {/* Where + how far */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="block min-w-[240px] flex-1 sm:max-w-sm">
          <span id={whereId} className="mb-1.5 block text-sm font-medium text-ink-2">
            {b.where}
          </span>
          <div role="group" aria-labelledby={whereId}>
            <WherePicker value={whereValue} label={whereLabel} areas={areas} destinations={destinations} onChange={pickWhere} />
          </div>
        </div>
        <button
          type="button"
          onClick={locate}
          disabled={locating}
          className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink-2 hover:border-ink-2 disabled:opacity-60"
        >
          <LocateFixed className={cx("size-4", locating && "animate-pulse")} aria-hidden />
          {locating ? b.locating : b.nearMe}
        </button>
        {hasPoint && (
          <div role="group" aria-label={b.distance} className="flex items-center gap-1.5">
            {RADII.map((r) => (
              <Chip key={r} active={(meta?.radiusKm ?? radius) === r} onClick={() => set({ r: String(r) })} className="h-9 px-3">
                {r} km
              </Chip>
            ))}
          </div>
        )}
        <label className="block w-full sm:ml-auto sm:w-auto">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">{b.sort}</span>
          <select className={cx(inputCls, "pr-8 sm:w-44")} value={hasPoint || sort !== "distance" ? sort : "recommended"} onChange={(e) => set({ sort: e.target.value === "recommended" ? undefined : e.target.value })}>
            {SORTS.map((v) => (
              <option key={v} value={v} disabled={v === "distance" && !hasPoint}>
                {b.sorts[v]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* What kind of place */}
      <div className="space-y-2">
        <div role="group" aria-label={b.kindOfPlace} className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          <Chip active={!group} onClick={() => set({ group: undefined, cat: undefined })} className="shrink-0">
            {b.all}
          </Chip>
          {groups.map((g) => {
            const Icon = groupMeta(g.key).icon;
            return (
              <Chip key={g.key} active={group === g.key} onClick={() => set({ group: group === g.key ? undefined : g.key, cat: undefined })} className="shrink-0">
                <Icon className="size-4" aria-hidden />
                {g.label}
                <span className={cx("text-xs font-medium", group === g.key ? "text-on-ink/80" : "text-muted")}>{facet.get(g.key) ?? 0}
                  {meta?.totalIsEstimate ? "+" : ""}
                </span>
              </Chip>
            );
          })}
        </div>
        {activeGroup?.children && activeGroup.children.length > 0 && (
          <div role="group" aria-label={b.kindsOf(activeGroup.label)} className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {activeGroup.children.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-pressed={category === c.key}
                onClick={() => set({ cat: category === c.key ? undefined : c.key })}
                className={cx(
                  "h-11 shrink-0 rounded-full px-3 text-sm font-medium transition-colors",
                  category === c.key ? "bg-primary text-on-primary" : "bg-sand-2 text-ink-2 hover:bg-line",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2" aria-live="polite">
          {summary}
        </p>
        <Chip active={openOnly} onClick={() => set({ open: openOnly ? undefined : "1" })} className="h-9 shrink-0 px-3 lg:ml-auto">
          <Clock className="size-4" aria-hidden /> {b.openNow}
        </Chip>
        <div className="flex rounded-full border border-line bg-surface p-0.5 lg:hidden" role="group" aria-label={b.showAs}>
          {(["list", "map"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cx("inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold", view === v ? "bg-ink text-on-ink" : "text-ink-2")}
            >
              {v === "list" ? <List className="size-4" aria-hidden /> : <MapIcon className="size-4" aria-hidden />}
              {v === "list" ? b.list : b.map}
            </button>
          ))}
        </div>
      </div>

      {browse.isError && <ErrorState error={browse.error} onRetry={() => browse.refetch()} />}
      {browse.isLoading && <Skeleton className="h-72" />}
      {openOnly && hydrated && loaded.length > 0 && (
        <p className="text-xs text-muted" aria-live="polite">
          {b.openNote(items.length, loaded.length)}
        </p>
      )}
      {meta && loaded.length === 0 && (
        <EmptyState
          art={<BinocularsArt />}
          level="h3"
          title={b.noMatchTitle}
          body={hasPoint ? b.noMatchBodyPoint : b.noMatchBody}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {hasPoint && (meta.radiusKm ?? 0) < 25 && (
                <Chip onClick={() => set({ r: String(RADII.find((r) => r > (meta.radiusKm ?? 0)) ?? 25) })}>{b.searchWider}</Chip>
              )}
              {(group || category) && <Chip onClick={() => set({ group: undefined, cat: undefined })}>{b.clearFilters}</Chip>}
            </div>
          }
        />
      )}

      {loaded.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,440px)]">
          <div className={cx("space-y-4", view === "map" && "hidden lg:block")}>
            {/* Previous results stay visible (dimmed) while new filters load, so the page doesn't jump. */}
            <ol
              className={cx("grid gap-2.5 transition-opacity sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2", browse.isPlaceholderData && "opacity-50")}
              aria-label={b.places}
              aria-busy={browse.isPlaceholderData}
            >
              {items.map((p, i) => (
                <li key={p.id} className="min-w-0">
                  <PlaceRow place={p} index={i + 1} active={hovered === p.id} onHover={setHovered} />
                </li>
              ))}
            </ol>
            <LoadMore hasMore={browse.hasNextPage} loading={browse.isFetchingNextPage} onClick={() => browse.fetchNextPage()} label={b.morePlaces} />
          </div>
          <div className={cx(view === "list" && "hidden lg:block")}>
            <div className="lg:sticky lg:top-20">
              <PlacesMap places={items} center={meta?.center} radiusKm={meta?.radiusKm} activeId={hovered} label={b.mapLabel} />
              {!hasPoint && !area && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                  <MapPinned className="size-3.5" aria-hidden /> {b.pickHint}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
