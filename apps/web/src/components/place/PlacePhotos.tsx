"use client";

import type { ImageView, MediaView, PlaceDetail, PlacePhotoView } from "@triply/shared";
import { ChevronLeft, ChevronRight, Clock, EyeOff, Flag, ImagePlus, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { keys, useAction, useMe } from "@/lib/api/queries";
import { ReportSheet } from "../social/ReportSheet";
import { Badge, Button, Field, Sheet, cx, inputCls } from "../ui";
import { CategoryIcon } from "./categoryMeta";
import { safeHref } from "@/lib/utils";

/** <img> with the three stored widths, so phones don't download the 2400 px original. */
export function Photo({ image, alt, sizes, className, eager }: { image: ImageView; alt: string; sizes: string; className?: string; eager?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.url}
      srcSet={`${image.thumbUrl} 640w, ${image.url} ${Math.min(1280, image.width)}w, ${image.fullUrl} ${image.width}w`}
      sizes={sizes}
      alt={alt}
      width={image.width}
      height={image.height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={cx("size-full object-cover", className)}
      style={{ backgroundColor: image.color ?? undefined }}
    />
  );
}

const altFor = (p: PlacePhotoView, place: string) => p.caption || `${place}${p.credit.title ? ` — ${p.credit.title}` : ""}`;

/** The credit the licence requires, with every part linked where we know where it points. */
export function PhotoCredit({ photo, className }: { photo: PlacePhotoView; className?: string }) {
  const t = useT();
  const ph = t.explore.photos;
  const c = photo.credit;
  const ext = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;
  if (photo.source === "user")
    return (
      <span className={className}>
        {ph.photoBy}{" "}
        {c.authorUrl ? (
          <Link href={c.authorUrl} className="font-semibold underline-offset-2 hover:underline">
            {c.author}
          </Link>
        ) : (
          c.author
        )}
      </span>
    );
  // Open-data credits are outside links: http(s) only.
  const [src, authorHref, licenseHref] = [safeHref(c.sourceUrl), safeHref(c.authorUrl), safeHref(c.licenseUrl)];
  return (
    <span className={className}>
      {c.title && (
        <>
          {src ? (
            <a href={src} {...ext} className="underline-offset-2 hover:underline">
              “{c.title}”
            </a>
          ) : (
            `“${c.title}”`
          )}{" "}
        </>
      )}
      {c.author && (
        <>
          {ph.by}{" "}
          {authorHref ? (
            <a href={authorHref} {...ext} className="font-semibold underline-offset-2 hover:underline">
              {c.author}
            </a>
          ) : (
            <span className="font-semibold">{c.author}</span>
          )}
          {", "}
        </>
      )}
      {c.license &&
        (licenseHref ? (
          <a href={licenseHref} {...ext} className="underline-offset-2 hover:underline">
            {c.license}
          </a>
        ) : (
          c.license
        ))}
      {ph.via}
      {src ? (
        <a href={src} {...ext} className="underline-offset-2 hover:underline">
          {c.sourceName}
        </a>
      ) : (
        c.sourceName
      )}
    </span>
  );
}

/** Desktop mosaic per photo count: a large first photo, the rest filling a 4×2 grid without gaps. */
const TILE: Record<number, string[]> = {
  1: ["md:col-span-4 md:row-span-2"],
  2: ["md:col-span-2 md:row-span-2", "md:col-span-2 md:row-span-2"],
  3: ["md:col-span-2 md:row-span-2", "md:col-span-2", "md:col-span-2"],
  4: ["md:col-span-2 md:row-span-2", "md:col-span-2", "", ""],
  5: ["md:col-span-2 md:row-span-2", "", "", "", ""],
};

/** Place page gallery: a large first photo and up to four more; every photo opens a viewer with its credit. */
/** `slimEmpty`: with no photos, a one-line strip (the page already leads with a map) instead of the big empty panel. */
export function PlaceGallery({ place, slimEmpty }: { place: PlaceDetail; slimEmpty?: boolean }) {
  const t = useT();
  const ph = t.explore.photos;
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const photos = place.photos;
  const tiles = photos.slice(0, 5);

  return (
    <section aria-label={ph.label} className="space-y-2">
      {photos.length === 0 && slimEmpty ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-line bg-sand-2/50 px-4 py-2.5">
          <span className="min-w-[12rem] flex-1 text-sm text-ink-2">{ph.none(place.name)}</span>
          <AddPhotoButton place={place} onOpen={() => setAdding(true)} label={ph.beFirst} />
        </div>
      ) : photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line bg-sand-2/50 px-6 py-10 text-center">
          <CategoryIcon categoryKey={place.categoryKey} size="lg" />
          <p className="text-sm text-ink-2">{ph.none(place.name)}</p>
          <AddPhotoButton place={place} onOpen={() => setAdding(true)} label={ph.beFirst} />
        </div>
      ) : (
        <>
          <div className="grid gap-2 overflow-hidden rounded-[var(--radius-card)] md:h-[380px] md:grid-cols-4 md:grid-rows-2">
            {tiles.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setOpen(i)}
                className={cx("relative block overflow-hidden bg-sand-2 focus-visible:outline-offset-[-3px]", i === 0 ? "aspect-[16/10] md:aspect-auto" : "hidden md:block", TILE[tiles.length][i])}
                aria-label={ph.open(i + 1, photos.length, altFor(p, place.name))}
              >
                <Photo image={p.image} alt="" sizes={i === 0 ? "(min-width: 768px) 50vw, 100vw" : "25vw"} eager={i === 0} className="transition-transform duration-300 hover:scale-[1.02]" />
                {p.status === "PENDING" && (
                  <span className="absolute left-2 top-2">
                    <Badge tone="gold">
                      <Clock className="size-3" aria-hidden /> {ph.inReview}
                    </Badge>
                  </span>
                )}
                {i === 0 && photos.length > 1 && (
                  <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white md:hidden">1 / {photos.length}</span>
                )}
                {i === tiles.length - 1 && photos.length > tiles.length && (
                  <span className="absolute inset-0 hidden items-center justify-center bg-black/45 text-lg font-semibold text-white md:flex">+{photos.length - tiles.length}</span>
                )}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-xs text-muted">
              <PhotoCredit photo={photos[0]} />
              {photos.length > 1 && ` · ${ph.tapForCredit}`}
            </p>
            <AddPhotoButton place={place} onOpen={() => setAdding(true)} label={ph.add} compact />
          </div>
        </>
      )}
      {open !== null && <PhotoViewer photos={photos} index={open} place={place} onIndex={setOpen} onClose={() => setOpen(null)} />}
      {adding && <AddPhotoSheet place={place} onClose={() => setAdding(false)} />}
    </section>
  );
}

