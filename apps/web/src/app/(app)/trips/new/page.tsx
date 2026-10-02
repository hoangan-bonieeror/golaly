"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DestinationPicker } from "@/components/trip/DestinationPicker";
import { Button, Field, cx, inputCls } from "@/components/ui";
import { useStore } from "@/lib/store/store";

export default function NewTripPage() {
  const { actions, toast, db } = useStore();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [dest, setDest] = useState<string[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [touched, setTouched] = useState(false);

  const autoTitle = dest.length ? db.destinations.find((d) => d.id === dest[0])?.name + (dest.length > 1 ? " & more" : "") : "";
  const errors = {
    title: (title || autoTitle).trim().length >= 2 ? undefined : "Give your trip a name.",
    dates: start && end && end < start ? "End date can't be before the start date." : undefined,
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (errors.title || errors.dates) return;
    const trip = actions.createTrip({ title: title || autoTitle, destinationIds: dest, startDate: start, endDate: end });
    if (!trip) return;
    toast("Trip created");
    router.push(`/trips/${trip.id}`);
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-xl space-y-6" noValidate>
      <header>
        <h1 className="font-display text-3xl font-semibold md:text-4xl">New trip</h1>
        <p className="text-sm text-muted">Just the basics — you can change everything later.</p>
      </header>

      <Field label="Destinations" group>
        <DestinationPicker value={dest} onChange={setDest} />
      </Field>

      <Field label="Trip name" error={touched ? errors.title : undefined}>
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle || "e.g. Japan — 7 Days"} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date">
          <input className={inputCls} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="End date" error={touched ? errors.dates : undefined}>
          <input className={cx(inputCls)} type="date" min={start || undefined} value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>

      <p className="flex items-center gap-2 rounded-2xl bg-sand-2 px-4 py-3 text-sm text-ink-2">
        <Lock className="size-4 shrink-0" /> New trips are private. You choose when to share.
      </p>

      <div className="flex gap-3">
        <Button type="button" variant="secondary" size="lg" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" size="lg" className="flex-1">
          Create trip
        </Button>
      </div>
    </form>
  );
}
