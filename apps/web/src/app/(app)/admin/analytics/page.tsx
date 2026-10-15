"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ANALYTICS_RANGES, type AnalyticsFunnelStep, type AnalyticsKpi, type AnalyticsOverview, type AnalyticsRange } from "@triply/shared";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Minus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AdminHeader } from "@/components/admin/AdminShell";
import { BarList, DailyChart, Meter, Sparkline, fmt } from "@/components/admin/charts";
import { ErrorState, PageLoader, cx } from "@/components/ui";
import { api } from "@/lib/api/client";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Analytics />
    </Suspense>
  );
}

const KPI: Record<AnalyticsKpi["key"], { label: string; hint: string; rate?: boolean }> = {
  newUsers: { label: "New people", hint: "Sign-ups in the period" },
  activeUsers: { label: "Active people", hint: "Did something: planned, signed in, posted, commented or liked" },
  tripsCreated: { label: "Trips created", hint: "New trips, including remixes" },
  collabRate: { label: "Planned together", hint: "Share of new trips with two or more travelers", rate: true },
  tripsHappened: { label: "Trips that started", hint: "Trips whose first day fell in the period" },
};

const STEPS: Record<AnalyticsFunnelStep, string> = {
  registered: "Signed up",
  createdTrip: "Created a trip",
  plannedStop: "Planned a stop",
  collaborated: "Planned with others",
  tripHappened: "Trip started",
  markedStop: "Marked where they went",
  shared: "Shared (post or public trip)",
};

