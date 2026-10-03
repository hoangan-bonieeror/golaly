"use client";

import { createPostSchema, type MediaView, type PlacePhotoView, type PlaceView, type PostView } from "@triply/shared";
import { ImagePlus, Lock, MapPin, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { Cover } from "@/components/trip/Cover";
import { Button, Field, cx, inputCls } from "@/components/ui";
import { api } from "@/lib/api/client";
import { useAction, useMe, useMyTrips, useTrip } from "@/lib/api/queries";
import { useToast } from "@/lib/toast";

export default function NewPostPage() {
  return (
    <Suspense>
      <NewPost />
    </Suspense>
  );
}

function NewPost() {
  const me = useMe().data;
  const router = useRouter();
  const params = useSearchParams();
  const own = (useMyTrips("mine").items ?? []).filter((t) => t.myRole === "OWNER");
  const [tripId, setTripId] = useState<string>(params.get("trip") ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<MediaView[]>([]);
  const [error, setError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  const trip = own.find((t) => t.id === tripId);
  const toast = useToast();
  // Optional: show a photo on the page of a place from this trip (photo id → place id).
  const [photoPlace, setPhotoPlace] = useState<Record<string, string>>({});
  const tripDetail = useTrip(tripId, !!tripId && photos.length > 0);
  const tripPlaces: PlaceView[] = [];
  for (const d of tripId ? (tripDetail.data?.days ?? []) : [])
    for (const i of d.items) if (i.place && i.place.status === "ACTIVE" && !tripPlaces.some((p) => p.id === i.place!.id)) tripPlaces.push(i.place);

  const upload = useAction((file: File) => api.upload<MediaView>("/media", file));
  const create = useAction((payload: object) => api.post<PostView>("/posts", payload), { invalidate: [["feed"], ["profile"]] });

  const sharePhotos = async (postId: string) => {
    const pairs = photos.filter((p) => photoPlace[p.id]).map((p) => [p.id, photoPlace[p.id]] as const);
    if (!pairs.length) return;
    const results = await Promise.allSettled(pairs.map(([mediaId, placeId]) => api.post<PlacePhotoView>(`/places/${placeId}/photos`, { mediaId, postId })));
    const ok = results.filter((r): r is PromiseFulfilledResult<PlacePhotoView> => r.status === "fulfilled").map((r) => r.value);
    if (ok.length)
      toast(
        ok.some((r) => r.status === "PENDING")
          ? `Shared ${ok.length} photo${ok.length === 1 ? "" : "s"} with place pages — they'll appear after a quick review.`
          : `Shared ${ok.length} photo${ok.length === 1 ? "" : "s"} with place pages.`,
      );
    if (ok.length < pairs.length) toast("Some photos couldn't be added to place pages.", "error");
  };

  const publish = async (visibility: "PUBLIC" | "DRAFT") => {
    const payload = { title, body, tripId: tripId || null, visibility, mediaIds: photos.map((p) => p.id) };
    const parsed = createPostSchema.safeParse(payload);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(undefined);
    const post = await create.run(payload);
    if (!post) return;
    if (visibility === "PUBLIC") await sharePhotos(post.id);
    router.push(visibility === "DRAFT" ? `/u/${me?.username}` : `/posts/${post.id}`);
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold md:text-4xl">Share a journey</h1>
        <p className="text-sm text-muted">Turn a trip into a story others can discover and remix.</p>
      </header>

      <Field label="Trip" hint="Posts link to your structured itinerary so readers can reuse it.">
        <select className={inputCls} value={tripId} onChange={(e) => setTripId(e.target.value)}>
          <option value="">No trip — just a story</option>
          {own.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} {t.visibility === "PRIVATE" ? "(private)" : ""}
            </option>
          ))}
        </select>
      </Field>

      {trip?.visibility === "PRIVATE" && (
        <div className="flex items-start gap-3 rounded-2xl border border-gold/40 bg-gold-50 p-3 text-sm text-gold-700">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>
            This trip is private. Make it <b>Public</b> or <b>Link only</b> in trip settings before publishing, or save this post as a draft.
          </span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {photos.length === 0 && trip && (
          <Cover palette={trip.cover} imageUrl={trip.coverUrl} seed={trip.id} className="col-span-2 row-span-2 aspect-square">
            <div className="flex h-full items-end p-3 text-sm font-semibold text-white">{trip.route}</div>
          </Cover>
        )}
        {photos.map((p) => (
          <div key={p.id} className="relative aspect-square overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.thumbUrl ?? p.url} alt="" className="size-full object-cover" />
            <button onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))} className="absolute right-1.5 top-1.5 rounded-full bg-black/50 p-1 text-white" aria-label="Remove photo">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          aria-label="Add photos"
          tabIndex={-1}
          className="sr-only"
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])].slice(0, 10 - photos.length);
            e.target.value = "";
            for (const f of files) {
              const m = await upload.run(f);
              if (m) setPhotos((cur) => [...cur, m]);
            }
          }}
        />
        {photos.length < 10 && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={upload.isPending}
            className={cx("flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-line text-xs font-medium text-muted hover:border-ink-2", !trip && photos.length === 0 && "col-span-3 aspect-[3/1]")}
          >
            <ImagePlus className="size-6" /> {upload.isPending ? "Uploading…" : "Add photos"}
          </button>
        )}
      </div>

      {trip && photos.length > 0 && tripPlaces.length > 0 && (
        <fieldset className="space-y-2 rounded-2xl border border-line bg-surface p-4">
          <legend className="px-1 text-sm font-semibold text-ink-2">
            <MapPin className="mr-1 inline size-4" aria-hidden />
            Also show on place pages <span className="font-normal text-muted">(optional)</span>
          </legend>
          <p className="text-xs text-muted">Help other travelers: pick the place a photo shows. Only share photos you took. Shared when you publish.</p>
          {photos.map((p, i) => (
            <div key={p.id} className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumbUrl ?? p.url} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
              <select
                className={cx(inputCls, "flex-1")}
                aria-label={`Place for photo ${i + 1}`}
                value={photoPlace[p.id] ?? ""}
                onChange={(e) => setPhotoPlace({ ...photoPlace, [p.id]: e.target.value })}
              >
                <option value="">Don’t share this photo</option>
                {tripPlaces.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </fieldset>
      )}

      <Field label="Title">
        <input className={inputCls} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder={trip ? `My ${trip.title}` : "A title for your story"} />
      </Field>
      <Field label="Story">
        <textarea className={cx(inputCls, "h-32 py-2.5")} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What made this trip special? Any tips for people who remix it?" />
      </Field>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <Button variant="secondary" size="lg" onClick={() => publish("DRAFT")} disabled={!title.trim() || create.isPending}>
          Save draft
        </Button>
        <Button size="lg" className="flex-1" onClick={() => publish("PUBLIC")} disabled={!title.trim() || create.isPending || trip?.visibility === "PRIVATE"}>
          Publish
        </Button>
      </div>
    </div>
  );
}
