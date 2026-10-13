"use client";

import { ROLE_LABEL, VISIBILITY_LABEL, type ItemView, type TripSummary } from "@triply/shared";
import { ArrowLeft, Bookmark, Eye, GitFork, Globe2, Link2, ListChecks, Lock, Map as MapIcon, PenLine, Plus, Settings, Share2, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ItemSheet } from "@/components/itinerary/ItemSheet";
import { Itinerary } from "@/components/itinerary/Itinerary";
import { TripMap } from "@/components/map/TripMap";
import { useShare } from "@/components/social/PostCard";
import { DayBar, type DayFilter } from "@/components/trip/DayBar";
import { ForkSheet } from "@/components/trip/ForkSheet";
import { InviteSheet } from "@/components/trip/InviteSheet";
import { MembersPanel } from "@/components/trip/MembersPanel";
import { RouteThumb } from "@/components/trip/RouteThumb";
import { Avatar, Badge, Button, EmptyState, ErrorState, IconButton, PageLoader, TabPanel, Tabs, cx, formatCount, formatDateRange } from "@/components/ui";
import { api, ApiError } from "@/lib/api/client";
import { keys, useAction, useMe, useTrip } from "@/lib/api/queries";
import { useMediaQuery } from "@/lib/hooks";
import { useTripRealtime } from "@/lib/realtime";
import { dayStats, formatKm } from "@/lib/trip-geo";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

type Tab = "plan" | "members";
type View = "list" | "map";

export default function TripPage() {
  return (
    <Suspense>
      <TripPlanner />
    </Suspense>
  );
}

/**
 * Trip planner (Atlas). Compact header, then the plan: on wide screens the itinerary and a
 * sticky map side by side, sharing one day filter and one selection; below that, a List / Map
 * switch and (on phones) a bottom action bar instead of a floating button.
 */
