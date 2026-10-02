"use client";

import { VISIBILITY_LABEL, type TripVisibility } from "@triply/shared";
import { ArrowLeft, Globe2, Link2, Lock, ShieldAlert, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DestinationPicker } from "@/components/trip/DestinationPicker";
import { Button, EmptyState, Field, Sheet, cx, inputCls } from "@/components/ui";
import { usePermissions } from "@/lib/store/hooks";
import { useStore } from "@/lib/store/store";

const VIS_ICON = { PRIVATE: Lock, LINK_ONLY: Link2, PUBLIC: Globe2 };

export default function TripSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const { db, actions, toast, ready } = useStore();
  const router = useRouter();
  const perm = usePermissions(id);
  const trip = db.trips.find((t) => t.id === id && !t.deletedAt);

  const [form, setForm] = useState({
    title: "",
    description: "",
    startDate: "",
    endDate: "",
    destinationIds: [] as string[],
    visibility: "PRIVATE" as TripVisibility,
    allowComments: true,
    allowFork: true,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (trip)
      setForm({
        title: trip.title,
        description: trip.description,
        startDate: trip.startDate ?? "",
        endDate: trip.endDate ?? "",
        destinationIds: trip.destinationIds,
        visibility: trip.visibility,
        allowComments: trip.allowComments,
        allowFork: trip.allowFork,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id]);

  if (!ready) return null;
  if (!trip) return <EmptyState icon={<Trash2 className="size-7" />} title="Trip not found" />;
  if (!perm.can("trip.edit_details"))
    return (
      <EmptyState
        icon={<ShieldAlert className="size-7" />}
        title="Only the owner can change trip settings"
        body="Editors can still add and edit itinerary items."
        action={<Button href={`/trips/${id}`}>Back to trip</Button>}
      />
    );

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const ok = actions.updateTrip(id, {
      ...form,
      startDate: form.startDate || undefined,
      endDate: form.endDate || undefined,
    });
    if (ok) {
      toast("Trip updated");
      router.push(`/trips/${id}`);
    }
  };

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <form onSubmit={save} className="mx-auto max-w-2xl space-y-8">
      <header className="flex items-center gap-3">
        <Link href={`/trips/${id}`} className="flex size-10 items-center justify-center rounded-full hover:bg-sand-2" aria-label="Back to trip">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="font-display text-3xl font-semibold">Trip settings</h1>
      </header>

      <section className="space-y-5 rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <Field label="Trip name">
          <input className={inputCls} value={form.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label="Description">
          <textarea className={cx(inputCls, "h-24 py-2.5")} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">
            <input className={inputCls} type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </Field>
          <Field label="End date">
            <input className={inputCls} type="date" value={form.endDate} min={form.startDate || undefined} onChange={(e) => set("endDate", e.target.value)} />
          </Field>
        </div>
        <Field label="Destinations" group>
          <DestinationPicker value={form.destinationIds} onChange={(v) => set("destinationIds", v)} />
        </Field>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink-2">Cover image</span>
          <div className="flex items-center gap-3">
            <span className="h-14 w-20 rounded-xl" style={{ background: `linear-gradient(135deg, ${trip.cover[0]}, ${trip.cover[1]})` }} />
            <Button type="button" variant="secondary" size="sm" onClick={() => toast("Uploads arrive with media storage (Week 7)")}>
              Change cover
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-semibold">Who can see this trip</h2>
        <div className="grid gap-2.5" role="radiogroup" aria-label="Visibility">
          {(["PRIVATE", "LINK_ONLY", "PUBLIC"] as TripVisibility[]).map((v) => {
            const Icon = VIS_ICON[v];
            const on = form.visibility === v;
            return (
              <button
                type="button"
                key={v}
                role="radio"
                aria-checked={on}
                onClick={() => set("visibility", v)}
                className={cx("flex items-center gap-4 rounded-2xl border bg-surface p-4 text-left", on ? "border-lagoon ring-2 ring-lagoon/15" : "border-line hover:border-ink-2")}
              >
                <span className={cx("flex size-10 items-center justify-center rounded-xl", on ? "bg-lagoon text-white" : "bg-sand-2 text-ink-2")}>
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold">{VISIBILITY_LABEL[v].label}</span>
                  <span className="block text-sm text-muted">{VISIBILITY_LABEL[v].hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        {form.visibility === "PUBLIC" && (
          <p className="rounded-xl bg-sand-2 px-3 py-2 text-xs text-ink-2">
            Public trips show the itinerary and places. Member emails, invite links, and private notes from your settings are never shown.
          </p>
        )}
      </section>

      <section className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
        <Toggle label="Allow comments" hint="People can comment on posts about this trip." checked={form.allowComments} onChange={(v) => set("allowComments", v)} />
        <Toggle label="Allow Fork / Remix" hint="Others can copy this public trip into their own plan. You'll be credited." checked={form.allowFork} onChange={(v) => set("allowFork", v)} />
      </section>

      <div className="flex gap-3">
        <Button type="button" variant="secondary" size="lg" href={`/trips/${id}`}>
          Cancel
        </Button>
        <Button type="submit" size="lg" className="flex-1">
          Save changes
        </Button>
      </div>

      {perm.can("trip.delete") && (
        <section className="rounded-[var(--radius-card)] border border-[#f1c9bf] bg-sunset-50/50 p-5">
          <h2 className="font-semibold text-danger">Delete trip</h2>
          <p className="mt-1 text-sm text-ink-2">Removes the trip for every member. Remixes others made stay intact.</p>
          <Button type="button" variant="danger" className="mt-3" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" /> Delete trip
          </Button>
        </section>
      )}

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this trip?">
        <p className="text-sm text-ink-2">
          <b>{trip.title}</b> will be removed for all members. This can&apos;t be undone from the app.
        </p>
        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)}>
            Keep trip
          </Button>
          <Button
            className="flex-1 !bg-danger"
            onClick={() => {
              actions.deleteTrip(id);
              toast("Trip deleted");
              router.push("/trips");
            }}
          >
            Delete
          </Button>
        </div>
      </Sheet>
    </form>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-4 p-4">
      <span className="flex-1">
        <span className="block font-medium">{label}</span>
        <span className="block text-sm text-muted">{hint}</span>
      </span>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative h-7 w-12 shrink-0 rounded-full bg-line transition-colors peer-checked:bg-lagoon peer-focus-visible:ring-2 peer-focus-visible:ring-lagoon/40 after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
    </label>
  );
}
