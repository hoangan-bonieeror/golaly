"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { DestinationView, PlaceView } from "@golaly/shared";
import { MapPin, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { CategoryIcon } from "@/components/place/categoryMeta";
import { cx } from "@/components/ui";
import { useT } from "@/i18n/client";
import { keys } from "@/lib/api/keys";
import { useSuggestions } from "@/lib/api/queries";
import { useDebounced } from "@/lib/hooks";

type Option =
  | { kind: "destination"; key: string; href: string; d: DestinationView }
  | { kind: "place"; key: string; href: string; p: PlaceView }
  | { kind: "all"; key: string; href: string };

/**
 * Global search in the navbar, with type-ahead: as you type, the best few destinations and places appear under the
 * field (GET /search/suggest — same matching as the full search). Enter on a suggestion opens it; Enter otherwise,
 * or the last row, opens Explore with every kind of result (trips and people too).
 *
 * WAI-ARIA combobox: ↑/↓ move through the list (aria-activedescendant — focus stays in the field), Enter opens,
 * Escape closes (then clears). Requests wait for a short pause in typing, an older one still in flight is cancelled
 * when the text changes, and the previous list stays up while the next loads, so the list doesn't flicker.
 */
export function NavSearch() {
  const t = useT();
  const s = t.nav.suggest;
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const term = useDebounced(q.trim(), 150);
  const suggestions = useSuggestions(term);

  // A newer term supersedes the request for the previous one.
  const prevTerm = useRef("");
  useEffect(() => {
    if (prevTerm.current && prevTerm.current !== term) void qc.cancelQueries({ queryKey: keys.suggest(prevTerm.current) });
    prevTerm.current = term;
  }, [term, qc]);

  // Leaving the page (a suggestion opened, or any other navigation) closes the list.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
    setActive(-1);
  }

  const typed = q.trim();
  const data = typed.length >= 2 ? suggestions.data : undefined;
  const all = `/explore?q=${encodeURIComponent(typed)}`;
  const options: Option[] = data
    ? [
        ...data.destinations.map((d) => ({ kind: "destination" as const, key: `d-${d.id}`, href: `/explore/${d.slug}`, d })),
        ...data.places.map((p) => ({ kind: "place" as const, key: `p-${p.id}`, href: `/places/${p.id}`, p })),
        { kind: "all" as const, key: "all", href: all },
      ]
    : [];
  const shown = open && typed.length >= 2 && !!data;
  const destinationOptions = options.filter((o): o is Extract<Option, { kind: "destination" }> => o.kind === "destination");
  const placeOptions = options.filter((o): o is Extract<Option, { kind: "place" }> => o.kind === "place");
  const found = options.length - 1;

  const go = (href: string) => {
    setOpen(false);
    setActive(-1);
    setQ("");
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!options.length) return;
      e.preventDefault();
      setOpen(true);
      const n = options.length;
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % n : i <= 0 ? n - 1 : i - 1));
    } else if (e.key === "Escape") {
      if (shown) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      } else if (q) setQ("");
    } else if (e.key === "Enter" && shown && active >= 0 && options[active]) {
      e.preventDefault();
      go(options[active].href);
    }
  };

  let index = -1;
  const row = (o: Option, body: React.ReactNode) => {
    index += 1;
    const i = index;
    return (
      <li
        key={o.key}
        id={optionId(i)}
        role="option"
        aria-selected={active === i}
        // Keep focus in the field: the click navigates without blurring it first.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => go(o.href)}
        onMouseEnter={() => setActive(i)}
        className={cx("flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2", active === i ? "bg-sand-2" : "")}
      >
        {body}
      </li>
    );
  };

  return (
    <form
      role="search"
      className="relative hidden max-w-[420px] flex-1 lg:block"
      onSubmit={(e) => {
        e.preventDefault();
        go(typed ? all : "/explore");
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        role="combobox"
        aria-label={t.nav.searchLabel}
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && active >= 0 ? optionId(active) : undefined}
        placeholder={t.nav.searchPlaceholder}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        maxLength={100}
        autoComplete="off"
        className="h-10 w-full rounded-xl border border-line bg-sand pl-10 pr-3 text-sm text-ink placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
      <p className="sr-only" aria-live="polite">
        {shown ? (found > 0 ? s.count(found) : s.none(typed)) : ""}
      </p>
      {shown && (
        <ul
          id={listId}
          role="listbox"
          aria-label={s.label}
          className={cx("animate-rise absolute left-0 right-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-pop", suggestions.isFetching && "opacity-90")}
        >
          {data!.destinations.length > 0 && (
            <li role="presentation" className="px-2.5 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {s.destinations}
            </li>
          )}
          {destinationOptions.map(({ d, ...o }) =>
            row(
              { ...o, d },
              <>
                <span className="size-10 shrink-0 rounded-xl" style={{ background: `linear-gradient(135deg, ${d.palette[0]}, ${d.palette[1]})` }} aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{d.name}</span>
                  <span className="block truncate text-xs text-muted">{d.country}</span>
                </span>
              </>,
            ),
          )}
          {data!.places.length > 0 && (
            <li role="presentation" className="px-2.5 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {s.places}
            </li>
          )}
          {placeOptions.map((o) => {
              const p = o.p;
              return row(
                o,
                <>
                  {p.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.photo.thumbUrl} alt="" width={40} height={40} className="size-10 shrink-0 rounded-xl object-cover" style={{ backgroundColor: p.photo.color ?? undefined }} />
                  ) : (
                    <CategoryIcon categoryKey={p.categoryKey} />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{p.name}</span>
                    <span className="flex min-w-0 items-center gap-1 truncate text-xs text-muted">
                      {p.categoryLabel}
                      <span aria-hidden>·</span>
                      <MapPin className="size-3 shrink-0" aria-hidden />
                      <span className="truncate">{p.areaName ?? p.destinationName}</span>
                    </span>
                  </span>
                </>,
              );
            })}
          {found === 0 && <li role="presentation" className="px-2.5 py-3 text-sm text-muted">{s.none(typed)}</li>}
          {row(
            options[options.length - 1],
            <span className="flex items-center gap-2 text-sm font-medium text-primary">
              <Search className="size-4" aria-hidden />
              {s.seeAll(typed)}
            </span>,
          )}
        </ul>
      )}
    </form>
  );
}
