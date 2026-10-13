"use client";

import { normalizeSearch, type DestinationView, type GeoAreaOption } from "@triply/shared";
import { ChevronDown, ChevronLeft, ChevronRight, Globe2, LocateFixed, MapPin, Search, Sparkles, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Sheet, cx } from "@/components/ui";
import { useFormat, useT } from "@/i18n/client";
import type { Messages } from "@/i18n/types";

export type WhereValue = { kind: "any" } | { kind: "near" } | { kind: "dest"; slug: string } | { kind: "area"; slug: string };

type Row = {
  id: string;
  /** What choosing it does: pick a value, or open a country. */
  action: { pick: WhereValue } | { open: string };
  title: string;
  subtitle: string;
  icon: "any" | "near" | "country" | "dest" | "area";
  /** Accent-free text matched against the query. */
  haystack: string;
  /** Larger first when several rows match equally well. */
  weight: number;
};
type Section = { label: string | null; rows: Row[] };
type Country = { key: string; name: string; area: GeoAreaOption | null; destinations: DestinationView[]; areas: GeoAreaOption[] };

/** Row text needs the catalog and a number formatter; the row builders below are plain functions. */
type Text = { w: Messages["explore"]["where"]; num: (n: number) => string };

/** Countries, keyed by English name: from the imported boundaries, plus countries that only have hand-picked destinations. */
function buildCountries(areas: GeoAreaOption[], destinations: DestinationView[]): Country[] {
  const byKey = new Map<string, Country>();
  for (const a of areas) {
    if (a.kind !== "country") continue;
    byKey.set(a.displayName, { key: a.displayName, name: a.displayName, area: a, destinations: [], areas: [] });
  }
  const bySlug = new Map([...byKey.values()].map((c) => [c.area!.slug, c]));
  for (const a of areas) {
    if (a.kind === "country" || a.placeCount === 0) continue;
    const c = a.parentSlug ? bySlug.get(a.parentSlug) : undefined;
    c?.areas.push(a);
  }
  for (const d of destinations) {
    if (d.kind !== "curated") continue; // province/city destinations are listed as their area
    const c = byKey.get(d.country) ?? { key: d.country, name: d.country, area: null, destinations: [], areas: [] };
    c.destinations.push(d);
    byKey.set(d.country, c);
  }
  return [...byKey.values()]
    .filter((c) => c.destinations.length > 0 || c.areas.length > 0)
    .sort((a, b) => (b.area?.placeCount ?? 0) - (a.area?.placeCount ?? 0) || a.name.localeCompare(b.name));
}

const destRow = ({ w }: Text, d: DestinationView, withCountry: boolean): Row => ({
  id: `dest:${d.slug}`,
  action: { pick: { kind: "dest", slug: d.slug } },
  title: d.name,
  subtitle: w.destSubtitle(withCountry ? d.country : null),
  icon: "dest",
  haystack: normalizeSearch(`${d.name} ${d.country}`),
  weight: 1e9 + d.tripCount, // hand-picked places first
});

const areaRow = ({ w, num }: Text, a: GeoAreaOption, country: string | null): Row => {
  const kind = w.kinds[a.kind === "city" || a.kind === "province" ? a.kind : "region"];
  const local = a.shortName !== a.displayName ? ` · ${a.shortName}` : "";
  return {
    id: `area:${a.slug}`,
    action: { pick: { kind: "area", slug: a.slug } },
    title: a.displayName,
    subtitle: `${kind}${country ? `, ${country}` : ""}${local} · ${w.placeCount(a.placeCount, num(a.placeCount))}`,
    icon: "area",
    haystack: normalizeSearch(`${a.displayName} ${a.shortName} ${a.name} ${country ?? ""}`),
    weight: a.placeCount,
  };
};

const countryRow = ({ w, num }: Text, c: Country): Row => {
  const parts = [
    c.destinations.length ? w.destinationCount(c.destinations.length, num(c.destinations.length)) : "",
    c.areas.length ? w.areaCount(c.areas.length, num(c.areas.length)) : "",
  ].filter(Boolean);
  return {
    id: `country:${c.key}`,
    action: { open: c.key },
    title: c.name,
    subtitle: parts.join(" · ") + (c.area ? ` · ${w.placeCount(c.area.placeCount, num(c.area.placeCount))}` : ""),
    icon: "country",
    haystack: normalizeSearch(`${c.name} ${c.area?.name ?? ""}`),
    weight: 2e9 + (c.area?.placeCount ?? 0),
  };
};

