"use client";

import { useQuery } from "@tanstack/react-query";
import type { AdminPlaceDetail, AdminPlacePatch, LockableField } from "@golaly/shared";
import { ChevronLeft, ExternalLink, Lock, Undo2, Unlock } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { Badge, Button, ErrorState, Field, PageLoader, inputCls, timeAgo } from "@/components/ui";
import { ApiError, api } from "@/lib/api/client";
import { useAction, useCategories } from "@/lib/api/queries";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

interface Form {
  name: string;
  address: string;
  phone: string;
  website: string;
  openingHours: string;
  categoryKey: string;
  lat: string;
  lng: string;
  status: AdminPlaceDetail["status"];
}

const toForm = (p: AdminPlaceDetail): Form => ({
  name: p.name,
  address: p.address,
  phone: p.phone ?? "",
  website: p.website ?? "",
  openingHours: p.openingHours ?? "",
  categoryKey: p.categoryKey ?? "",
  lat: String(p.lat),
  lng: String(p.lng),
  status: p.status,
});

export default function AdminPlacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ["admin", "place", id], queryFn: () => api.get<AdminPlaceDetail>(`/admin/places/${id}`), retry: false });
  useDocumentTitle(q.data ? `${q.data.name} · Admin` : "Place · Admin");
  if (q.isLoading) return <PageLoader />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} page />;
  // Keyed on updatedAt: after a save the form starts from the saved values; background refetches don't wipe edits.
  return <Editor key={q.data.updatedAt} place={q.data} />;
}

