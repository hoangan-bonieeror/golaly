"use client";

import { useQuery } from "@tanstack/react-query";
import { cronProblem, type SyncJobInput, type SyncJobView, type SyncRunDetail } from "@triply/shared";
import { CalendarClock, FlaskConical, Pencil, Play, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { AdminHeader } from "@/components/admin/AdminShell";
import { LiveDot, RunProgress, RunStatus, isActive, runWhen, useLiveRuns } from "@/components/admin/runs";
import { Badge, Button, Chip, EmptyState, ErrorState, Field, PageLoader, Sheet, inputCls, timeAgo } from "@/components/ui";
import { ApiError, api } from "@/lib/api/client";
import { useAction, useCategories, useGeoAreas } from "@/lib/api/queries";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const SOURCES = [
  { key: "overture", label: "Overture Maps" },
  { key: "osm", label: "OpenStreetMap" },
  { key: "fsq", label: "Foursquare OS Places" },
];
const PRESETS = [
  { label: "Weekly (Mon 03:00 UTC)", value: "0 3 * * mon" },
  { label: "Daily (02:00 UTC)", value: "0 2 * * *" },
  { label: "Monthly (1st, 04:00 UTC)", value: "0 4 1 * *" },
];

/** Saved syncs: an area + sources (+ categories), on a schedule the catalog_scheduler DAG follows, or run by hand. */
export default function JobsPage() {
  useDocumentTitle("Sync jobs · Admin");
  const live = useLiveRuns();
  const [editing, setEditing] = useState<SyncJobView | "new" | null>(null);
  const q = useQuery({ queryKey: ["admin", "jobs"], queryFn: () => api.get<SyncJobView[]>("/admin/sync-jobs") });

  return (
    <div className="space-y-5">
      <AdminHeader
        title="Sync jobs"
        body="Schedules are cron in UTC; the catalog_scheduler DAG checks every 10 minutes and starts what's due. A job never runs twice at once."
        action={
          <div className="flex items-center gap-4">
            <LiveDot live={live} />
            <Button onClick={() => setEditing("new")}>
              <Plus className="size-4" aria-hidden /> New job
            </Button>
          </div>
        }
      />
      {q.isLoading ? (
        <PageLoader />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState
          icon={<CalendarClock className="size-7" />}
          title="No sync jobs yet"
          body="Create one to keep an area fresh automatically."
          action={<Button onClick={() => setEditing("new")}>New job</Button>}
        />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {q.data.map((j) => (
            <JobCard key={j.id} job={j} onEdit={() => setEditing(j)} />
          ))}
        </ul>
      )}
      {editing && <JobSheet job={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function JobCard({ job: j, onEdit }: { job: SyncJobView; onEdit: () => void }) {
  const router = useRouter();
  const inv = [["admin", "jobs"], ["admin", "runs"]];
  const run = useAction((dryRun: boolean) => api.post<SyncRunDetail>(`/admin/sync-jobs/${j.id}/run`, { dryRun }), {
    invalidate: inv,
    success: (r) => (r.trigger === "dry_run" ? "Dry run started" : "Run started"),
  });
  const toggle = useAction(() => api.patch(`/admin/sync-jobs/${j.id}`, { enabled: !j.enabled }), { invalidate: inv, success: j.enabled ? "Paused" : "Enabled" });
  const remove = useAction(() => api.delete(`/admin/sync-jobs/${j.id}`), { invalidate: inv, success: "Job deleted" });
  const [confirm, setConfirm] = useState(false);
  const busy = j.lastRun ? isActive(j.lastRun.status) : false;
  const start = async (dryRun: boolean) => {
    const r = await run.run(dryRun);
    if (r) router.push(`/admin/runs/${r.id}`);
  };

  return (
    <li className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold">{j.name}</h2>
          <p className="text-sm text-muted">
            <span className="font-mono">{j.area ?? j.bbox}</span> · {j.providers.join(", ")}
            {j.categoryKeys.length > 0 && ` · ${j.categoryKeys.length} categor${j.categoryKeys.length === 1 ? "y" : "ies"}`}
            {!j.photos && " · no photos"}
          </p>
        </div>
        <Badge tone={j.enabled ? "primary" : "neutral"}>{j.enabled ? (j.schedule ? "Scheduled" : "Manual") : "Paused"}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted">Schedule</dt>
          <dd className="font-mono">{j.schedule ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Next run</dt>
          <dd>{j.enabled && j.schedule ? (j.nextRunAt ? new Date(j.nextRunAt).toLocaleString() : "computed within 10 min") : "—"}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        {j.lastRun ? (
          <Link href={`/admin/runs/${j.lastRun.id}`} className="flex items-center gap-2 text-sm hover:underline" aria-label={`Last run of ${j.name}: ${j.lastRun.status}`}>
            <RunStatus status={j.lastRun.status} /> <span className="text-xs text-muted">{runWhen(j.lastRun)}</span>
          </Link>
        ) : (
          <span className="text-xs text-muted">Never run · created {timeAgo(j.createdAt)}</span>
        )}
        {j.lastRun && <RunProgress progress={j.lastRun.progress} status={j.lastRun.status} />}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => start(false)} disabled={busy || run.isPending} aria-label={`Run ${j.name} now`}>
          <Play className="size-4" aria-hidden /> Run now
        </Button>
        <Button size="sm" variant="secondary" onClick={() => start(true)} disabled={busy || run.isPending} aria-label={`Dry run ${j.name}`}>
          <FlaskConical className="size-4" aria-hidden /> Dry run
        </Button>
        <Button size="sm" variant="secondary" onClick={onEdit} aria-label={`Edit ${j.name}`}>
          <Pencil className="size-4" aria-hidden /> Edit
        </Button>
        <Button size="sm" variant="ghost" onClick={() => toggle.run(undefined)} disabled={toggle.isPending}>
          {j.enabled ? "Pause" : "Enable"}
        </Button>
        {confirm ? (
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove.run(undefined)} disabled={remove.isPending}>
            Confirm delete
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} aria-label={`Delete ${j.name}`}>
            <Trash2 className="size-4" aria-hidden /> Delete
          </Button>
        )}
      </div>
    </li>
  );
}

function JobSheet({ job, onClose }: { job: SyncJobView | null; onClose: () => void }) {
  const cats = useCategories().data ?? [];
  const areas = useGeoAreas().data ?? [];
  const listId = useId();
  const [form, setForm] = useState<SyncJobInput>({
    name: job?.name ?? "",
    area: job?.area ?? "",
    bbox: job?.bbox ?? null,
    providers: job?.providers ?? ["overture", "osm"],
    categoryKeys: job?.categoryKeys ?? [],
    schedule: job?.schedule ?? "",
    enabled: job?.enabled ?? true,
    photos: job?.photos ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof SyncJobInput>(k: K, v: SyncJobInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleIn = (k: "providers" | "categoryKeys", v: string) => set(k, form[k].includes(v) ? form[k].filter((x) => x !== v) : [...form[k], v]);
  const save = useAction(
    (body: SyncJobInput) => (job ? api.patch<SyncJobView>(`/admin/sync-jobs/${job.id}`, body) : api.post<SyncJobView>("/admin/sync-jobs", body)),
    { invalidate: [["admin", "jobs"]], success: job ? "Job saved" : "Job created", silentErrors: true },
  );
  const schedule = form.schedule?.trim() ?? "";
  const cronError = schedule ? cronProblem(schedule) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (form.name.trim().length < 2) local.name = "Give the job a name.";
    if (!form.area?.trim() && !form.bbox) local.area = "Choose an area.";
    if (!form.providers.length) local.providers = "Choose at least one source.";
    if (cronError) local.schedule = cronError;
    setErrors(local);
    if (Object.keys(local).length) return;
    try {
      await save.mutateAsync({ ...form, area: form.area?.trim() || null, schedule: schedule || null });
      onClose();
    } catch (err) {
      setErrors(err instanceof ApiError ? { ...(err.fields ?? {}), form: err.message } : { form: "Couldn't save the job." });
    }
  };

  return (
    <Sheet open onClose={onClose} title={job ? `Edit ${job.name}` : "New sync job"} wide>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" error={errors.name}>
          <input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={80} />
        </Field>
        <Field label="Area" hint="A country code (vn), a province slug (vn-da-nang) or a destination slug." error={errors.area}>
          <input className={inputCls} list={listId} value={form.area ?? ""} onChange={(e) => set("area", e.target.value)} autoComplete="off" />
        </Field>
        <datalist id={listId}>
          {areas.map((a) => (
            <option key={a.slug} value={a.slug}>
              {a.displayName}
            </option>
          ))}
        </datalist>
        <Field label="Sources" group error={errors.providers}>
          <div className="flex flex-wrap gap-2">
            {SOURCES.map((s) => (
              <Chip key={s.key} type="button" active={form.providers.includes(s.key)} aria-pressed={form.providers.includes(s.key)} onClick={() => toggleIn("providers", s.key)}>
                {s.label}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="Categories" group hint="None selected = every category. Children follow their parent.">
          <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
            {cats.map((c) => (
              <Chip key={c.key} type="button" active={form.categoryKeys.includes(c.key)} aria-pressed={form.categoryKeys.includes(c.key)} onClick={() => toggleIn("categoryKeys", c.key)}>
                {c.label}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="Schedule (cron, UTC)" hint="Empty = run by hand only. minute hour day month weekday, e.g. 0 3 * * mon" error={errors.schedule ?? cronError ?? undefined}>
          <input className={`${inputCls} font-mono`} value={form.schedule ?? ""} onChange={(e) => set("schedule", e.target.value)} placeholder="0 3 * * mon" />
        </Field>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Chip key={p.value} type="button" active={schedule === p.value} onClick={() => set("schedule", p.value)}>
              {p.label}
            </Chip>
          ))}
        </div>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 accent-[var(--color-primary)]" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          Enabled (scheduled runs happen)
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 accent-[var(--color-primary)]" checked={form.photos} onChange={(e) => set("photos", e.target.checked)} />
          Find photos for new places afterwards
        </label>
        {errors.form && (
          <p role="alert" className="text-sm text-danger">
            {errors.form}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {job ? "Save" : "Create job"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