function AddPhotoButton({ place, onOpen, label, compact }: { place: PlaceDetail; onOpen: () => void; label: string; compact?: boolean }) {
  const me = useMe().data;
  const path = usePathname();
  if (place.status !== "ACTIVE") return null;
  if (!me)
    return (
      <Button variant="secondary" size={compact ? "sm" : "md"} href={`/login?next=${encodeURIComponent(path)}`}>
        <ImagePlus className="size-4" aria-hidden /> {label}
      </Button>
    );
  return (
    <Button variant="secondary" size={compact ? "sm" : "md"} onClick={onOpen}>
      <ImagePlus className="size-4" aria-hidden /> {label}
    </Button>
  );
}

function PhotoViewer({ photos, index, place, onIndex, onClose }: { photos: PlacePhotoView[]; index: number; place: PlaceDetail; onIndex: (i: number) => void; onClose: () => void }) {
  const me = useMe().data;
  const t = useT();
  const ph = t.explore.photos;
  const [reporting, setReporting] = useState(false);
  const p = photos[index];
  const invalidate = [keys.place(place.id), ["places"]];
  const remove = useAction(() => api.delete(`/place-photos/${p.id}`), { invalidate, success: ph.removed });
  const moderate = useAction((status: "APPROVED" | "HIDDEN") => api.patch(`/place-photos/${p.id}`, { status }), {
    invalidate,
    success: (r) => ((r as PlacePhotoView).status === "HIDDEN" ? ph.hidden : ph.approved),
  });
  if (!p) return null;
  const go = (d: number) => onIndex((index + d + photos.length) % photos.length);

  return (
    <Sheet open onClose={onClose} title={ph.viewerTitle(index + 1, photos.length)} wide>
      <div
        className="space-y-3"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(1);
          if (e.key === "ArrowLeft") go(-1);
        }}
      >
        <div className="relative overflow-hidden rounded-2xl bg-ink">
          <Photo image={p.image} alt={altFor(p, place.name)} sizes="(min-width: 768px) 720px, 100vw" eager className="max-h-[65vh] object-contain" />
          {photos.length > 1 && (
            <>
              <button type="button" onClick={() => go(-1)} aria-label={ph.previous} className="absolute left-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70">
                <ChevronLeft className="size-5" />
              </button>
              <button type="button" onClick={() => go(1)} aria-label={ph.next} className="absolute right-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70">
                <ChevronRight className="size-5" />
              </button>
            </>
          )}
        </div>
        {p.caption && <p className="text-sm text-ink">{p.caption}</p>}
        <p className="text-sm text-ink-2">
          <PhotoCredit photo={p} />
        </p>
        {p.status === "PENDING" && <p className="rounded-xl bg-gold-50 px-3 py-2 text-sm text-gold-700">{ph.pendingNotice}</p>}
        <div className="flex flex-wrap gap-2">
          {me?.isAdmin && p.status !== "APPROVED" && (
            <Button size="sm" onClick={() => moderate.run("APPROVED")} disabled={moderate.isPending}>
              <ShieldCheck className="size-4" aria-hidden /> {ph.approve}
            </Button>
          )}
          {me?.isAdmin && p.status !== "HIDDEN" && !p.mine && (
            <Button size="sm" variant="secondary" onClick={async () => (await moderate.run("HIDDEN")) && onClose()} disabled={moderate.isPending}>
              <EyeOff className="size-4" aria-hidden /> {ph.hide}
            </Button>
          )}
          {(p.mine || me?.isAdmin) && (
            <Button size="sm" variant="secondary" onClick={async () => (await remove.run(undefined)) && onClose()} disabled={remove.isPending}>
              <Trash2 className="size-4" aria-hidden /> {t.common.remove}
            </Button>
          )}
          {me && !p.mine && (
            <Button size="sm" variant="ghost" onClick={() => setReporting(true)}>
              <Flag className="size-4" aria-hidden /> {ph.report}
            </Button>
          )}
        </div>
      </div>
      {reporting && <ReportSheet open onClose={() => setReporting(false)} target="PLACE_PHOTO" targetId={p.id} />}
    </Sheet>
  );
}