function Editor({ place: p }: { place: AdminPlaceDetail }) {
  const cats = useCategories().data ?? [];
  const flat = cats.flatMap((c) => [c, ...(c.children ?? [])]);
  const [form, setForm] = useState<Form>(() => toForm(p));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inv = [["admin", "place", p.id], ["admin", "places"], ["places"]];
  const save = useAction((body: AdminPlacePatch) => api.patch<AdminPlaceDetail>(`/admin/places/${p.id}`, body), { invalidate: inv, success: "Saved — edited fields are locked", silentErrors: true });
  const unlock = useAction((field: LockableField) => api.patch<AdminPlaceDetail>(`/admin/places/${p.id}`, { unlock: [field] }), {
    invalidate: inv,
    success: "Unlocked — the next sync takes it from the sources",
  });
  const undo = useAction((mergeId: string) => api.post(`/admin/place-merges/${mergeId}/undo`), { invalidate: inv, success: "Merge undone" });
  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const locked = new Set(p.lockedFields);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const before = toForm(p);
    const body: AdminPlacePatch = {};
    const lat = Number(form.lat);
    const lng = Number(form.lng);
    const local: Record<string, string> = {};
    if (!form.name.trim()) local.name = "A place needs a name.";
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) local.lat = "Latitude is between -90 and 90.";
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) local.lng = "Longitude is between -180 and 180.";
    setErrors(local);
    if (Object.keys(local).length) return;
    if (form.name !== before.name) body.name = form.name.trim();
    if (form.address !== before.address) body.address = form.address.trim();
    if (form.phone !== before.phone) body.phone = form.phone.trim() || null;
    if (form.website !== before.website) body.website = form.website.trim() || null;
    if (form.openingHours !== before.openingHours) body.openingHours = form.openingHours.trim() || null;
    if (form.categoryKey !== before.categoryKey && form.categoryKey) body.categoryKey = form.categoryKey;
    if (form.lat !== before.lat || form.lng !== before.lng) Object.assign(body, { lat, lng });
    if (form.status !== before.status) body.status = form.status;
    if (!Object.keys(body).length) return;
    try {
      await save.mutateAsync(body);
    } catch (err) {
      setErrors(err instanceof ApiError ? { ...(err.fields ?? {}), form: err.message } : { form: "Couldn't save." });
    }
  };

  const lockNote = (f: LockableField) =>
    locked.has(f) ? (
      <button type="button" onClick={() => unlock.run(f)} className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" aria-label={`Unlock ${f.replace("_", " ")}`}>
        <Lock className="size-3" aria-hidden /> locked · <Unlock className="size-3" aria-hidden /> unlock
      </button>
    ) : p.fieldSources[f] ? (
      <span className="ml-2 text-xs text-muted">from {p.fieldSources[f]}</span>
    ) : null;

  return (
    <div className="space-y-6">
      <Link href="/admin/places" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
        <ChevronLeft className="size-4" aria-hidden /> All places
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">{p.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {[p.categoryLabel, p.areaName].filter(Boolean).join(" · ")} · quality {Math.round(p.qualityScore * 100)}% · updated {timeAgo(p.updatedAt)}
          </p>
        </div>
        {p.mergedIntoId ? (
          <Button variant="secondary" href={`/admin/places/${p.mergedIntoId}`}>
            Merged — open the kept place
          </Button>
        ) : (
          <Button variant="secondary" href={`/places/${p.id}`}>
            <ExternalLink className="size-4" aria-hidden /> Public page
          </Button>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <form onSubmit={submit} className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 md:p-5" noValidate aria-label="Edit place">
          <Field label="Name" error={errors.name}>
            <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={200} />
          </Field>
          {lockNote("name")}
          <Field label="Address" error={errors.address}>
            <input className={inputCls} value={form.address} onChange={(e) => set("address", e.target.value)} maxLength={300} />
          </Field>
          {lockNote("address")}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Field label="Phone" error={errors.phone}>
                <input className={inputCls} value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={40} />
              </Field>
              {lockNote("phone")}
            </div>
            <div>
              <Field label="Website" error={errors.website}>
                <input className={inputCls} type="url" value={form.website} onChange={(e) => set("website", e.target.value)} maxLength={500} />
              </Field>
              {lockNote("website")}
            </div>
          </div>
          <Field label="Opening hours" hint="OSM syntax, e.g. Mo-Su 07:00-22:00" error={errors.openingHours}>
            <input className={`${inputCls} font-mono`} value={form.openingHours} onChange={(e) => set("openingHours", e.target.value)} maxLength={255} />
          </Field>
          {lockNote("opening_hours")}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <Field label="Category" error={errors.categoryKey}>
                <select className={inputCls} value={form.categoryKey} onChange={(e) => set("categoryKey", e.target.value)}>
                  {!form.categoryKey && <option value="">—</option>}
                  {flat.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              {lockNote("category")}
            </div>
            <Field label="Latitude" error={errors.lat}>
              <input className={inputCls} inputMode="decimal" value={form.lat} onChange={(e) => set("lat", e.target.value)} />
            </Field>
            <Field label="Longitude" error={errors.lng}>
              <input className={inputCls} inputMode="decimal" value={form.lng} onChange={(e) => set("lng", e.target.value)} />
            </Field>
          </div>
          {lockNote("coords")}
          <Field label="Visibility" hint="Hidden places disappear from search and Explore; closed ones show as closed.">
            <select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value)}>
              <option value="ACTIVE">Active</option>
              <option value="HIDDEN">Hidden</option>
              <option value="CLOSED">Closed</option>
            </select>
          </Field>
          {errors.form && (
            <p role="alert" className="text-sm text-danger">
              {errors.form}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setForm(toForm(p))}>
              Reset
            </Button>
            <Button type="submit" disabled={save.isPending || !!p.mergedIntoId}>
              Save changes
            </Button>
          </div>
        </form>

        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="font-display text-xl font-semibold">Sources</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface text-sm">
              {p.sources.length ? (
                p.sources.map((s) => (
                  <li key={s.id} className="space-y-0.5 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{s.provider}</Badge>
                      <span className="break-all font-mono text-xs text-muted">{s.externalId}</span>
                    </div>
                    <p>{s.name ?? "—"}</p>
                    <p className="text-xs text-muted">
                      {s.categoryKey ?? "unmapped category"} · seen {timeAgo(s.lastSeenAt)}
                      {s.missingRuns > 0 && ` · missing in ${s.missingRuns} run${s.missingRuns === 1 ? "" : "s"}`}
                      {s.operatingStatus !== "open" && ` · ${s.operatingStatus.replace("_", " ")}`}
                    </p>
                  </li>
                ))
              ) : (
                <li className="p-3 text-muted">Added by hand (no source records).</li>
              )}
            </ul>
          </section>

          {p.merges.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-display text-xl font-semibold">Merges</h2>
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface text-sm">
                {p.merges.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <span>
                      {m.role === "winner" ? "Absorbed " : "Merged into "}
                      <Link href={`/admin/places/${m.otherId}`} className="font-medium text-primary hover:underline">
                        {m.otherName}
                      </Link>
                      <span className="text-xs text-muted"> · {timeAgo(m.at)}</span>
                    </span>
                    {m.undoneAt ? (
                      <span className="text-xs text-muted">undone {timeAgo(m.undoneAt)}</span>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => undo.run(m.id)} disabled={undo.isPending} aria-label={`Undo merge with ${m.otherName}`}>
                        <Undo2 className="size-4" aria-hidden /> Undo
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="font-display text-xl font-semibold">History</h2>
            {p.history.length ? (
              <ol className="space-y-2 text-sm">
                {p.history.slice(0, 30).map((h, i) => (
                  <li key={i} className="rounded-xl border border-line bg-surface p-3">
                    <p className="text-xs text-muted">
                      {timeAgo(h.at)}
                      {h.actor && ` · ${h.actor}`}
                    </p>
                    <p className="break-words">{describe(h)}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted">No manual changes yet.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function describe(h: AdminPlaceDetail["history"][number]) {
  const d = h.detail as Record<string, unknown>;
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : String(v));
  if (h.kind === "merge") return d.role === "winner" ? `Absorbed ${show(d.with)}` : `Merged into ${show(d.with)}`;
  if (h.kind === "unmerge") return `Merge with ${show(d.with)} undone`;
  const field = String(d.field ?? "");
  if (field.startsWith("unlock:")) return `Unlocked ${field.slice(7).replace("_", " ")}`;
  return `${field.replace("_", " ")}: ${show(d.old)} → ${show(d.new)}`;
}
