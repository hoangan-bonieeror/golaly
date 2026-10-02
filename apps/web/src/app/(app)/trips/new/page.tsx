"use client";

import { createTripSchema, type TripSummary } from "@triply/shared";
import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DestinationPicker } from "@/components/trip/DestinationPicker";
import { Button, Field, inputCls } from "@/components/ui";
import { api } from "@/lib/api/client";
import { useAction, useDestinations } from "@/lib/api/queries";

export default function NewTripPage() {
  const router = useRouter();
  const destinations = useDestinations().data ?? [];
  const [title, setTitle] = useState("");
  const [dest, setDest] = useState<string[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [touched, setTouched] = useState(false);
  const create = useAction((body: object) => api.post<TripSummary>("/trips", body), { invalidate: [["trips"]], success: "Trip created" });

  const first = destinations.find((d) => d.id === dest[0]);
  const autoTitle = first ? first.name + (dest.length > 1 ? " & more" : "") : "";
  const payload = { title: (title || autoTitle).trim(), destinationIds: dest, startDate: start || null, endDate: end || null };
  const parsed = createTripSchema.safeParse(payload);
  const errors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!parsed.success) return;
    const trip = await create.run(payload);
    if (trip) router.push(`/trips/${trip.id}`);
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
        <input className={inputCls} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle || "e.g. Japan — 7 Days"} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date">
          <input className={inputCls} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="End date" error={touched ? errors.endDate : undefined}>
          <input className={inputCls} type="date" min={start || undefined} value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>

      <p className="flex items-center gap-2 rounded-2xl bg-sand-2 px-4 py-3 text-sm text-ink-2">
        <Lock className="size-4 shrink-0" /> New trips are private. You choose when to share.
      </p>

      <div className="flex gap-3">
        <Button type="button" variant="secondary" size="lg" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" size="lg" className="flex-1" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create trip"}
        </Button>
      </div>
    </form>
  );
}