/** Every query word must start a word of the row ("da n" → "Da Nang"); rows whose title starts with the query rank first. */
function searchRows(rows: Row[], query: string): Row[] {
  const q = normalizeSearch(query);
  const words = q.split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return [];
  const startsWord = (text: string, w: string) => text.startsWith(w) || text.includes(` ${w}`) || text.includes(`-${w}`);
  return rows
    .filter((r) => words.every((w) => startsWord(r.haystack, w)))
    .map((r) => ({ r, title: normalizeSearch(r.title).startsWith(q) }))
    .sort((a, b) => Number(b.title) - Number(a.title) || b.r.weight - a.r.weight || a.r.title.localeCompare(b.r.title))
    .slice(0, 40)
    .map(({ r }) => r);
}

/**
 * Explore's "Where": a button that opens a two-level picker — countries, then that country's destinations,
 * cities and provinces — with one search box across everything. Built for many countries: nothing is a
 * long native <select>. Keyboard: type to search, ↑/↓ to move, Enter to choose, Esc to close.
 */
export function WherePicker({
  value,
  label,
  areas,
  destinations,
  onChange,
}: {
  value: WhereValue;
  /** Current choice as shown on the button, e.g. "Da Nang, Vietnam". */
  label: string;
  areas: GeoAreaOption[];
  destinations: DestinationView[];
  onChange: (v: WhereValue) => void;
}) {
  const t = useT();
  const w = t.explore.where;
  const f = useFormat();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const countries = useMemo(() => buildCountries(areas, destinations), [areas, destinations]);
  const current = countries.find((c) => c.key === country) ?? null;

  /** Which country the current choice belongs to, so reopening lands next to it. */
  const countryOf = (v: WhereValue): string | null => {
    if (v.kind === "dest") return destinations.find((d) => d.slug === v.slug)?.country ?? null;
    if (v.kind !== "area") return null;
    const a = areas.find((x) => x.slug === v.slug);
    const root = a?.kind === "country" ? a : areas.find((x) => x.slug === a?.parentSlug);
    return root?.displayName ?? null;
  };

  const show = () => {
    setQuery("");
    setCountry(countries.length === 1 ? countries[0].key : countryOf(value));
    setActive(0);
    setOpen(true);
  };

  const sections: Section[] = useMemo(() => {
    const tx: Text = { w, num: f.number };
    if (query.trim()) {
      const all = countries.flatMap((c) => [countryRow(tx, c), ...c.destinations.map((d) => destRow(tx, d, true)), ...c.areas.map((a) => areaRow(tx, a, c.name))]);
      return [{ label: null, rows: searchRows(all, query) }];
    }
    const top: Row[] = [
      { id: "any", action: { pick: { kind: "any" } }, title: w.anywhere, subtitle: w.anywhereHint, icon: "any", haystack: "", weight: 0 },
      { id: "near", action: { pick: { kind: "near" } }, title: w.nearMe, subtitle: w.nearMeHint, icon: "near", haystack: "", weight: 0 },
    ];
    if (!current) return [{ label: null, rows: top }, { label: w.countries, rows: countries.map((c) => countryRow(tx, c)) }];
    const out: Section[] = [];
    if (current.area) {
      out.push({
        label: null,
        rows: [{ ...areaRow(tx, current.area, null), title: w.allOf(current.name), subtitle: w.placeCount(current.area.placeCount, f.number(current.area.placeCount)), icon: "country" }],
      });
    }
    if (current.destinations.length) {
      out.push({ label: w.destinations, rows: [...current.destinations].sort((a, b) => b.tripCount - a.tripCount || a.name.localeCompare(b.name)).map((d) => destRow(tx, d, false)) });
    }
    for (const kind of ["city", "province", "region"] as const) {
      const rows = current.areas.filter((a) => a.kind === kind).map((a) => areaRow(tx, a, null));
      if (rows.length) out.push({ label: w.sections[kind], rows });
    }
    return out;
  }, [query, current, countries, w, f]);

  const flat = sections.flatMap((s) => s.rows);
  const selectedId = value.kind === "any" || value.kind === "near" ? value.kind : `${value.kind}:${value.slug}`;

  // Keep the highlighted row in view while moving with the keyboard.
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (row: Row) => {
    if ("open" in row.action) {
      setCountry(row.action.open);
      setQuery("");
      setActive(0);
      inputRef.current?.focus();
      return;
    }
    setOpen(false);
    onChange(row.action.pick);
  };

  const back = () => {
    setCountry(null);
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!flat.length) return;
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[active]) choose(flat[active]);
    } else if (e.key === "Backspace" && !query && current) {
      back(); // an empty box + Backspace steps back out of the country, like a breadcrumb
    }
  };

  let index = -1;
  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        className="flex h-11 w-full items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-left text-[15px] text-ink hover:border-ink-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        <MapPin className="size-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={w.title}>
        <div className="sticky -top-5 z-10 -mx-5 -mt-1 bg-surface px-5 pb-3 pt-1 md:-top-6 md:-mx-6 md:px-6">
          {current && !query && (
            <button type="button" onClick={back} className="mb-2 inline-flex min-h-11 items-center gap-1 rounded-lg pr-2 text-sm font-semibold text-primary hover:underline">
              <ChevronLeft className="size-4" aria-hidden /> {w.allCountries}
            </button>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              ref={inputRef}
              role="combobox"
              aria-label={w.searchLabel}
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={current ? w.searchIn(current.name) : w.searchPlaceholder}
              autoComplete="off"
              enterKeyHint="go"
              className="h-12 w-full rounded-xl border border-line bg-sand-2/60 pl-10 pr-11 text-[16px] text-ink placeholder:text-muted/80 focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                aria-label={w.clearSearch}
                className="absolute right-1 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:text-ink"
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </div>
          {current && !query && <p className="mt-3 font-display text-lg font-semibold">{current.name}</p>}
        </div>

        <div ref={listRef} id={listId} role="listbox" aria-label={current && !query ? w.placesIn(current.name) : w.places} className="min-h-[50dvh] space-y-4 md:min-h-[420px]">
          {flat.length === 0 && (
            <p className="px-1 py-6 text-center text-sm text-ink-2" role="status">
              {w.noMatch(query)}
            </p>
          )}
          {sections.map((s, si) =>
            s.rows.length === 0 ? null : (
              <div key={s.label ?? `s${si}`} role="group" aria-label={s.label ?? undefined}>
                {s.label && <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted">{s.label}</p>}
                <ul className="space-y-0.5">
                  {s.rows.map((r) => {
                    index += 1;
                    const i = index;
                    const isActive = i === active;
                    const isSelected = r.id === selectedId;
                    const Icon = { any: Sparkles, near: LocateFixed, country: Globe2, dest: MapPin, area: MapPin }[r.icon];
                    return (
                      <li
                        key={r.id}
                        id={`${listId}-${i}`}
                        data-index={i}
                        role="option"
                        aria-selected={isSelected}
                        onMouseMove={() => setActive(i)}
                        onClick={() => choose(r)}
                        className={cx(
                          "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition-colors",
                          isActive ? "bg-sand-2" : "hover:bg-sand-2/60",
                          isSelected && "ring-1 ring-inset ring-primary/40",
                        )}
                      >
                        <span
                          className={cx(
                            "flex size-9 shrink-0 items-center justify-center rounded-lg",
                            r.icon === "dest" ? "bg-accent/10 text-accent" : r.icon === "country" ? "bg-ink/5 text-ink-2" : "bg-primary/10 text-primary",
                          )}
                          aria-hidden
                        >
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cx("block truncate font-semibold", isSelected && "text-primary")}>{r.title}</span>
                          <span className="block truncate text-sm text-muted">{r.subtitle}</span>
                        </span>
                        {"open" in r.action && <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />}
                        {isSelected && <span className="sr-only">{w.selected}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ),
          )}
        </div>
      </Sheet>
    </>
  );
}
