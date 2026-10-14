"use client";

import { useQueryClient } from "@tanstack/react-query";
import { presentOn, type ItemSlot, type ItemView, type TripSummary } from "@triply/shared";
import { ArrowLeft, Bookmark, CheckCheck, Flag, Eye, GitFork, Globe2, Link2, ListChecks, Lock, Map as MapIcon, PenLine, Plus, Settings, Share2, Sparkles, UserPlus, Wallet } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ReviewSheet } from "@/components/itinerary/AfterTrip";
import { ItemSheet } from "@/components/itinerary/ItemSheet";
import { Itinerary } from "@/components/itinerary/Itinerary";
import { TripMap } from "@/components/map/TripMap";
import { useShare } from "@/components/social/PostCard";
import { DayBar, type DayFilter } from "@/components/trip/DayBar";
import { ExpensesPanel, type ExpenseMode } from "@/components/trip/ExpensesPanel";
import { ForkSheet } from "@/components/trip/ForkSheet";
import { InviteSheet } from "@/components/trip/InviteSheet";
import { MembersPanel } from "@/components/trip/MembersPanel";
import { RouteThumb } from "@/components/trip/RouteThumb";
import { FoldedMap } from "@/components/art/EmptyArt";
import { Morph } from "@/components/trip/TripCard";
import { Cover } from "@/components/trip/Cover";
import { Avatar, Badge, Button, EmptyState, ErrorState, IconButton, PageLoader, Sheet, Skeleton, cx } from "@/components/ui";
import { useFormat, useI18n, useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api/client";
import { keys, useAction, useMe, useTrip } from "@/lib/api/queries";
import { useMediaQuery } from "@/lib/hooks";
import { useTripRealtime } from "@/lib/realtime";
import { markable, tripPhase } from "@/lib/plan";
import { dayStats, formatKm } from "@/lib/trip-geo";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

type View = "list" | "map";

export default function TripPage() {
  return (
    <Suspense>
      <TripPlanner />
    </Suspense>
  );
}

/**
 * Trip planner (Atlas), edge to edge under the navbar. One header row, then the plan: from
 * 1024px the itinerary column and a full-height sticky map side by side, sharing one day filter
 * and one selection; below that, a List / Map switch and (on phones) a bottom action bar instead
 * of a floating button. Members live in a panel opened from the avatars (`?tab=members`).
 */
function TripPlanner() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const me = useMe().data;
  const { m: t, locale } = useI18n();
  const f = useFormat();
  const p = t.trips.planner;
  const q = useTrip(id);
  const trip = q.data;
  useDocumentTitle(trip?.title ?? (q.isError ? p.notAvailable : null));
  const { live, presence, reportActivity } = useTripRealtime(id, me?.id, !!trip?.myRole);
  const share = useShare();
  const wide = useMediaQuery("(min-width: 1024px)");
  const [selected, setSelected] = useState<ItemView | null>(null);
  /** Stop under the pointer, in the list or on the map — lifts the pin and outlines the card. */
  const [hovered, setHovered] = useState<string | null>(null);
  // Set by the trip card that was clicked: the header renders from it at once (and the card morphs into it).
  const qcPreview = useQueryClient();
  const preview = qcPreview.getQueryData<TripSummary>(["trip-preview", id]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [sheet, setSheet] = useState<{ open: boolean; dayId?: string; slot?: ItemSlot; pool?: boolean; item?: ItemView | null }>({ open: false });
  const [day, setDay] = useState<DayFilter | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [expenseMode, setExpenseMode] = useState<ExpenseMode>({ kind: "list" });

  // URL state: `?view=map` (narrow screens), `?tab=members` (the travelers panel) and `?tab=expenses`. Older `?tab=map` links still open the map.
  type Tab = "members" | "expenses" | null;
  const tab: Tab = search.get("tab") === "members" ? "members" : search.get("tab") === "expenses" ? "expenses" : null;
  const membersOpen = tab === "members";
  const view: View = search.get("view") === "map" || search.get("tab") === "map" ? "map" : "list";
  const planTop = useRef<HTMLDivElement>(null);
  const go = (v: View, panel: Tab = null) => {
    // Switching List ↔ Map brings the plan controls to the top, so the map fills the screen.
    if (v !== view) requestAnimationFrame(() => planTop.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    const params = new URLSearchParams();
    if (v === "map") params.set("view", "map");
    if (panel) params.set("tab", panel);
    const qs = params.toString();
    router.replace(`/trips/${id}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  // Tell collaborators which day this tab is editing ("An is editing Day 2").
  const editingDay = sheet.open && trip ? (trip.days.find((d) => d.id === (sheet.item?.dayId ?? sheet.dayId))?.dayNumber ?? null) : null;
  useEffect(() => reportActivity(editingDay), [editingDay, reportActivity]);

  const save = useAction((on: boolean) => (on ? api.post<TripSummary>(`/trips/${id}/save`) : api.delete<TripSummary>(`/trips/${id}/save`)), {
    invalidate: [keys.trip(id), ["trips"]],
    success: (r) => (r.savedByMe ? t.trips.save.added : t.trips.save.removed),
  });

  if (q.isLoading) return preview ? <PlannerPreview trip={preview} /> : <PageLoader />;
  if (q.isError || !trip) {
    if (q.error instanceof ApiError && q.error.status === 403)
      return (
        <div className="px-4 pt-4 md:px-8 md:pt-8">
        <EmptyState
          level="h1"
          icon={<Lock className="size-7" />}
          title={p.privateTitle}
          body={me ? p.privateBodyMember : p.privateBodyGuest}
          action={me ? <Button href="/explore">{p.explorePublic}</Button> : <Button href={`/login?next=/trips/${id}`}>{t.common.logIn}</Button>}
        />
        </div>
      );
    return (
      <div className="px-4 pt-4 md:px-8 md:pt-8">
        <ErrorState page error={q.error} onRetry={() => q.refetch()} />
      </div>
    );
  }

  const may = (a: string) => trip.permissions.includes(a as never);
  const canAdd = may("itinerary.add");
  const canEdit = may("itinerary.edit");
  const s = trip.stats;
  const VisIcon = trip.visibility === "PUBLIC" ? Globe2 : trip.visibility === "LINK_ONLY" ? Link2 : Lock;
  const totalKm = trip.days.reduce((sum, d) => sum + dayStats(d).km, 0);
  // Multi-city trips open on Day 1 so the map isn't squeezed around far-apart clusters.
  const dayFilter: DayFilter = day ?? (trip.destinations.length > 1 && trip.days.length > 1 ? 1 : "all");

  const select = (it: ItemView) => {
    setSelected((cur) => (cur?.id === it.id ? null : it));
    // Ideas have no day: they show on the map whatever day is shown.
    const d = it.dayId ? trip.days.find((x) => x.id === it.dayId) : null;
    if (d && dayFilter !== "all" && dayFilter !== d.dayNumber) setDay(d.dayNumber);
  };
  const changeDay = (d: DayFilter) => {
    setDay(d);
    if (selected?.dayId && d !== "all" && trip.days.find((x) => x.id === selected.dayId)?.dayNumber !== d) setSelected(null);
  };
  const addDayId = () => (dayFilter !== "all" ? trip.days.find((d) => d.dayNumber === dayFilter)?.id : (selected?.dayId ?? undefined)) ?? trip.days[0]?.id;
  // Who is there on each day (members' own dates).
  const dayPresence = (d: (typeof trip.days)[number]) => ({ present: trip.members.filter((m) => presentOn(m, d.date)).length, total: trip.members.length });
  const cityOf = (d: (typeof trip.days)[number]) => {
    const names = new Set(d.items.map((i) => i.place?.destinationName).filter(Boolean));
    return names.size === 1 ? [...names][0]! : null;
  };

  // Presence: who else has this trip open, and whether one of them is editing a day.
  const nameOf = (userId: string) => trip.members.find((m) => m.user.id === userId)?.user.displayName.split(" ")[0] ?? p.someone;
  const others = presence.filter((x) => x.userId !== me?.id);
  const onlineIds = new Set(presence.map((x) => x.userId));
  const editing = others.find((x) => x.editingDay !== null);
  const presenceText = editing
    ? p.presence.editing(nameOf(editing.userId), editing.editingDay!)
    : others.length === 1
      ? p.presence.hereToo(nameOf(others[0].userId))
      : others.length > 1
        ? p.presence.others(others.length)
        : live
          ? p.presence.live
          : null;
  const shareable = trip.visibility !== "PRIVATE";
  const bottomBar = canAdd;
  const phase = tripPhase(trip);
  const unmarked = trip.days.reduce((n, d) => n + d.items.filter((i) => markable(i) && i.status === "PLANNED").length, 0);
  const marked = trip.days.some((d) => d.items.some((i) => i.status !== "PLANNED"));
  const canSpend = may("expenses.manage");
  const openExpenses = (mode: ExpenseMode = { kind: "list" }) => {
    setExpenseMode(mode);
    go(view, "expenses");
  };
  const ta = t.after;
  const hasAbout = !!(trip.description || trip.forkedFrom || trip.myRole === "VIEWER" || (trip.visibility === "PUBLIC" && trip.forkCount > 0));

  return (
    <div className={cx("bg-surface lg:flex lg:h-[calc(100dvh-4rem)] lg:flex-col", bottomBar && "pb-20 md:pb-0")}>
      {/* Header: one row, as in the Atlas planner — the plan starts right under it. */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-4 py-4 md:px-7 md:py-5">
        <div className="flex min-w-0 flex-1 basis-[22rem] items-center gap-4 md:gap-5">
          <IconButton label={t.common.back} onClick={() => router.back()} className="size-11 shrink-0 border border-line bg-surface text-ink">
            <ArrowLeft className="size-[18px]" />
          </IconButton>
          <Morph name={`trip-cover-${trip.id}`}>
            <div className="hidden shrink-0 sm:block">
              <RouteThumb trip={trip} sky />
            </div>
          </Morph>
          <div className="min-w-0 flex-1">
            <Morph name={`trip-title-${trip.id}`}>
              <h1 className="font-display text-2xl font-extrabold leading-tight md:text-[32px]">{trip.title}</h1>
            </Morph>
            <div className="mt-1 flex flex-wrap items-center gap-x-[18px] gap-y-1 text-sm text-ink-2">
              <span>{trip.route || t.trips.destinationTbd}</span>
              {(trip.startDate || trip.endDate) && <span className="font-mono text-[13px]">{f.dateRange(trip.startDate, trip.endDate)}</span>}
              <span className="font-mono text-[13px]">
                <span className="hidden sm:inline">
                  {t.format.days(s.days)} ·{" "}
                </span>
                {t.format.places(s.places)}
                {totalKm > 0 && ` · ${formatKm(totalKm, locale)}`}
              </span>
              <span className="inline-flex items-center gap-1">
                <VisIcon className="size-3.5" aria-hidden /> {t.labels.visibility[trip.visibility].label}
              </span>
              {presenceText && (
                <span className="inline-flex items-center gap-1.5 font-semibold text-primary" role="status" title={p.presence.hint}>
                  <span aria-hidden className="size-2 rounded-full bg-primary" /> {presenceText}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {trip.myRole ? (
            <>
              {/* Phones: the role is in the travelers panel; the header keeps one row of actions. */}
              <span className="hidden sm:contents">
                <Badge tone={trip.myRole === "OWNER" ? "accent" : trip.myRole === "EDITOR" ? "primary" : "neutral"}>{p.youAre(t.labels.role[trip.myRole])}</Badge>
              </span>
              {/* The avatars open the travelers panel (roles, invites, leave). */}
              <button
                type="button"
                onClick={() => go(view, "members")}
                aria-label={p.manageMembers(trip.members.length)}
                className="mr-1 flex items-center rounded-full p-0.5 hover:bg-sand-2"
              >
                {trip.members.slice(0, 5).map((m, i) => (
                  <span
                    key={m.user.id}
                    title={p.memberTitle(m.user.displayName, onlineIds.has(m.user.id))}
                    className={cx("rounded-full ring-2", i > 0 && "-ml-2", onlineIds.has(m.user.id) && m.user.id !== me?.id ? "ring-primary" : "ring-surface", i >= 3 && "hidden sm:block")}
                  >
                    <Avatar user={m.user} size={32} />
                  </span>
                ))}
                {trip.members.length > 3 && (
                  <span aria-hidden className={cx("-ml-2 flex size-8 items-center justify-center rounded-full bg-sand-2 font-mono text-xs font-semibold text-ink-2 ring-2 ring-surface", trip.members.length <= 5 && "sm:hidden")}>
                    <span className="sm:hidden">+{trip.members.length - 3}</span>
                    <span className="hidden sm:inline">+{trip.members.length - 5}</span>
                  </span>
                )}
              </button>
            </>
          ) : (
            <Link href={`/u/${trip.owner.username}`} className="mr-1 flex items-center gap-2 rounded-xl py-1 pr-2 text-sm hover:bg-sand-2">
              <Avatar user={trip.owner} size={32} />
              <span>
                {p.by.before} <span className="font-semibold">{trip.owner.displayName}</span>{p.by.after && ` ${p.by.after}`}
              </span>
            </Link>
          )}
          {canSpend && (
            // Phones with the bottom action bar reach expenses there; the header keeps one row.
            <span className={bottomBar ? "hidden sm:contents" : "contents"}>
              <Button variant="secondary" className="h-11 w-11 px-0 sm:w-auto sm:px-[18px]" onClick={() => openExpenses()}>
                <Wallet className="size-4" aria-hidden /> <span className="sr-only sm:not-sr-only">{ta.expenses.open}</span>
              </Button>
            </span>
          )}
          {may("trip.edit_details") && (
            <Button href={`/trips/${trip.id}/settings`} variant="secondary" className="h-11 w-11 px-0 sm:w-auto sm:px-[18px]">
              <PenLine className="size-4" aria-hidden /> <span className="sr-only sm:not-sr-only">{t.common.edit}</span>
            </Button>
          )}
          {me && !trip.myRole && shareable && (
            <Button variant="secondary" className="h-11" onClick={() => save.run(!trip.savedByMe)} disabled={save.isPending} aria-pressed={trip.savedByMe}>
              <Bookmark className={cx("size-4", trip.savedByMe && "fill-accent text-accent")} /> {trip.savedByMe ? t.common.saved : t.common.save}
            </Button>
          )}
          {shareable && (
            <Button variant="secondary" className={cx("h-11 px-[18px]", bottomBar && "hidden md:inline-flex")} onClick={() => share(`/trips/${trip.id}`, trip.title)}>
              <Share2 className="size-4" /> {t.common.share}
            </Button>
          )}
          {may("members.invite") && (
            <Button className="h-11 w-11 px-0 sm:w-auto sm:px-[18px]" onClick={() => setInviteOpen(true)}>
              <UserPlus className="size-4" aria-hidden /> <span className="sr-only sm:not-sr-only">{t.common.invite}</span>
            </Button>
          )}
          {may("trip.fork") && (
            <Button variant="accent" className="h-11" onClick={() => setForkOpen(true)}>
              <GitFork className="size-4" /> {t.trips.useThisTrip}
            </Button>
          )}
          {!me && trip.visibility === "PUBLIC" && trip.allowFork && (
            <Button variant="accent" className="h-11" href={`/login?next=/trips/${trip.id}`}>
              <GitFork className="size-4" /> {p.logInToRemix}
            </Button>
          )}
          {/* Phones reach settings through Edit (same page); this saves a row in the header. */}
          {may("trip.change_visibility") && (
            <span className="hidden sm:contents">
              <IconButton label={p.tripSettings} onClick={() => router.push(`/trips/${trip.id}/settings`)} className="size-11 border border-line bg-surface">
                <Settings className="size-4" />
              </IconButton>
            </span>
          )}
        </div>
      </header>

      {/* Plan: from 1024px the planner fills the window — the itinerary column scrolls on its own
          beside a map that always shows in full. Below that, a List / Map switch. */}
      <div className="lg:flex lg:min-h-0 lg:flex-1">
        <section aria-label={p.itinerary} className="min-w-0 lg:w-[460px] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-line xl:w-[560px]">
          <div ref={planTop} className="scroll-mt-14 md:scroll-mt-16" />
          {/* Stays under the top bar so the day (and List / Map) is always one tap away. */}
          <div className="sticky top-14 z-20 space-y-3 border-b border-line bg-surface/95 px-4 py-3.5 backdrop-blur md:top-16 md:px-5 lg:top-0">
            <div role="group" aria-label={p.showPlanAs} className="grid grid-cols-2 gap-1 rounded-xl bg-sand-2 p-1 lg:hidden">
              {(["list", "map"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => go(v, tab)}
                  className={cx("flex h-10 items-center justify-center gap-1.5 rounded-[9px] text-sm font-semibold", view === v ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink")}
                >
                  {v === "list" ? <ListChecks className="size-4" aria-hidden /> : <MapIcon className="size-4" aria-hidden />}
                  {v === "list" ? p.list : p.map}
                </button>
              ))}
            </div>
            <DayBar days={trip.days} value={dayFilter} onChange={changeDay} cityOf={trip.destinations.length > 1 ? cityOf : undefined} presence={trip.myRole ? dayPresence : undefined} />
          </div>

          {(wide || view === "list") && (
            <div className="mx-auto max-w-3xl px-4 pb-8 pt-5 md:px-5 lg:max-w-none">
              {phase === "after" && (trip.myRole || marked) && (
                <div className="mb-5 rounded-2xl border border-line bg-sand-2 p-4">
                  <p className="flex items-center gap-2 font-semibold">
                    <Flag className="size-4 shrink-0 text-accent-700" aria-hidden /> {ta.banner.ended}
                  </p>
                  {canEdit && unmarked > 0 && <p className="mt-1 text-sm text-ink-2">{ta.banner.review(unmarked)}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {canEdit && unmarked > 0 && (
                      <Button size="sm" onClick={() => setReviewOpen(true)}>
                        <CheckCheck className="size-4" /> {ta.banner.reviewAction}
                      </Button>
                    )}
                    <Button size="sm" variant={canEdit && unmarked > 0 ? "secondary" : "primary"} href={`/trips/${trip.id}/recap`}>
                      <Sparkles className="size-4" /> {ta.banner.recap}
                    </Button>
                  </div>
                </div>
              )}
              {phase === "during" && canEdit && (
                <p className="mb-5 flex items-center gap-2 rounded-2xl bg-primary-50 px-4 py-3 text-sm font-medium text-primary">
                  <CheckCheck className="size-4 shrink-0" aria-hidden /> {ta.banner.during}
                </p>
              )}
              {hasAbout && (
                <div className="mb-6 space-y-2.5 border-b border-line pb-5">
                  {trip.description && <p className="line-clamp-3 whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{trip.description}</p>}
                  {trip.forkedFrom && (
                    <p className="flex items-center gap-2 text-sm text-ink-2">
                      <GitFork className="size-4 shrink-0 text-accent-700" aria-hidden />
                      <span>
                        {p.basedOn.before}{" "}
                        {trip.forkedFrom.tripId ? (
                          <Link href={`/trips/${trip.forkedFrom.tripId}`} className="font-semibold text-ink hover:underline">
                            {trip.forkedFrom.title}
                          </Link>
                        ) : (
                          <b>{trip.forkedFrom.title}</b>
                        )}{" "}
                        {p.basedOn.by}{" "}
                        <Link href={`/u/${trip.forkedFrom.ownerUsername}`} className="font-semibold text-ink hover:underline">
                          @{trip.forkedFrom.ownerUsername}
                        </Link>
                        {p.basedOn.after && ` ${p.basedOn.after}`}
                      </span>
                    </p>
                  )}
                  {trip.visibility === "PUBLIC" && trip.forkCount > 0 && (
                    <p className="flex items-center gap-2 font-mono text-[13px] text-muted">
                      <GitFork className="size-3.5" aria-hidden /> {p.remixed(f.count(trip.forkCount))}
                    </p>
                  )}
                  {trip.myRole === "VIEWER" && (
                    <p className="flex items-center gap-2 rounded-xl bg-sand-2 px-4 py-3 text-sm text-ink-2">
                      <Eye className="size-4 shrink-0" /> {p.viewerNote(trip.owner.displayName)}
                    </p>
                  )}
                </div>
              )}
              <Itinerary
                trip={trip}
                day={dayFilter}
                selectedId={selected?.id}
                hoveredId={hovered}
                onHover={setHovered}
                onSelect={select}
                onAdd={(dayId, slot) => setSheet({ open: true, dayId, slot })}
                onAddIdea={() => setSheet({ open: true, pool: true })}
                onEdit={(item) => setSheet({ open: true, item })}
                onAddExpense={canSpend ? (item) => openExpenses({ kind: "form", itemId: item.id }) : undefined}
              />
            </div>
          )}
          {!wide && view === "map" && (
            <div className="px-4 pb-4 pt-3 md:px-5">
              <TripMap trip={trip} day={dayFilter} selectedId={selected?.id} hoveredId={hovered} onHover={setHovered} onSelect={select} className="h-[calc(100dvh-19.5rem)] min-h-[360px] md:h-[calc(100dvh-13rem)]" />
            </div>
          )}
        </section>
        {wide && (
          <div className="min-w-0 flex-1">
            <TripMap trip={trip} day={dayFilter} selectedId={selected?.id} hoveredId={hovered} onHover={setHovered} onSelect={select} flush className="h-full" />
          </div>
        )}
      </div>

      {bottomBar && (
        <div className="fixed inset-x-0 bottom-[calc(3.6rem+env(safe-area-inset-bottom))] z-30 flex gap-2.5 border-t border-line bg-sand/95 px-4 py-3 backdrop-blur md:hidden">
          <Button size="lg" className="h-12 flex-1" onClick={() => setSheet({ open: true, dayId: addDayId() })}>
            <Plus className="size-5" /> {p.addPlace}
          </Button>
          {canSpend && (
            <Button variant="secondary" className="h-12 w-12 shrink-0 px-0" onClick={() => openExpenses()} aria-label={ta.expenses.open}>
              <Wallet className="size-4" />
            </Button>
          )}
          {shareable && (
            <Button size={canSpend ? "md" : "lg"} variant="secondary" className={cx("h-12", canSpend ? "w-12 shrink-0 px-0" : "px-4")} onClick={() => share(`/trips/${trip.id}`, trip.title)} aria-label={canSpend ? t.common.share : undefined}>
              <Share2 className="size-4" /> {!canSpend && t.common.share}
            </Button>
          )}
        </div>
      )}

      <Sheet open={membersOpen} onClose={() => go(view)} title={p.travelers} wide>
        <MembersPanel trip={trip} />
      </Sheet>
      {canSpend && (
        <Sheet open={tab === "expenses"} onClose={() => go(view)} title={ta.expenses.title} wide>
          <ExpensesPanel trip={trip} mode={expenseMode} onMode={setExpenseMode} />
        </Sheet>
      )}
      {canEdit && <ReviewSheet open={reviewOpen} onClose={() => setReviewOpen(false)} trip={trip} />}
      {(canAdd || canEdit) && <ItemSheet open={sheet.open} onClose={() => setSheet({ open: false })} trip={trip} defaultDayId={sheet.dayId} defaultSlot={sheet.slot} pool={sheet.pool} item={sheet.item} />}
      {may("members.invite") && <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} tripId={trip.id} />}
      {may("trip.fork") && <ForkSheet open={forkOpen} onClose={() => setForkOpen(false)} trip={trip} />}
    </div>
  );
}

/**
 * While the full trip loads after opening it from a card: the real header (title, route, dates, cover)
 * from the card's data, so the card can morph into it, and a quiet skeleton for the plan.
 */
function PlannerPreview({ trip }: { trip: TripSummary }) {
  const t = useT();
  const f = useFormat();
  return (
    <div className="bg-surface lg:flex lg:h-[calc(100dvh-4rem)] lg:flex-col" aria-busy="true">
      <header className="flex shrink-0 items-center gap-4 border-b border-line px-4 py-4 md:gap-5 md:px-7 md:py-5">
        <span className="size-11 shrink-0 rounded-xl border border-line" aria-hidden />
        <Morph name={`trip-cover-${trip.id}`}>
          <div className="hidden shrink-0 sm:block">
            <Cover palette={trip.cover} seed={trip.id} image={trip.coverImage} imageUrl={trip.coverUrl} sizes="88px" className="h-16 w-[88px] rounded-xl" />
          </div>
        </Morph>
        <div className="min-w-0 flex-1">
          <Morph name={`trip-title-${trip.id}`}>
            <h1 className="font-display text-2xl font-extrabold leading-tight md:text-[32px]">{trip.title}</h1>
          </Morph>
          <div className="mt-1 flex flex-wrap gap-x-[18px] text-sm text-ink-2">
            <span>{trip.route || t.trips.destinationTbd}</span>
            {(trip.startDate || trip.endDate) && <span className="font-mono text-[13px]">{f.dateRange(trip.startDate, trip.endDate)}</span>}
          </div>
        </div>
      </header>
      <div className="lg:flex lg:min-h-0 lg:flex-1">
        <div className="space-y-3 p-4 md:p-5 lg:w-[460px] lg:border-r lg:border-line xl:w-[560px]">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-[14px]" />
          ))}
        </div>
        <div className="hidden flex-1 p-4 lg:flex">
          <FoldedMap panels={6} caption={false} className="flex-1 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
