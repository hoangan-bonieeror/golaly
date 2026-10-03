"use client";

import type { ItemView, PlaceView, TripSummary, TripTarget } from "@triply/shared";
import { ArrowLeft, Check, CheckCircle2, Luggage, MapPin, Plus } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { keys, useAction, useMe, useTripTargets } from "@/lib/api/queries";
import { Badge, Button, EmptyState, Field, Sheet, Skeleton, cx, formatDateRange, inputCls } from "../ui";

type Place = Pick<PlaceView, "id" | "name" | "category" | "destinationId" | "destinationName" | "status">;

/** "Add to trip" button + its sheet. The sheet only mounts (and fetches trips) once opened. */
export function AddToTripButton({ place, variant = "primary", size = "md", className, iconOnly }: { place: Place; variant?: "primary" | "secondary"; size?: "sm" | "md" | "lg"; className?: string; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const closed = place.status !== "ACTIVE";
  return (
    <>
      {iconOnly ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={closed}
          aria-label={`Add ${place.name} to a trip`}
          title="Add to trip"
          className={cx(
            "relative flex size-9 items-center justify-center rounded-full bg-primary text-white shadow-sm transition-colors hover:bg-primary-600 disabled:opacity-50",
            "before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
            className,
          )}
        >
          <Plus className="size-4" />
        </button>
      ) : (
        <Button variant={variant} size={size} onClick={() => setOpen(true)} disabled={closed} className={className}>
          <Plus className="size-4" /> Add to trip
        </Button>
      )}
      {open && <AddToTripSheet place={place} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddToTripSheet({ place, onClose }: { place: Place; onClose: () => void }) {
  const me = useMe();
  const path = usePathname();
  const signedIn = !!me.data;
  const targets = useTripTargets(place.id, signedIn);
  const [tripId, setTripId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState<{ trip: TripTarget; dayNumber: number } | null>(null);
  const trip = targets.data?.find((t) => t.id === tripId) ?? null;

  let body: React.ReactNode;
  if (me.isLoading || (signedIn && targets.isLoading)) body = <Skeleton className="h-48" />;
  else if (!signedIn)
    body = (
      <EmptyState
        icon={<Luggage className="size-7" />}
        level="h3"
        title="Log in to plan with this place"
        body="Add places to your trips, then share or plan them with friends."
        action={<Button href={`/login?next=${encodeURIComponent(path)}`}>Log in</Button>}
      />
    );
  else if (done)
    body = (
      <div className="space-y-5 py-2 text-center">
        <CheckCircle2 className="mx-auto size-12 text-primary" aria-hidden />
        <p className="text-base" role="status">
          <strong>{place.name}</strong> is on Day {done.dayNumber} of <strong>{done.trip.title}</strong>.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button href={`/trips/${done.trip.id}`}>View trip</Button>
          <Button variant="secondary" onClick={onClose}>
            Keep exploring
          </Button>
        </div>
      </div>
    );
  else if (creating)
    body = (
      <NewTripForm
        place={place}
        onCancel={() => setCreating(false)}
        onCreated={async (t) => {
          await targets.refetch();
          setTripId(t.id);
          setCreating(false);
        }}
      />
    );
  else if (trip) body = <DayPicker place={place} trip={trip} onBack={() => setTripId(null)} onDone={(dayNumber) => setDone({ trip, dayNumber })} />;
  else body = <TripList targets={targets.data ?? []} onPick={setTripId} onNew={() => setCreating(true)} />;

  return (
    <Sheet open onClose={onClose} title={done ? "Added" : `Add “${place.name}”`}>
      {body}
    </Sheet>
  );
}

function TripList({ targets, onPick, onNew }: { targets: TripTarget[]; onPick: (id: string) => void; onNew: () => void }) {
  return (
    <div className="space-y-3">
      {targets.length === 0 ? (
        <p className="text-sm text-muted">You don’t have a trip you can edit yet. Start one for this place:</p>
      ) : (
        <p className="text-sm text-muted">Choose a trip. Trips near this place are listed first.</p>
      )}
      <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1" aria-label="Your trips">
        {targets.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onPick(t.id)}
              className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left transition-colors hover:border-ink-2"
            >
              <span className="grain size-12 shrink-0 rounded-xl" style={{ background: `linear-gradient(135deg, ${t.cover[0]}, ${t.cover[1]})` }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{t.title}</span>
                <span className="block truncate text-xs text-muted">
                  {formatDateRange(t.startDate ?? undefined, t.endDate ?? undefined)}
                  {t.destinations.length > 0 && ` · ${t.destinations.join(" → ")}`}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {t.nearby && <Badge tone="primary">Nearby</Badge>}
                {t.role === "EDITOR" && <Badge>Editor</Badge>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button variant="secondary" className="w-full" onClick={onNew}>
        <Plus className="size-4" /> New trip
      </Button>
    </div>
  );
}

function DayPicker({ place, trip, onBack, onDone }: { place: Place; trip: TripTarget; onBack: () => void; onDone: (dayNumber: number) => void }) {
  const [dayId, setDayId] = useState<string | null>(trip.days.length === 1 ? trip.days[0].id : null);
  const [time, setTime] = useState("");
  const day = trip.days.find((d) => d.id === dayId) ?? null;
  const add = useAction(
    (d: { dayId: string }) =>
      api.post<ItemView>(`/days/${d.dayId}/items`, { type: place.category, title: place.name, placeId: place.id, startTime: time || null }),
    { invalidate: [keys.trip(trip.id), keys.tripTargets(place.id), ["trips"]] },
  );
  const dateLabel = (iso: string | null) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : null);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" /> {trip.title}
      </button>
      {trip.days.length === 0 ? (
        <p className="text-sm text-muted">This trip has no days yet. Open it to add dates first.</p>
      ) : (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink-2">Which day?</legend>
          <div className="grid max-h-[40vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {trip.days.map((d) => (
              <label
                key={d.id}
                className={cx(
                  "flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary",
                  dayId === d.id ? "border-ink bg-ink text-white" : "border-line bg-surface hover:border-ink-2",
                )}
              >
                <input type="radio" name="day" value={d.id} checked={dayId === d.id} onChange={() => setDayId(d.id)} className="sr-only" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    Day {d.dayNumber}
                    {dateLabel(d.date) && <span className={cx("font-normal", dayId === d.id ? "text-white/80" : "text-muted")}> · {dateLabel(d.date)}</span>}
                  </span>
                  <span className={cx("block truncate text-xs", dayId === d.id ? "text-white/80" : "text-muted")}>
                    {d.title ?? (d.itemCount ? `${d.itemCount} plan${d.itemCount === 1 ? "" : "s"}` : "Nothing planned yet")}
                  </span>
                </span>
                {d.hasPlace && (
                  <span className={cx("inline-flex items-center gap-1 text-xs font-semibold", dayId === d.id ? "text-white" : "text-primary")}>
                    <Check className="size-3.5" aria-hidden /> Added
                  </span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Field label="Time (optional)" hint="Timed plans are sorted into the day automatically.">
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={cx(inputCls, "max-w-40")} />
      </Field>
      {day?.hasPlace && <p className="rounded-xl bg-gold-50 px-3 py-2 text-sm text-gold-700">This place is already on Day {day.dayNumber}. Adding it again creates a second stop.</p>}
      <Button
        className="w-full"
        disabled={!day || add.isPending}
        onClick={async () => {
          if (day && (await add.run({ dayId: day.id }))) onDone(day.dayNumber);
        }}
      >
        <MapPin className="size-4" /> {day ? `Add to Day ${day.dayNumber}` : "Choose a day"}
      </Button>
    </div>
  );
}

function NewTripForm({ place, onCancel, onCreated }: { place: Place; onCancel: () => void; onCreated: (t: TripSummary) => Promise<void> }) {
  const [title, setTitle] = useState(place.destinationName ? `Trip to ${place.destinationName}` : "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const create = useAction(
    () =>
      api.post<TripSummary>("/trips", {
        title,
        startDate: start || null,
        endDate: end || start || null,
        destinationIds: place.destinationId ? [place.destinationId] : [],
      }),
    { invalidate: [["trips"]], success: "Trip created" },
  );
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const t = await create.run(undefined);
        if (t) await onCreated(t);
      }}
    >
      <Field label="Trip name">
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={120} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start (optional)">
          <input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="End (optional)">
          <input type="date" className={inputCls} value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <p className="text-xs text-muted">The trip starts private. You can invite friends and change the dates later.</p>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Back
        </Button>
        <Button type="submit" className="flex-1" disabled={create.isPending || title.trim().length < 2}>
          Create and continue
        </Button>
      </div>
    </form>
  );
}
