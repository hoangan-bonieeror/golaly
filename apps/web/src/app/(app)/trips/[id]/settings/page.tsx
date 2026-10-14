"use client";

import { localizeMessage, updateTripSchema, type MediaView, type TripDetail, type TripSummary, type TripVisibility } from "@triply/shared";
import { ArrowLeft, Globe2, ImagePlus, Link2, Lock, ShieldAlert, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Cover } from "@/components/trip/Cover";
import { DestinationPicker } from "@/components/trip/DestinationPicker";
import { Button, EmptyState, ErrorState, Field, PageLoader, Sheet, cx, inputCls } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { keys, useAction, useTrip } from "@/lib/api/queries";

const VIS_ICON = { PRIVATE: Lock, LINK_ONLY: Link2, PUBLIC: Globe2 };

export default function TripSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const q = useTrip(id);
  const trip = q.data;
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !trip) return <ErrorState page error={q.error} onRetry={() => q.refetch()} />;
  // Keyed by trip: the form starts from that trip's saved values (no effect-driven reset).
  return <TripSettings key={trip.id} trip={trip} />;
}

function TripSettings({ trip }: { trip: TripDetail }) {
  const id = trip.id;
  const router = useRouter();
  const { m: t, locale } = useI18n();
  const st = t.trips.settings;
  const fields = t.trips.fields;
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    title: trip.title,
    description: trip.description,
    startDate: trip.startDate ?? "",
    endDate: trip.endDate ?? "",
    destinationIds: trip.destinations.map((d) => d.id),
    visibility: trip.visibility as TripVisibility,
    allowComments: trip.allowComments,
    allowFork: trip.allowFork,
    estimatedBudget: trip.estimatedBudget?.toString() ?? "",
  });
  const [cover, setCover] = useState<{ id: string; url: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);


  const invalidate = [keys.trip(id), ["trips"], ["explore"], ["search"], ["profile"], ["feed"]];
  const save = useAction((body: object) => api.patch<TripSummary>(`/trips/${id}`, body), { invalidate, success: st.updated });
  const remove = useAction(() => api.delete(`/trips/${id}`), { invalidate: [["trips"]], success: st.deleted });
  const upload = useAction((file: File) => api.upload<MediaView>("/media", file), { success: st.coverUploaded });

  if (!trip.permissions.includes("trip.edit_details"))
    return (
      <EmptyState
        icon={<ShieldAlert className="size-7" />}
        title={st.ownerOnlyTitle}
        body={st.ownerOnlyBody}
        action={<Button href={`/trips/${id}`}>{st.backToTrip}</Button>}
      />
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      ...form,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      estimatedBudget: form.estimatedBudget ? Number(form.estimatedBudget) : null,
      ...(cover ? { coverMediaId: cover.id } : {}),
    };
    const parsed = updateTripSchema.safeParse(body);
    if (!parsed.success) {
      const f: Record<string, string> = {};
      for (const i of parsed.error.issues) f[String(i.path[0])] ??= localizeMessage(i.message, locale);
      return setErrors(f);
    }
    setErrors({});
    if (await save.run(body)) router.push(`/trips/${id}`);
  };

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-8" noValidate>
      <header className="flex items-center gap-3">
        <Link href={`/trips/${id}`} className="flex size-10 items-center justify-center rounded-full hover:bg-sand-2" aria-label={st.backToTrip}>
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="font-display text-3xl font-semibold">{st.title}</h1>
      </header>

      <section className="space-y-5 rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <Field label={fields.tripName} error={errors.title}>
          <input className={inputCls} value={form.title} maxLength={120} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label={st.description}>
          <textarea className={cx(inputCls, "h-24 py-2.5")} maxLength={2000} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={fields.startDate}>
            <input className={inputCls} type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </Field>
          <Field label={fields.endDate} error={errors.endDate}>
            <input className={inputCls} type="date" value={form.endDate} min={form.startDate || undefined} onChange={(e) => set("endDate", e.target.value)} />
          </Field>
        </div>
        <Field label={fields.destinations} group>
          <DestinationPicker value={form.destinationIds} onChange={(v) => set("destinationIds", v)} />
        </Field>
        <Field label={st.budget(trip.currency)} hint={st.budgetHint}>
          <input className={inputCls} inputMode="numeric" value={form.estimatedBudget} onChange={(e) => set("estimatedBudget", e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder={st.budgetPlaceholder(trip.currency)} />
        </Field>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink-2">{st.cover}</span>
          <div className="flex items-center gap-3">
            <Cover palette={trip.cover} imageUrl={cover?.url ?? trip.coverUrl} seed={trip.id} className="h-16 w-24 rounded-xl" rounded={false} />
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label={st.uploadCover}
              tabIndex={-1}
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const m = await upload.run(f);
                if (m) setCover({ id: m.id, url: m.url });
              }}
            />
            <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
              <ImagePlus className="size-4" /> {upload.isPending ? st.uploading : st.changeCover}
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-semibold">{st.whoCanSee}</h2>
        <div className="grid gap-2.5" role="radiogroup" aria-label={st.visibility}>
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
                className={cx("flex items-center gap-4 rounded-2xl border bg-surface p-4 text-left", on ? "border-primary ring-2 ring-primary/15" : "border-line hover:border-ink-2")}
              >
                <span className={cx("flex size-10 items-center justify-center rounded-xl", on ? "bg-primary text-on-primary" : "bg-sand-2 text-ink-2")}>
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold">{t.labels.visibility[v].label}</span>
                  <span className="block text-sm text-muted">{t.labels.visibility[v].hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        {form.visibility !== "PRIVATE" && (
          <p className="rounded-xl bg-sand-2 px-3 py-2 text-xs text-ink-2">
            {st.publicNote}
          </p>
        )}
      </section>

      <section className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
        <Toggle label={st.allowComments} hint={st.allowCommentsHint} checked={form.allowComments} onChange={(v) => set("allowComments", v)} />
        <Toggle label={st.allowFork} hint={st.allowForkHint} checked={form.allowFork} onChange={(v) => set("allowFork", v)} />
      </section>

      <div className="flex gap-3">
        <Button type="button" variant="secondary" size="lg" href={`/trips/${id}`}>
          {t.common.cancel}
        </Button>
        <Button type="submit" size="lg" className="flex-1" disabled={save.isPending}>
          {save.isPending ? t.common.saving : t.common.saveChanges}
        </Button>
      </div>

      {trip.permissions.includes("trip.delete") && (
        <section className="rounded-[var(--radius-card)] border border-accent/30 bg-accent-50/50 p-5">
          <h2 className="font-semibold text-danger">{st.deleteTrip}</h2>
          <p className="mt-1 text-sm text-ink-2">{st.deleteBody}</p>
          <Button type="button" variant="danger" className="mt-3" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" /> {st.deleteTrip}
          </Button>
        </section>
      )}

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title={st.deleteTitle}>
        <p className="text-sm text-ink-2">
          {st.deleteConfirm.before && `${st.deleteConfirm.before} `}
          <b>{trip.title}</b> {st.deleteConfirm.after}
        </p>
        <div className="mt-6 flex gap-3">
          <Button type="button" variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)}>
            {st.keepTrip}
          </Button>
          <Button
            type="button"
            className="flex-1 !bg-danger"
            disabled={remove.isPending}
            onClick={async () => {
              if (await remove.run(undefined)) router.push("/trips");
            }}
          >
            {t.common.delete}
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
      <span className="relative h-7 w-12 shrink-0 rounded-full bg-line transition-colors after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40" />
    </label>
  );
}
