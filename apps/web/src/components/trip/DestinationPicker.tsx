"use client";

import { normalizeSearch } from "@triply/shared";
import { Search, X } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n/client";
import { useDestinations } from "@/lib/api/queries";
import { cx, inputCls } from "../ui";

export function DestinationPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const t = useT();
  const tp = t.trips.picker;
  const all = useDestinations().data ?? [];
  const [q, setQ] = useState("");
  const selected = value.map((id) => all.find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => !!d);
  // Accent-insensitive, same normalisation as the API ("hoi an" → Hội An).
  const nq = normalizeSearch(q);
  const options = all.filter((d) => !value.includes(d.id) && (nq ? normalizeSearch(`${d.name} ${d.country}`).includes(nq) : true));
  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((d, i) => (
            <span key={d.id} className="inline-flex items-center gap-1.5 rounded-full bg-ink py-1 pl-3 pr-1.5 text-sm font-medium text-on-ink">
              {i > 0 && <span className="text-on-ink/50">→</span>}
              {d.name}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== d.id))} aria-label={tp.remove(d.name)} className="rounded-full p-0.5 hover:bg-white/20">
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input className={cx(inputCls, "pl-9")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={selected.length ? tp.addAnother : tp.whereTo} aria-label={tp.search} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.slice(0, q ? 8 : 6).map((d) => (
          <button
            type="button"
            key={d.id}
            onClick={() => {
              onChange([...value, d.id]);
              setQ("");
            }}
            className="min-h-9 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ink-2 hover:border-primary hover:text-primary"
          >
            + {d.name}, <span className="text-muted">{d.country}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
