"use client";

import { ITEM_SLOTS, type ItemSlot, type ItemView, type PlaceView, type TripSummary, type TripTarget } from "@golaly/shared";
import { ArrowLeft, Check, CheckCircle2, Lightbulb, Luggage, MapPin, Plus } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useFormat, useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { keys, useAction, useMe, useTripTargets } from "@/lib/api/queries";
import { Badge, Button, EmptyState, Field, Sheet, Skeleton, cx, inputCls } from "../ui";

type Place = Pick<PlaceView, "id" | "name" | "category" | "destinationId" | "destinationName" | "status">;

/** "Add to trip" button + its sheet. The sheet only mounts (and fetches trips) once opened. */
export function AddToTripButton({ place, variant = "primary", size = "md", className, iconOnly }: { place: Place; variant?: "primary" | "secondary"; size?: "sm" | "md" | "lg"; className?: string; iconOnly?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const closed = place.status !== "ACTIVE";
  return (
    <>
      {iconOnly ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={closed}
          aria-label={t.explore.addToTrip.buttonLabel(place.name)}
          title={t.explore.addToTrip.button}
          className={cx(
            "relative flex size-9 items-center justify-center rounded-full bg-primary text-on-primary shadow-sm transition-colors hover:bg-primary-600 disabled:opacity-50",
            "before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
            className,
          )}
        >
          <Plus className="size-4" />
        </button>
      ) : (
        <Button variant={variant} size={size} onClick={() => setOpen(true)} disabled={closed} className={className}>
          <Plus className="size-4" /> {t.explore.addToTrip.button}
        </Button>
      )}
      {open && <AddToTripSheet place={place} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddToTripSheet({ place, onClose }: { place: Place; onClose: () => void }) {
  const me = useMe();
  const t = useT();
  const a = t.explore.addToTrip;
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
        title={a.logInTitle}
        body={a.logInBody}
        action={<Button href={`/login?next=${encodeURIComponent(path)}`}>{t.common.logIn}</Button>}
      />
    );
  else if (done)
    body = (
      <div className="space-y-5 py-2 text-center">
        <CheckCircle2 className="mx-auto size-12 text-primary" aria-hidden />
        <p className="text-base" role="status">
          {done.dayNumber === 0 ? a.addedToPool.before : a.added.before}
          <strong>{place.name}</strong>
          {done.dayNumber === 0 ? a.addedToPool.middle : a.added.middle(done.dayNumber)}
          <strong>{done.trip.title}</strong>
          {done.dayNumber === 0 ? a.addedToPool.after : a.added.after}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button href={`/trips/${done.trip.id}`}>{a.viewTrip}</Button>
          <Button variant="secondary" onClick={onClose}>
            {a.keepExploring}
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
    <Sheet open onClose={onClose} title={done ? a.addedTitle : a.title(place.name)}>
      {body}
    </Sheet>
  );
}

function TripList({ targets, onPick, onNew }: { targets: TripTarget[]; onPick: (id: string) => void; onNew: () => void }) {
  const t = useT();
  const f = useFormat();
  const a = t.explore.addToTrip;
  return (
    <div className="space-y-3">
      {targets.length === 0 ? (
        <p className="text-sm text-muted">{a.noTrips}</p>
      ) : (
        <p className="text-sm text-muted">{a.chooseTrip}</p>
      )}
      <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1" aria-label={a.yourTrips}>
        {targets.map((trip) => (
          <li key={trip.id}>
            <button
              type="button"
              onClick={() => onPick(trip.id)}
              className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left transition-colors hover:border-ink-2"
            >
              <span className="grain size-12 shrink-0 rounded-xl" style={{ background: `linear-gradient(135deg, ${trip.cover[0]}, ${trip.cover[1]})` }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{trip.title}</span>
                <span className="block truncate text-xs text-muted">
                  {f.dateRange(trip.startDate, trip.endDate)}
                  {trip.destinations.length > 0 && ` · ${trip.destinations.join(" → ")}`}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {trip.nearby && <Badge tone="primary">{a.nearby}</Badge>}
                {trip.role === "EDITOR" && <Badge>{t.labels.role.EDITOR}</Badge>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button variant="secondary" className="w-full" onClick={onNew}>
        <Plus className="size-4" /> {a.newTrip}
      </Button>
    </div>
  );
}

const POOL = "pool";

/** Day (and part of the day), or the trip's ideas pool — where the group votes before it's planned. */
function DayPicker({ place, trip, onBack, onDone }: { place: Place; trip: TripTarget; onBack: () => void; onDone: (dayNumber: number) => void }) {
  const [dayId, setDayId] = useState<string | null>(trip.days.length === 1 ? trip.days[0].id : null);
  const [slot, setSlot] = useState<ItemSlot>("ANY");
  const [time, setTime] = useState("");
  const t = useT();
  const f = useFormat();
  const a = t.explore.addToTrip;
  const day = trip.days.find((d) => d.id === dayId) ?? null;
  const toPool = dayId === POOL;
  const add = useAction(
    (d: { dayId: string }) =>
      d.dayId === POOL
        ? api.post<ItemView>(`/trips/${trip.id}/pool`, { type: place.category, title: place.name, placeId: place.id })
        : api.post<ItemView>(`/days/${d.dayId}/items`, { type: place.category, title: place.name, placeId: place.id, startTime: time || null, slot }),
    { invalidate: [keys.trip(trip.id), keys.tripTargets(place.id), ["trips"]] },
  );
  const dateLabel = (iso: string | null) => (iso ? f.day(iso, { weekday: "short", month: "short", day: "numeric" }) : null);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
        <ArrowLeft className="size-4" /> {trip.title}
      </button>
      {trip.days.length === 0 ? (
        <p className="text-sm text-muted">{a.noDays}</p>
      ) : (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ink-2">{a.whichDay}</legend>
          <div className="grid max-h-[40vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            <label
              className={cx(
                "flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed p-3 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary sm:col-span-2",
                toPool ? "border-ink bg-ink text-on-ink" : "border-line-strong bg-surface hover:border-ink-2",
              )}
            >
              <input type="radio" name="day" value={POOL} checked={toPool} onChange={() => setDayId(POOL)} className="sr-only" />
              <Lightbulb className={cx("size-5 shrink-0", toPool ? "text-on-ink" : "text-gold-700")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{a.toPool}</span>
                <span className={cx("block text-xs", toPool ? "text-on-ink/80" : "text-muted")}>{a.toPoolHint}</span>
              </span>
            </label>
            {trip.days.map((d) => (
              <label
                key={d.id}
                className={cx(
                  "flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary",
                  dayId === d.id ? "border-ink bg-ink text-on-ink" : "border-line bg-surface hover:border-ink-2",
                )}
              >
                <input type="radio" name="day" value={d.id} checked={dayId === d.id} onChange={() => setDayId(d.id)} className="sr-only" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {a.day(d.dayNumber)}
                    {dateLabel(d.date) && <span className={cx("font-normal", dayId === d.id ? "text-on-ink/80" : "text-muted")}> · {dateLabel(d.date)}</span>}
                  </span>
                  <span className={cx("block truncate text-xs", dayId === d.id ? "text-on-ink/80" : "text-muted")}>
                    {d.title ?? (d.itemCount ? a.plans(d.itemCount) : a.nothingPlanned)}
                  </span>
                </span>
                {d.hasPlace && (
                  <span className={cx("inline-flex items-center gap-1 text-xs font-semibold", dayId === d.id ? "text-on-ink" : "text-primary")}>
                    <Check className="size-3.5" aria-hidden /> {a.alreadyAdded}
                  </span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {!toPool && (
        <>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink-2">{t.trips.item.slot}</legend>
            <div role="radiogroup" className="grid grid-cols-2 gap-1 rounded-xl bg-sand-2 p-1 sm:grid-cols-4">
              {ITEM_SLOTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={slot === s}
                  disabled={!!time}
                  onClick={() => setSlot(s)}
                  className={cx("h-9 rounded-[9px] text-[13px] font-semibold disabled:opacity-50", slot === s && !time ? "bg-surface text-ink shadow-card" : "text-ink-2 enabled:hover:text-ink")}
                >
                  {t.trips.plan.slots[s]}
                </button>
              ))}
            </div>
          </fieldset>
          <Field label={a.time} hint={a.timeHint}>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={cx(inputCls, "max-w-40")} />
          </Field>
        </>
      )}
      {day?.hasPlace && <p className="rounded-xl bg-gold-50 px-3 py-2 text-sm text-gold-700">{a.alreadyOnDay(day.dayNumber)}</p>}
      <Button
        className="w-full"
        disabled={(!day && !toPool) || add.isPending}
        onClick={async () => {
          if (toPool) {
            if (await add.run({ dayId: POOL })) onDone(0);
          } else if (day && (await add.run({ dayId: day.id }))) onDone(day.dayNumber);
        }}
      >
        {toPool ? <Lightbulb className="size-4" /> : <MapPin className="size-4" />} {toPool ? a.addToPool : day ? a.addToDay(day.dayNumber) : a.chooseDay}
      </Button>
    </div>
  );
}

function NewTripForm({ place, onCancel, onCreated }: { place: Place; onCancel: () => void; onCreated: (t: TripSummary) => Promise<void> }) {
  const t = useT();
  const a = t.explore.addToTrip;
  const [title, setTitle] = useState(place.destinationName ? a.defaultTitle(place.destinationName) : "");
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
    { invalidate: [["trips"]], success: a.created },
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
      <Field label={a.tripName}>
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={120} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={a.start}>
          <input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label={a.end}>
          <input type="date" className={inputCls} value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <p className="text-xs text-muted">{a.privateNote}</p>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t.common.back}
        </Button>
        <Button type="submit" className="flex-1" disabled={create.isPending || title.trim().length < 2}>
          {a.createAndContinue}
        </Button>
      </div>
    </form>
  );
}