function Analytics() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = Number(params.get("days"));
  const days: AnalyticsRange = (ANALYTICS_RANGES as readonly number[]).includes(raw) ? (raw as AnalyticsRange) : 30;
  useDocumentTitle("Analytics · Admin");
  const q = useQuery({
    queryKey: ["admin", "analytics", days],
    queryFn: () => api.get<AnalyticsOverview>(`/admin/analytics/overview?days=${days}`),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const setDays = (d: AnalyticsRange) => router.replace(`${pathname}?days=${d}`, { scroll: false });
  const o = q.data;

  return (
    <div className="space-y-6">
      <AdminHeader
        title="Analytics"
        body="How people use TRIPLY: growth, activation and collaboration, the catalog's health and security signals. Counts only, never who. Days are UTC; numbers refresh every 5 minutes."
      />

      {/* One filter row, above everything it scopes. */}
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Period" className="flex rounded-full border border-line bg-surface p-0.5">
          {ANALYTICS_RANGES.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={cx("h-9 rounded-full px-4 text-sm font-semibold", days === d ? "bg-ink text-on-ink" : "text-ink-2 hover:bg-sand-2")}
            >
              {d}<span className="hidden sm:inline">&nbsp;days</span>
              <span className="sr-only sm:hidden"> days</span>
            </button>
          ))}
        </div>
        {o && (
          <p className="text-sm text-muted">
            {o.range.from} → {o.range.to} · compared with the {days} days before
          </p>
        )}
      </div>

      {q.isLoading ? (
        <PageLoader />
      ) : q.isError || !o ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        // Refetching keeps the frame (dimmed), no skeleton flash.
        <div className={cx("space-y-6 transition-opacity", q.isPlaceholderData && "opacity-60")} aria-busy={q.isFetching}>
          <section aria-label="Headline numbers" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {o.kpis.map((k) => (
              <StatTile key={k.key} kpi={k} days={days} />
            ))}
          </section>

          <section aria-label="Daily trends" className="grid gap-4 lg:grid-cols-2">
            <DailyChart title="Sign-ups per day" unit="sign-ups" kind="columns" data={o.daily.map((d) => ({ date: d.date, value: d.signups }))} />
            <DailyChart title="Active people per day" unit="active people" kind="line" data={o.daily.map((d) => ({ date: d.date, value: d.active }))} />
          </section>

          <section className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <Card title="Activation" sub={`What the ${fmt(o.funnel[0]?.users ?? 0)} people who signed up in the period have done since`}>
              <BarList
                max={o.funnel[0]?.users || 1}
                rows={o.funnel.map((f) => ({
                  key: f.step,
                  label: STEPS[f.step],
                  value: f.users,
                  note: o.funnel[0]?.users ? `${Math.round((f.users / o.funnel[0].users) * 100)}%` : undefined,
                }))}
              />
              <p className="mt-3 text-xs text-muted">Steps aren&apos;t strictly in order: someone invited to a trip can plan a stop without creating one.</p>
            </Card>
            <Card title="Where new trips go" sub="Destinations of trips created in the period">
              {o.topDestinations.length ? (
                <BarList
                  rows={o.topDestinations.map((d) => ({
                    key: d.slug,
                    label: (
                      <Link href={`/explore/${d.slug}`} className="hover:underline">
                        {d.name}
                      </Link>
                    ),
                    value: d.trips,
                  }))}
                />
              ) : (
                <p className="text-sm text-muted">No trips with a destination in this period.</p>
              )}
            </Card>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card title="Catalog" sub={`${fmt(o.catalog.places)} active places`}>
              <div className="space-y-4">
                <Meter label="With a photo" value={o.catalog.withPhoto} total={o.catalog.places} />
                <Meter label="With opening hours" value={o.catalog.withHours} total={o.catalog.places} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <Fact label="Photos to review" value={o.catalog.photosPending} href="/admin/photos" />
                <Fact label="Possible duplicates" value={o.catalog.duplicatesPending} href="/admin/duplicates" />
              </dl>
              <p className="mt-3 text-sm text-ink-2">
                Last sync:{" "}
                {o.catalog.lastRun ? (
                  <Link href="/admin/runs" className="font-medium text-primary hover:underline">
                    {o.catalog.lastRun.status} · {new Date(o.catalog.lastRun.startedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                  </Link>
                ) : (
                  "never"
                )}
              </p>
            </Card>
            <Card title="Security signals" sub="From the audit log and sessions, this period">
              <ul className="divide-y divide-line text-sm">
                <Signal label="Accounts locked right now" value={o.ops.lockedNow} />
                <Signal label="Lockouts (5 wrong passwords)" value={o.ops.loginLocks} />
                <Signal label="Refresh token replayed (session revoked)" value={o.ops.tokenReuse} serious />
                <Signal label="Sessions revoked" value={o.ops.revokedSessions} neutral />
                <Signal label="Reports filed" value={o.ops.reports} />
              </ul>
            </Card>
          </section>

          <p className="text-xs text-muted">Generated {new Date(o.generatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.</p>
        </div>
      )}
    </div>
  );
}

function StatTile({ kpi, days }: { kpi: AnalyticsKpi; days: number }) {
  const meta = KPI[kpi.key];
  const value = meta.rate ? `${kpi.value}%` : fmt(kpi.value);
  const diff = kpi.value - kpi.previous;
  // Rates move in points; counts in percent of the previous period (none when it was empty).
  const delta = meta.rate
    ? `${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${Math.abs(Math.round(diff * 10) / 10)} pts`
    : kpi.previous
      ? Math.abs(diff / kpi.previous) >= 10
        ? `×${fmt(Math.round((kpi.value / kpi.previous) * 10) / 10)}`
        : `${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${Math.abs(Math.round((diff / kpi.previous) * 100))}%`
      : kpi.value
        ? "new"
        : "±0";
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  return (
    <div className="flex min-w-0 flex-col justify-between rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-card">
      <div>
        <h3 className="text-sm text-ink-2" title={meta.hint}>
          {meta.label}
        </h3>
        <p className="mt-1 text-3xl font-semibold leading-tight">{value}</p>
        <p className={cx("mt-1 flex items-center gap-1 text-xs font-semibold", diff > 0 ? "text-primary" : diff < 0 ? "text-accent-700" : "text-muted")}>
          <Icon className="size-3.5" aria-hidden />
          {delta}
        </p>
        <p className="text-xs text-muted">vs previous {days} days</p>
      </div>
      {kpi.series && <Sparkline values={kpi.series} className="mt-3 w-full" />}
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-card sm:p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {sub && <p className="mb-4 mt-0.5 text-sm text-muted">{sub}</p>}
      {children}
    </section>
  );
}

function Fact({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <div className="rounded-xl bg-sand-2 px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd>
        <Link href={href} className="text-lg font-semibold hover:underline">
          {fmt(value)}
        </Link>
      </dd>
    </div>
  );
}

/** A security count with a status icon + word, never colour alone. */
function Signal({ label, value, serious, neutral }: { label: string; value: number; serious?: boolean; neutral?: boolean }) {
  const flag = value > 0 && !neutral;
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-ink-2">{label}</span>
      <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
        {flag ? (
          <AlertTriangle className={cx("size-4", serious ? "text-danger" : "text-gold-700")} aria-hidden />
        ) : !neutral ? (
          <CheckCircle2 className="size-4 text-primary" aria-hidden />
        ) : null}
        {fmt(value)}
        {flag && <span className="sr-only">{serious ? "(needs a look now)" : "(worth a look)"}</span>}
      </span>
    </li>
  );
}
