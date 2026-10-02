"use client";

import { ImagePlus, Lock } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Cover } from "@/components/trip/Cover";
import { Button, Field, cx, inputCls } from "@/components/ui";
import { routeLabel } from "@/lib/mock/selectors";
import { useStore } from "@/lib/store/store";

export default function NewPostPage() {
  return (
    <Suspense>
      <NewPost />
    </Suspense>
  );
}

function NewPost() {
  const { db, me, actions, toast } = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const ownTrips = db.trips.filter((t) => t.ownerId === me && !t.deletedAt);
  const [tripId, setTripId] = useState(params.get("trip") ?? ownTrips[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const trip = db.trips.find((t) => t.id === tripId);

  const publish = (visibility: "PUBLIC" | "DRAFT") => {
    const post = actions.createPost({ title, body, tripId: tripId || undefined, visibility });
    if (!post) return;
    toast(visibility === "DRAFT" ? "Draft saved" : "Published!");
    router.push(visibility === "DRAFT" ? `/u/${db.users.find((u) => u.id === me)?.username}` : `/posts/${post.id}`);
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold md:text-4xl">Share a journey</h1>
        <p className="text-sm text-muted">Turn a trip into a story others can discover and remix.</p>
      </header>

      <Field label="Trip" hint="Posts link to structured trip data so readers can reuse your itinerary.">
        <select className={inputCls} value={tripId} onChange={(e) => setTripId(e.target.value)}>
          <option value="">No trip — just a story</option>
          {ownTrips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} {t.visibility === "PRIVATE" ? "(private)" : ""}
            </option>
          ))}
        </select>
      </Field>

      {trip?.visibility === "PRIVATE" && (
        <div className="flex items-start gap-3 rounded-2xl border border-[#f1d9a6] bg-[#fdf6e7] p-3 text-sm text-[#7a5410]">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>
            This trip is private. Make it <b>Public</b> in trip settings before publishing, or save this post as a draft.
          </span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {trip ? (
          <Cover palette={trip.cover} seed={trip.id} className="col-span-2 row-span-2 aspect-square">
            <div className="flex h-full items-end p-3 text-sm font-semibold text-white">{routeLabel(db, trip)}</div>
          </Cover>
        ) : null}
        <button
          type="button"
          onClick={() => toast("Photo upload arrives with media storage (Week 7)")}
          className={cx("flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-line text-xs font-medium text-muted hover:border-ink-2", !trip && "col-span-3 aspect-[3/1]")}
        >
          <ImagePlus className="size-6" /> Add photos
        </button>
      </div>

      <Field label="Title">
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={trip ? `My ${trip.title}` : "A title for your story"} />
      </Field>
      <Field label="Story">
        <textarea className={cx(inputCls, "h-32 py-2.5")} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What made this trip special? Any tips for people who remix it?" />
      </Field>

      <div className="flex gap-3">
        <Button variant="secondary" size="lg" onClick={() => publish("DRAFT")} disabled={!title.trim()}>
          Save draft
        </Button>
        <Button size="lg" className="flex-1" onClick={() => publish("PUBLIC")} disabled={!title.trim()}>
          Publish
        </Button>
      </div>
    </div>
  );
}
