"use client";

import { ROLE_LABEL, VISIBILITY_LABEL, type ItemView, type TripSummary } from "@triply/shared";
import { ArrowLeft, Bookmark, Eye, GitFork, Globe2, Link2, ListChecks, Lock, Map as MapIcon, PenLine, Plus, Settings, Share2, UserPlus } from "lucide-react";
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
import { Avatar, Badge, Button, EmptyState, ErrorState, IconButton, PageLoader, Sheet, cx, formatCount, formatDateRange } from "@/components/ui";
import { api, ApiError } from "@/lib/api/client";
import { keys, useAction, useMe, useTrip } from "@/lib/api/queries";
import { useMediaQuery } from "@/lib/hooks";
import { useTripRealtime } from "@/lib/realtime";
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
  const q = useTrip(id);
  const trip = q.data;
  useDocumentTitle(trip?.title ?? (q.isError ? "Trip not available" : null));
  const { live, presence, reportActivity } = useTripRealtime(id, me?.id, !!trip?.myRole);
  const share = useShare();
  const wide = useMediaQuery("(min-width: 1024px)");
  const [selected, setSelected] = useState<ItemView | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [sheet, setSheet] = useState<{ open: boolean; dayId?: string; item?: ItemView | null }>({ open: false });
  const [day, setDay] = useState<DayFilter | null>(null);

  // URL state: `?view=map` (narrow screens) and `?tab=members` (the travelers panel). Older `?tab=map` links still open the map.
  const membersOpen = search.get("tab") === "members";
  const view: View = search.get("view") === "map" || search.get("tab") === "map" ? "map" : "list";
  const planTop = useRef<HTMLDivElement>(null);
  const go = (v: View, members = false) => {
    // Switching List ↔ Map brings the plan controls to the top, so the map fills the screen.
    if (v !== view) requestAnimationFrame(() => planTop.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    const params = new URLSearchParams();
    if (v === "map") params.set("view", "map");
    if (members) params.set("tab", "members");
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
        <div className="px-4 pt-4 md:px-8 md:pt-8">
        <EmptyState
          level="h1"
          icon={<Lock className="size-7" />}
          title="This trip is private."
          body={me ? "Only people the owner has invited can see it. Ask them for an invite link." : "Log in if you were invited to this trip."}
          action={me ? <Button href="/explore">Explore public trips</Button> : <Button href={`/login?next=/trips/${id}`}>Log in</Button>}
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
  const bottomBar = canAdd;
  const hasAbout = !!(trip.description || trip.forkedFrom || trip.myRole === "VIEWER" || (trip.visibility === "PUBLIC" && trip.forkCount > 0));

  return (
    <div className={cx("bg-surface lg:flex lg:h-[calc(100dvh-4rem)] lg:flex-col", bottomBar && "pb-20 md:pb-0")}>
      {/* Header: one row, as in the Atlas planner — the plan starts right under it. */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-4 py-4 md:px-7 md:py-5">
        <div className="flex min-w-0 flex-1 basis-[22rem] items-center gap-4 md:gap-5">
          <IconButton label="Back" onClick={() => router.back()} className="size-11 shrink-0 border border-line bg-surface text-ink">
            <ArrowLeft className="size-[18px]" />
          </IconButton>
          <RouteThumb trip={trip} className="hidden shrink-0 sm:block" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-extrabold leading-tight md:text-[32px]">{trip.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-[18px] gap-y-1 text-sm text-ink-2">
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
              {/* The avatars open the travelers panel (roles, invites, leave). */}
              <button
                type="button"
                onClick={() => go(view, true)}
                aria-label={`Travelers: ${trip.members.length}. Manage members`}
                className="mr-1 flex items-center rounded-full p-0.5 hover:bg-sand-2"
              >
                {trip.members.slice(0, 5).map((m, i) => (
                  <span
                    key={m.user.id}
                    title={`${m.user.displayName}${onlineIds.has(m.user.id) ? " · here now" : ""}`}
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
                by <span className="font-semibold">{trip.owner.displayName}</span>
              </span>
            </Link>
          )}
          {may("trip.edit_details") && (
            <Button href={`/trips/${trip.id}/settings`} variant="secondary" className="h-11 w-11 px-0 sm:w-auto sm:px-[18px]">
              <PenLine className="size-4" aria-hidden /> <span className="sr-only sm:not-sr-only">Edit</span>
            </Button>
          )}
          {me && !trip.myRole && shareable && (
            <Button variant="secondary" className="h-11" onClick={() => save.run(!trip.savedByMe)} disabled={save.isPending} aria-pressed={trip.savedByMe}>
              <Bookmark className={cx("size-4", trip.savedByMe && "fill-accent text-accent")} /> {trip.savedByMe ? "Saved" : "Save"}
            </Button>
          )}
          {shareable && (
            <Button variant="secondary" className={cx("h-11 px-[18px]", bottomBar && "hidden md:inline-flex")} onClick={() => share(`/trips/${trip.id}`, trip.title)}>
              <Share2 className="size-4" /> Share
            </Button>
          )}
          {may("members.invite") && (
            <Button className="h-11 w-11 px-0 sm:w-auto sm:px-[18px]" onClick={() => setInviteOpen(true)}>
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
          {/* Phones reach settings through Edit (same page); this saves a row in the header. */}
          {may("trip.change_visibility") && (
            <span className="hidden sm:contents">
              <IconButton label="Trip settings" onClick={() => router.push(`/trips/${trip.id}/settings`)} className="size-11 border border-line bg-surface">
                <Settings className="size-4" />
              </IconButton>
            </span>
          )}
        </div>
      </header>

      {/* Plan: from 1024px the planner fills the window — the itinerary column scrolls on its own
          beside a map that always shows in full. Below that, a List / Map switch. */}
      <div className="lg:flex lg:min-h-0 lg:flex-1">
        <section aria-label="Itinerary" className="min-w-0 lg:w-[460px] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-line xl:w-[560px]">
          <div ref={planTop} className="scroll-mt-14 md:scroll-mt-16" />
          {/* Stays under the top bar so the day (and List / Map) is always one tap away. */}
          <div className="sticky top-14 z-20 space-y-3 border-b border-line bg-surface/95 px-4 py-3.5 backdrop-blur md:top-16 md:px-5 lg:top-0">
            <div role="group" aria-label="Show plan as" className="grid grid-cols-2 gap-1 rounded-xl bg-sand-2 p-1 lg:hidden">
              {(["list", "map"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => go(v, membersOpen)}
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
            <div className="mx-auto max-w-3xl px-4 pb-8 pt-5 md:px-5 lg:max-w-none">
              {hasAbout && (
                <div className="mb-6 space-y-2.5 border-b border-line pb-5">
                  {trip.description && <p className="line-clamp-3 whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{trip.description}</p>}
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
          {!wide && view === "map" && (
            <div className="px-4 pb-4 pt-3 md:px-5">
              <TripMap trip={trip} day={dayFilter} selectedId={selected?.id} onSelect={select} className="h-[calc(100dvh-19.5rem)] min-h-[360px] md:h-[calc(100dvh-13rem)]" />
            </div>
          )}
        </section>
        {wide && (
          <div className="min-w-0 flex-1">
            <TripMap trip={trip} day={dayFilter} selectedId={selected?.id} onSelect={select} flush className="h-full" />
          </div>
        )}
      </div>

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

      <Sheet open={membersOpen} onClose={() => go(view)} title="Travelers" wide>
        <MembersPanel trip={trip} />
      </Sheet>
      {(canAdd || canEdit) && <ItemSheet open={sheet.open} onClose={() => setSheet({ open: false })} trip={trip} defaultDayId={sheet.dayId} item={sheet.item} />}
      {may("members.invite") && <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} tripId={trip.id} />}
      {may("trip.fork") && <ForkSheet open={forkOpen} onClose={() => setForkOpen(false)} trip={trip} />}
    </div>
  );
}
