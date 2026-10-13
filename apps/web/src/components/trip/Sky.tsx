"use client";

import { useId, useSyncExternalStore } from "react";
import { skyPhase, sunPosition, type SkyPhase } from "@/lib/sky";

/** The current minute, ticking once a minute; null during server render (so no hydration mismatch). */
const subscribe = (cb: () => void) => {
  const id = setInterval(cb, 60_000);
  return () => clearInterval(id);
};
const minute = () => Math.floor(Date.now() / 60_000);

export function useSky(at: { lat: number; lng: number } | null) {
  const now = useSyncExternalStore(subscribe, minute, () => null);
  if (now === null || !at) return null;
  const sun = sunPosition(new Date(now * 60_000), at.lat, at.lng);
  return { ...sun, phase: skyPhase(sun.altitude, sun.hourAngle) };
}

const TINT: Record<SkyPhase, [string, string, number]> = {
  dawn: ["#f0a07a", "#f6d6a6", 0.75],
  day: ["#9cc8d3", "#e3eedf", 0.6],
  dusk: ["#db5f35", "#efad66", 0.75],
  night: ["#17243b", "#2c3c58", 0.85],
};

/**
 * Sky over a map thumbnail, as it is right now at the trip's place: a tint for the time of day and
 * the sun (or moon) on a small arc, which rises into place on first paint and drifts with the clock.
 */
export function SkyLayer({ sky, width, height }: { sky: NonNullable<ReturnType<typeof useSky>>; width: number; height: number }) {
  const id = `sky-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const [top, mid, alpha] = TINT[sky.phase];
  const night = sky.phase === "night";
  // The moon sits roughly opposite the sun; both ride the same arc above a horizon at 55% height.
  const ha = night ? ((sky.hourAngle + 360) % 360) - 180 : sky.hourAngle;
  const alt = night ? Math.min(60, -sky.altitude) : sky.altitude;
  const horizon = height * 0.55;
  const x = Math.min(width - 7, Math.max(7, width / 2 + (ha / 110) * (width / 2 - 8)));
  const y = horizon - (Math.max(-8, alt) / 90) * (horizon - 9);
  return (
    <g>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} stopOpacity={alpha} />
          <stop offset="0.45" stopColor={mid} stopOpacity={alpha * 0.55} />
          <stop offset="0.85" stopColor={mid} stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width={width} height={height} rx="12" fill={`url(#${id})`} className="sky-tint" />
      {night &&
        [
          [0.16, 0.18],
          [0.34, 0.1],
          [0.58, 0.24],
          [0.8, 0.12],
          [0.9, 0.3],
        ].map(([fx, fy]) => <circle key={fx} cx={fx * width} cy={fy * height} r="0.9" fill="#fffdf8" opacity="0.85" />)}
      <g className="sky-in">
        <g className="sky-body" style={{ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)` }}>
          {night ? (
            <>
              <circle r="4.6" fill="#f3efe6" />
              <circle r="4.2" cx="2.2" cy="-1.4" fill={top} />
            </>
          ) : (
            <>
              <circle r="8.5" fill="#f4b942" opacity="0.25" />
              <circle r="4.6" fill={sky.phase === "day" ? "#f4b942" : "#f7c56a"} />
            </>
          )}
        </g>
      </g>
    </g>
  );
}