function AddPhotoSheet({ place, onClose }: { place: PlaceDetail; onClose: () => void }) {
  const me = useMe().data;
  const t = useT();
  const ph = t.explore.photos;
  const fileRef = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<MediaView | null>(null);
  const [caption, setCaption] = useState("");
  const [own, setOwn] = useState(false);
  const [done, setDone] = useState<PlacePhotoView | null>(null);
  const upload = useAction((file: File) => api.upload<MediaView>("/media", file));
  const add = useAction(() => api.post<PlacePhotoView>(`/places/${place.id}/photos`, { mediaId: media!.id, caption: caption || undefined }), {
    invalidate: [keys.place(place.id), ["places"]],
  });

  let body: React.ReactNode;
  if (me && !me.emailVerified) body = <p className="text-sm text-ink-2">{ph.confirmEmail}</p>;
  else if (done)
    body = (
      <div className="space-y-4 text-center" role="status">
        <p className="text-base">{done.status === "APPROVED" ? ph.thanksLive : ph.thanksReview}</p>
        <Button onClick={onClose}>{t.common.done}</Button>
      </div>
    );
  else
    body = (
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await add.run(undefined);
          if (r) setDone(r);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-label={ph.choose}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) setMedia((await upload.run(f)) ?? null);
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={upload.isPending}
          className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-dashed border-line bg-sand-2/50 text-sm font-semibold text-ink-2 hover:border-ink-2"
        >
          {media ? (
            <Photo image={media} alt={ph.yourPhoto} sizes="480px" eager />
          ) : (
            <>
              <ImagePlus className="size-7" aria-hidden /> {upload.isPending ? ph.uploading : ph.choose}
            </>
          )}
        </button>
        <p className="text-xs text-muted">{ph.formats}</p>
        <Field label={ph.caption}>
          <input className={inputCls} value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} placeholder={ph.captionPlaceholder} />
        </Field>
        <label className="flex items-start gap-2.5 text-sm text-ink-2">
          <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} className="mt-0.5 size-5 accent-[var(--color-primary)]" />
          <span>{ph.rights(place.name)}</span>
        </label>
        <Button type="submit" className="w-full" disabled={!media || !own || add.isPending}>
          {ph.share}
        </Button>
      </form>
    );

  return (
    <Sheet open onClose={onClose} title={ph.sheetTitle(place.name)}>
      {body}
    </Sheet>
  );
}
