"use client";

/**
 * Generated "postcard" cover art — an original TRIPLY visual motif used in
 * place of user photos in the prototype. Deterministic per seed, so every
 * trip/post keeps its own look. When a photo was uploaded, it's layered on top.
 */
import { useId } from "react";
import type { ImageView } from "@triply/shared";
import { cx } from "@/lib/utils";

function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function ridge(r: () => number, base: number, amp: number, steps = 7) {
  const pts: string[] = [`M0,${base}`];
  for (let i = 1; i <= steps; i++) {
    const x = (i / steps) * 400;
    const y = base - r() * amp;
    const cx = x - 400 / steps / 2;
    pts.push(`Q${cx.toFixed(1)},${(y - amp * 0.4 * r()).toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}`);
  }
  pts.push("L400,300 L0,300 Z");
  return pts.join(" ");
}

export function Cover({
  palette,
  seed,
  className,
  children,
  rounded = true,
  imageUrl,
  image,
  sizes = "(min-width: 1024px) 50vw, 100vw",
  priority,
}: {
  imageUrl?: string | null;
  /** Responsive uploaded image (thumb/medium/full) — preferred over imageUrl. */
  image?: ImageView | null;
  sizes?: string;
  priority?: boolean;
  palette: [string, string];
  seed: string;
  className?: string;
  children?: React.ReactNode;
  rounded?: boolean;
}) {
  const r = rng(seed);
  const [a, b] = palette;
  // Unique per instance: the same trip can appear twice on a page (feed + sidebar), and a gradient whose
  // first definition sits in a hidden (display:none) copy doesn't paint anywhere.
  const gid = `g${useId().replace(/[^a-z0-9]/gi, "")}`;
  const sunX = 80 + r() * 240;
  const sunY = 95 + r() * 40;
  const water = r() > 0.55;
  return (
    <div className={cx("grain relative overflow-hidden", rounded && "rounded-[var(--radius-card)]", className)}>
      <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden>
        <defs>
          <linearGradient id={`${gid}s`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={a} />
            <stop offset="1" stopColor={b} />
          </linearGradient>
        </defs>
        <rect width="400" height="300" fill={`url(#${gid}s)`} />
        <circle cx={sunX} cy={sunY} r={22 + r() * 16} fill="#fff" opacity="0.85" />
        <path d={ridge(r, 190, 70)} fill={a} opacity="0.35" />
        <path d={ridge(r, 225, 60)} fill={a} opacity="0.6" />
        {water ? (
          <>
            <rect y="240" width="400" height="60" fill={a} opacity="0.85" />
            {[250, 262, 276].map((y, i) => (
              <path key={y} d={`M${40 + i * 70},${y} h${60 - i * 10}`} stroke="#fff" strokeOpacity="0.22" strokeWidth="1.5" strokeLinecap="round" />
            ))}
          </>
        ) : (
          <path d={ridge(r, 262, 40)} fill={a} opacity="0.9" />
        )}
      </svg>
      {image ? (
        // Uploaded photo: browser picks 640/1280/2400px; average colour shows instantly.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.url}
          srcSet={`${image.thumbUrl} 640w, ${image.url} ${Math.min(1280, image.width)}w, ${image.fullUrl} ${image.width}w`}
          sizes={sizes}
          width={image.width}
          height={image.height}
          alt=""
          decoding="async"
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          className="absolute inset-0 size-full object-cover"
          style={{ backgroundColor: image.color ?? undefined }}
        />
      ) : imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" decoding="async" />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/0 to-black/0" />
      {children && <div className="relative h-full">{children}</div>}
    </div>
  );
}