function TripPlanner() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const me = useMe().data;
  const q = useTrip(id);
  const trip = q.data;
  useDocumentTitle(trip?.title ?? (q.isError ? "Trip not available" : null));
  const { live, presence, reportActivity } = useTripRealtime(id, me?.id, !!trip?.myRole);
  const share = useShare();
  const wide = useMediaQuery("(min-width: 1280px)");
  const [selected, setSelected] = useState<ItemView | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [sheet, setSheet] = useState<{ open: boolean; dayId?: string; item?: ItemView | null }>({ open: false });
  const [day, setDay] = useState<DayFilter | null>(null);

  // `?tab=map` (older links) opens the plan on the map view.
  const tab: Tab = search.get("tab") === "members" ? "members" : "plan";
  const view: View = search.get("view") === "map" || search.get("tab") === "map" ? "map" : "list";
  const planTop = useRef<HTMLDivElement>(null);
  const go = (t: Tab, v: View = "list") => {
    // Switching List ↔ Map below the header brings the plan controls to the top, so the map fills the screen.
    if (t === "plan" && v !== view) requestAnimationFrame(() => planTop.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    const params = new URLSearchParams();
    if (t === "members") params.set("tab", "members");
    else if (v === "map") params.set("view", "map");
    const qs = params.toString();
    router.replace(`/trips/${id}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  // Tell collaborators which day this tab is editing ("An is editing Day 2").
  const editingDay = sheet.open && trip ? (trip.days.find((d) => d.id === (sheet.item?.dayId ?? sheet.dayId))?.dayNumber ?? null) : null;
  useEffect(() => reportActivity(editingDay), [editingDay, reportActivity]);

  const save = useAction((on: boolean) => (on ? api.post<TripSummary>(`/trips/${id}/save`) : api.delete<TripSummary>(`/trips/${id}/save`)), {
    invalidate: [keys.trip(id), ["trips"]],
    success: (r) => (r.savedByMe ? "Saved to your trips" : "Removed from saved"),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.isError || !trip) {
    if (q.error instanceof ApiError && q.error.status === 403)
      return (
        <EmptyState
          level="h1"
          icon={<Lock className="size-7" />}
          title="This trip is private."
          body={me ? "Only people the owner has invited can see it. Ask them for an invite link." : "Log in if you were invited to this trip."}
          action={me ? <Button href="/explore">Explore public trips</Button> : <Button href={`/login?next=/trips/${id}`}>Log in</Button>}
        />
      );
    return <ErrorState page error={q.error} onRetry={() => q.refetch()} />;
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
    const d = trip.days.find((x) => x.id === it.dayId);
    if (d && dayFilter !== "all" && dayFilter !== d.dayNumber) setDay(d.dayNumber);
  };
  const changeDay = (d: DayFilter) => {
    setDay(d);
    if (selected && d !== "all" && trip.days.find((x) => x.id === selected.dayId)?.dayNumber !== d) setSelected(null);
  };
  const addDayId = () => (dayFilter !== "all" ? trip.days.find((d) => d.dayNumber === dayFilter)?.id : selected?.dayId) ?? trip.days[0]?.id;
  const cityOf = (d: (typeof trip.days)[number]) => {
    const names = new Set(d.items.map((i) => i.place?.destinationName).filter(Boolean));
    return names.size === 1 ? [...names][0]! : null;
  };

  // Presence: who else has this trip open, and whether one of them is editing a day.
  const nameOf = (userId: string) => trip.members.find((m) => m.user.id === userId)?.user.displayName.split(" ")[0] ?? "Someone";
  const others = presence.filter((p) => p.userId !== me?.id);
  const onlineIds = new Set(presence.map((p) => p.userId));
  const editing = others.find((p) => p.editingDay !== null);
  const presenceText = editing
    ? `${nameOf(editing.userId)} is editing Day ${editing.editingDay}`
    : others.length === 1
      ? `${nameOf(others[0].userId)} is here too`
      : others.length > 1
        ? `${others.length} others are here`
        : live
          ? "Live"
          : null;
  const shareable = trip.visibility !== "PRIVATE";
  const bottomBar = canAdd && tab === "plan";

  return (
    <div className={cx("space-y-5", bottomBar && "pb-20 md:pb-0")}>
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line pb-4 md:pb-5">
        <div className="flex min-w-0 flex-1 basis-[22rem] items-center gap-4">
          <IconButton label="Back" onClick={() => router.back()} className="size-11 shrink-0 border border-line bg-surface text-ink">
            <ArrowLeft className="size-[18px]" />
          </IconButton>
          <RouteThumb trip={trip} className="hidden shrink-0 sm:block" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-extrabold leading-tight md:text-[32px]">{trip.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
              <span>{trip.route || "Destination TBD"}</span>
              {(trip.startDate || trip.endDate) && <span className="font-mono text-[13px]">{formatDateRange(trip.startDate ?? undefined, trip.endDate ?? undefined)}</span>}
              <span className="font-mono text-[13px]">
                <span className="hidden sm:inline">
                  {s.days} {s.days === 1 ? "day" : "days"} ·{" "}
                </span>
                {s.places} {s.places === 1 ? "place" : "places"}
                {totalKm > 0 && ` · ${formatKm(totalKm)}`}
              </span>
              <span className="inline-flex items-center gap-1">
                <VisIcon className="size-3.5" aria-hidden /> {VISIBILITY_LABEL[trip.visibility].label}
              </span>
              {presenceText && (
                <span className="inline-flex items-center gap-1.5 font-semibold text-primary" role="status" title="Changes from your crew appear instantly">
                  <span aria-hidden className="size-2 rounded-full bg-primary" /> {presenceText}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {trip.myRole ? (
            <>
              <Badge tone={trip.myRole === "OWNER" ? "accent" : trip.myRole === "EDITOR" ? "primary" : "neutral"}>You · {ROLE_LABEL[trip.myRole]}</Badge>
              <ul className="mr-1 flex -space-x-2" aria-label={`${trip.members.length} ${trip.members.length === 1 ? "traveler" : "travelers"}`}>
                {trip.members.slice(0, 5).map((m, i) => (
                  <li
                    key={m.user.id}
                    title={`${m.user.displayName}${onlineIds.has(m.user.id) ? " · here now" : ""}`}
                    className={cx("rounded-full ring-2", onlineIds.has(m.user.id) && m.user.id !== me?.id ? "ring-primary" : "ring-surface", i >= 3 && "hidden sm:block")}
                  >
                    <Avatar user={m.user} size={30} />
                  </li>
                ))}
                {trip.members.length > 3 && (
                  <li className={cx("flex size-[30px] items-center justify-center rounded-full bg-sand-2 font-mono text-xs font-semibold text-ink-2 ring-2 ring-surface", trip.members.length <= 5 && "sm:hidden")}>
                    <span className="sm:hidden">+{trip.members.length - 3}</span>
                    <span className="hidden sm:inline">+{trip.members.length - 5}</span>
                  </li>
                )}
              </ul>
            </>
          ) : (
            <Link href={`/u/${trip.owner.username}`} className="mr-1 flex items-center gap-2 rounded-xl py-1 pr-2 text-sm hover:bg-sand-2">
              <Avatar user={trip.owner} size={32} />
              <span>
                by <span className="font-semibold">{trip.owner.displayName}</span>
              </span>
            </Link>
          )}
          {may("trip.edit_details") && (
            <Button href={`/trips/${trip.id}/settings`} variant="secondary" className="h-11 w-11 px-0 sm:w-auto sm:px-4">
              <PenLine className="size-4" aria-hidden /> <span className="sr-only sm:not-sr-only">Edit</span>
            </Button>
          )}
          {me && !trip.myRole && shareable && (
            <Button variant="secondary" className="h-11" onClick={() => save.run(!trip.savedByMe)} disabled={save.isPending} aria-pressed={trip.savedByMe}>
              <Bookmark className={cx("size-4", trip.savedByMe && "fill-accent text-accent")} /> {trip.savedByMe ? "Saved" : "Save"}
            </Button>
          )}
          {shareable && (
            <Button variant="secondary" className={cx("h-11", bottomBar && "hidden md:inline-flex")} onClick={() => share(`/trips/${trip.id}`, trip.title)}>
              <Share2 className="size-4" /> Share
            </Button>
          )}
          {may("members.invite") && (
            <Button className="h-11 w-11 px-0 sm:w-auto sm:px-4" onClick={() => setInviteOpen(true)}>
              <UserPlus className="size-4" aria-hidden /> <span className="sr-only sm:not-sr-only">Invite</span>
            </Button>
          )}
          {may("trip.fork") && (
            <Button variant="accent" className="h-11" onClick={() => setForkOpen(true)}>
              <GitFork className="size-4" /> Use this trip
            </Button>
          )}
          {!me && trip.visibility === "PUBLIC" && trip.allowFork && (
            <Button variant="accent" className="h-11" href={`/login?next=/trips/${trip.id}`}>
              <GitFork className="size-4" /> Log in to remix
            </Button>
          )}
          {may("trip.change_visibility") && (
            <IconButton label="Trip settings" onClick={() => router.push(`/trips/${trip.id}/settings`)} className="size-11 border border-line bg-surface">
              <Settings className="size-4" />
            </IconButton>
          )}
        </div>
      </header>

      {(trip.forkedFrom || trip.description || trip.myRole === "VIEWER" || (trip.visibility === "PUBLIC" && trip.forkCount > 0)) && (
        <div className="space-y-3">
          {trip.description && <p className="line-clamp-2 max-w-3xl whitespace-pre-line text-[15px] leading-relaxed text-ink-2 md:line-clamp-none">{trip.description}</p>}
          {trip.forkedFrom && (
            <p className="flex items-center gap-2 text-sm text-ink-2">
              <GitFork className="size-4 shrink-0 text-accent-700" aria-hidden />
              <span>
                Based on{" "}
                {trip.forkedFrom.tripId ? (
                  <Link href={`/trips/${trip.forkedFrom.tripId}`} className="font-semibold text-ink hover:underline">
                    {trip.forkedFrom.title}
                  </Link>
                ) : (
                  <b>{trip.forkedFrom.title}</b>
                )}{" "}
                by{" "}
                <Link href={`/u/${trip.forkedFrom.ownerUsername}`} className="font-semibold text-ink hover:underline">
                  @{trip.forkedFrom.ownerUsername}
                </Link>
              </span>
            </p>
          )}
          {trip.visibility === "PUBLIC" && trip.forkCount > 0 && (
            <p className="flex items-center gap-2 font-mono text-[13px] text-muted">
              <GitFork className="size-3.5" aria-hidden /> remixed {formatCount(trip.forkCount)}×
            </p>
          )}
          {trip.myRole === "VIEWER" && (
            <p className="flex items-center gap-2 rounded-xl bg-sand-2 px-4 py-3 text-sm text-ink-2">
              <Eye className="size-4 shrink-0" /> You can view this trip. Ask {trip.owner.displayName} if you&apos;d like to help edit it.
            </p>
          )}
        </div>
      )}

      <Tabs
        id="trip-tabs"
        label="Trip sections"
        value={tab}
        onChange={(t) => go(t, view)}
        tabs={[
          { value: "plan", label: (<><ListChecks className="size-4" /> Plan</>) },
          { value: "members", label: (<><Users className="size-4" /> Members <span className="font-mono text-xs text-muted">{trip.members.length}</span></>) },
        ]}
      />

      <TabPanel tabsId="trip-tabs" value={tab}>
        {tab === "plan" && (
          <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] xl:gap-8">
            <div className="min-w-0">
              <div ref={planTop} className="scroll-mt-14 md:scroll-mt-0" />
              {/* Stays under the mobile top bar so the day (and List / Map) is always one tap away. */}
              <div className="sticky top-14 z-20 -mx-4 space-y-3 bg-sand/95 px-4 pb-3 pt-1 backdrop-blur md:top-0 md:mx-0 md:px-0 xl:static xl:bg-transparent xl:backdrop-blur-none">
                <div role="group" aria-label="Show plan as" className="grid grid-cols-2 gap-1 rounded-xl bg-sand-2 p-1 xl:hidden">
                  {(["list", "map"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={view === v}
                      onClick={() => go("plan", v)}
                      className={cx("flex h-10 items-center justify-center gap-1.5 rounded-[9px] text-sm font-semibold", view === v ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink")}
                    >
                      {v === "list" ? <ListChecks className="size-4" aria-hidden /> : <MapIcon className="size-4" aria-hidden />}
                      {v === "list" ? "List" : "Map"}
                    </button>
                  ))}
                </div>
                <DayBar days={trip.days} value={dayFilter} onChange={changeDay} cityOf={trip.destinations.length > 1 ? cityOf : undefined} />
              </div>
              {(wide || view === "list") && (
                <div className="pt-3">
                  <Itinerary
                    trip={trip}
                    day={dayFilter}
                    selectedId={selected?.id}
                    onSelect={select}
                    onAdd={(dayId) => setSheet({ open: true, dayId })}
                    onEdit={(item) => setSheet({ open: true, item })}
                  />
                </div>
              )}
              {!wide && view === "map" && <TripMap trip={trip} day={dayFilter} selectedId={selected?.id} onSelect={select} className="mt-1 h-[calc(100dvh-19.5rem)] min-h-[360px] md:h-[calc(100dvh-12rem)]" />}
            </div>
            {wide && (
              <div className="min-w-0">
                <div className="sticky top-6 h-[calc(100dvh-3rem)] max-h-[860px] min-h-[480px]">
                  <TripMap trip={trip} day={dayFilter} selectedId={selected?.id} onSelect={select} className="h-full" />
                </div>
              </div>
            )}
          </div>
        )}
        {tab === "members" && <MembersPanel trip={trip} />}
      </TabPanel>

      {bottomBar && (
        <div className="fixed inset-x-0 bottom-[calc(3.6rem+env(safe-area-inset-bottom))] z-30 flex gap-2.5 border-t border-line bg-sand/95 px-4 py-3 backdrop-blur md:hidden">
          <Button size="lg" className="h-12 flex-1" onClick={() => setSheet({ open: true, dayId: addDayId() })}>
            <Plus className="size-5" /> Add a place
          </Button>
          {shareable && (
            <Button size="lg" variant="secondary" className="h-12 px-4" onClick={() => share(`/trips/${trip.id}`, trip.title)}>
              <Share2 className="size-4" /> Share
            </Button>
          )}
        </div>
      )}

      {(canAdd || canEdit) && <ItemSheet open={sheet.open} onClose={() => setSheet({ open: false })} trip={trip} defaultDayId={sheet.dayId} item={sheet.item} />}
      {may("members.invite") && <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} tripId={trip.id} />}
      {may("trip.fork") && <ForkSheet open={forkOpen} onClose={() => setForkOpen(false)} trip={trip} />}
    </div>
  );
}
