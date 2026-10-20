"use client";

import type { TripSummary } from "@golaly/shared";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n/client";

type Stamp = { id: string; city: string; country: string; year: number | null };

/** One stamp per destination across the trips shown, oldest first (undated trips last). */
export function stampsFrom(trips: TripSummary[], max = 12): Stamp[] {
  const seen = new Map<string, Stamp>();
  const dated = [...trips].sort((a, b) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999"));
  for (const t of dated)
    for (const d of t.destinations)
      if (!seen.has(d.id)) seen.set(d.id, { id: d.id, city: d.name, country: d.country, year: t.startDate ? Number(t.startDate.slice(0, 4)) : null });
  return [...seen.values()].slice(0, max);
}

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const INKS = ["var(--color-accent-700)", "var(--color-primary)", "var(--color-gold-700)"];

/**
 * The profile as a passport: a stamp for every place this traveller's trips go to. Each stamp's
 * shape, ink and tilt come from the place (stable across visits). They are pressed onto the page —
 * shrinking down with a bounce while a ring of ink spreads — the first time the section scrolls
 * into view; under reduced motion they are simply there.
 */
/** `title`: a heading other than “Passport” (the trip recap's stamps). */
export function PassportStamps({ trips, title }: { trips: TripSummary[]; title?: string }) {
  const t = useT().social.profile.passport;
  const stamps = useMemo(() => stampsFrom(trips), [trips]);
  const list = useRef<HTMLUListElement>(null);
  const [inView, setInView] = useState(false);
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return void requestAnimationFrame(() => setInView(true));
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [stamps.length]);

  if (!stamps.length) return null;
  return (
    <section aria-labelledby={`${uid}-h`} className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id={`${uid}-h`} className="font-display text-xl font-semibold">
          {title ?? t.title}
        </h2>
        <span className="font-mono text-xs uppercase tracking-wider text-muted">{t.count(stamps.length)}</span>
      </div>
      <svg width="0" height="0" className="absolute" aria-hidden>
        <filter id={`${uid}-ink`} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="3" result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -9 6.6" result="holes" />
          <feComposite in="SourceGraphic" in2="holes" operator="in" />
        </filter>
      </svg>
      <ul ref={list} className="flex flex-wrap justify-center gap-x-2 gap-y-1 sm:justify-start">
        {stamps.map((s, i) => (
          <li key={s.id}>
            <StampArt stamp={s} filter={`url(#${uid}-ink)`} pathId={`${uid}-arc-${i}`} stamped={inView} delay={i * 110} label={t.stamp(s.city, s.country, s.year)} arrived={t.arrived} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function StampArt({ stamp, filter, pathId, stamped, delay, label, arrived }: { stamp: Stamp; filter: string; pathId: string; stamped: boolean; delay: number; label: string; arrived: string }) {
  const h = hash(stamp.id);
  const ink = INKS[h % INKS.length];
  const round = (h >> 3) % 2 === 0;
  const tilt = ((h >> 5) % 25) - 12;
  const city = stamp.city.toUpperCase();
  const country = stamp.country.toUpperCase();
  const cityFit = city.length > 9 ? { textLength: 76, lengthAdjust: "spacingAndGlyphs" as const } : {};
  const style = { "--r": `${tilt}deg`, "--d": `${delay}ms`, transformOrigin: "50% 50%" } as React.CSSProperties;

  if (round) {
    // Serrated rim: a 44-tooth star polygon around the stamp.
    const teeth = Array.from({ length: 88 }, (_, i) => {
      const a = (i / 88) * Math.PI * 2;
      const r = i % 2 ? 47 : 50;
      return `${(56 + Math.cos(a) * r).toFixed(1)},${(56 + Math.sin(a) * r).toFixed(1)}`;
    }).join(" ");
    return (
      <svg viewBox="0 0 112 112" className={`stamp size-[7.5rem] ${stamped ? "is-stamped" : ""}`} style={style} role="img" aria-label={label}>
        <circle cx="56" cy="56" r="50" fill="none" stroke={ink} strokeWidth="3" className="stamp-ink" />
        <g filter={filter} fill="none" stroke={ink}>
          <polygon points={teeth} strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="56" cy="56" r="41" strokeWidth="2.2" />
          <circle cx="56" cy="56" r="26" strokeWidth="1.2" strokeDasharray="2 2.5" />
          <path id={pathId} d="M 22 56 A 34 34 0 0 1 90 56" stroke="none" />
          <text fontSize="9" fontWeight="700" letterSpacing="2" fontFamily="var(--font-mono)" fill={ink} stroke="none">
            <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle">
              {country}
            </textPath>
          </text>
          <text x="56" y="61" textAnchor="middle" fontSize="13" fontWeight="800" fontFamily="var(--font-mono)" fill={ink} stroke="none" {...(city.length > 7 ? { textLength: 48, lengthAdjust: "spacingAndGlyphs" as const } : {})}>
            {city}
          </text>
          <text x="56" y="84" textAnchor="middle" fontSize="9" fontWeight="700" letterSpacing="1.5" fontFamily="var(--font-mono)" fill={ink} stroke="none">
            {stamp.year ? `★ ${stamp.year} ★` : "★ ★ ★"}
          </text>
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 112 112" className={`stamp size-[7.5rem] ${stamped ? "is-stamped" : ""}`} style={style} role="img" aria-label={label}>
      <rect x="8" y="22" width="96" height="68" rx="6" fill="none" stroke={ink} strokeWidth="3" className="stamp-ink" />
      <g filter={filter} fill="none" stroke={ink}>
        <rect x="8" y="22" width="96" height="68" rx="6" strokeWidth="2.6" />
        <rect x="13" y="27" width="86" height="58" rx="3" strokeWidth="1.1" />
        <text x="56" y="41" textAnchor="middle" fontSize="8" fontWeight="700" letterSpacing="2" fontFamily="var(--font-mono)" fill={ink} stroke="none">
          {arrived.toUpperCase()}
        </text>
        <line x1="20" y1="46" x2="92" y2="46" strokeWidth="1" strokeDasharray="2 2" />
        <text x="56" y="63" textAnchor="middle" fontSize="15" fontWeight="800" fontFamily="var(--font-mono)" fill={ink} stroke="none" {...cityFit}>
          {city}
        </text>
        <text x="56" y="78" textAnchor="middle" fontSize="8" fontWeight="700" letterSpacing="1.5" fontFamily="var(--font-mono)" fill={ink} stroke="none">
          {country}
          {stamp.year ? ` · ${stamp.year}` : ""}
        </text>
      </g>
    </svg>
  );
}
