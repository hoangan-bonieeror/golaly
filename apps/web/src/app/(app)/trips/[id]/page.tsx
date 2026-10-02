"use client";

import { ROLE_LABEL, VISIBILITY_LABEL, type ItemView, type TripSummary } from "@triply/shared";
import {
  ArrowLeft,
  Bookmark,
  CalendarDays,
  Eye,
  GitFork,
  Globe2,
  Link2,
  ListChecks,
  Lock,
  Map as MapIcon,
  MapPin,
  PenLine,
  Radio,
  Settings,
  Share2,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Itinerary } from "@/components/itinerary/Itinerary";
import { TripMap } from "@/components/map/TripMap";
import { useShare } from "@/components/social/PostCard";
import { Cover } from "@/components/trip/Cover";
import { ForkSheet } from "@/components/trip/ForkSheet";
import { InviteSheet } from "@/components/trip/InviteSheet";
import { MembersPanel } from "@/components/trip/MembersPanel";
import { Avatar, Badge, Button, EmptyState, ErrorState, IconButton, PageLoader, Tabs, cx, formatCount, formatDateRange } from "@/components/ui";
import { api, ApiError } from "@/lib/api/client";
import { keys, useAction, useMe, useTrip } from "@/lib/api/queries";
import { useTripRealtime } from "@/lib/realtime";

type Tab = "plan" | "map" | "members";

export default function TripPage() {
  return (
    <Suspense>
      <TripOverview />
    </Suspense>
  );
}

function TripOverview() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const me = useMe().data;
  const q = useTrip(id);
  const trip = q.data;
  const live = useTripRealtime(id, me?.id, !!trip?.myRole);
  const share = useShare();
  const [selected, setSelected] = useState<ItemView | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const tab = (search.get("tab") as Tab) ?? "plan";
  const setTab = (t: Tab) => router.replace(`/trips/${id}${t === "plan" ? "" : `?tab=${t}`}`, { scroll: false });
  const save = useAction((on: boolean) => (on ? api.post<TripSummary>(`/trips/${id}/save`) : api.delete<TripSummary>(`/trips/${id}/save`)), {
    invalidate: [keys.trip(id), ["trips"]],
    success: (r) => (r.savedByMe ? "Saved to your trips" : "Removed from saved"),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.isError || !trip) {
    if (q.error instanceof ApiError && q.error.status === 403)
      return (
        <EmptyState
          icon={<Lock className="size-7" />}
          title="This trip is private."
          body={me ? "Only people the owner has invited can see it. Ask them for an invite link." : "Log in if you were invited to this trip."}
          action={me ? <Button href="/explore">Explore public trips</Button> : <Button href={`/login?next=/trips/${id}`}>Log in</Button>}
        />
      );
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  }

  const may = (a: string) => trip.permissions.includes(a as never);
  const s = trip.stats;
  const VisIcon = trip.visibility === "PUBLIC" ? Globe2 : trip.visibility === "LINK_ONLY" ? Link2 : Lock;
  const select = (it: ItemView) => setSelected((cur) => (cur?.id === it.id ? null : it));

  return (
    <div className="space-y-6">
      <Cover palette={trip.cover} image={trip.coverImage} imageUrl={trip.coverUrl} priority sizes="(min-width: 768px) 1100px, 100vw" seed={trip.id} className="-mx-4 -mt-4 aspect-[4/3] rounded-none sm:aspect-[16/7] md:mx-0 md:mt-0 md:rounded-[var(--radius-card)]">
        <div className="flex h-full flex-col justify-between p-4 text-white md:p-7">
          <div className="flex items-center justify-between">
            <IconButton label="Back" onClick={() => router.back()} className="bg-black/30 text-white backdrop-blur hover:bg-black/40">
              <ArrowLeft className="size-5" />
            </IconButton>
            <div className="flex items-center gap-2">
              {live && (
                <span className="flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1.5 text-xs font-semibold backdrop-blur" title="Changes from your crew appear instantly">
                  <Radio className="size-3.5 text-[#7fd1c7]" /> Live
                </span>
              )}
              <span className="flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1.5 text-xs font-semibold backdrop-blur">
                <VisIcon className="size-3.5" /> {VISIBILITY_LABEL[trip.visibility].label}
              </span>
            </div>
          </div>
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-white/90">
              <MapPin className="size-4" /> {trip.route || "Destination TBD"}
            </p>
            <h1 className="font-display text-3xl font-bold leading-tight md:text-5xl">{trip.title}</h1>
          </div>
        </div>
      </Cover>

      {trip.forkedFrom && (
        <p className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-2.5 text-sm text-ink-2">
          <GitFork className="size-4 shrink-0 text-sunset" />
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

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/u/${trip.owner.username}`} className="flex items-center gap-2">
              <Avatar user={trip.owner} size={32} />
              <span className="text-sm font-semibold">{trip.owner.displayName}</span>
            </Link>
            {trip.myRole && <Badge tone={trip.myRole === "OWNER" ? "sunset" : trip.myRole === "EDITOR" ? "lagoon" : "neutral"}>You · {ROLE_LABEL[trip.myRole]}</Badge>}
            {trip.myRole && (
              <div className="flex -space-x-2">
                {trip.members.slice(0, 5).map((m) => (
                  <Avatar key={m.user.id} user={m.user} size={26} ring />
                ))}
              </div>
            )}
          </div>
          {trip.description && <p className="max-w-2xl whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{trip.description}</p>}
          <dl className="flex flex-wrap gap-2 text-sm">
            <Stat icon={<CalendarDays className="size-4" />} label={formatDateRange(trip.startDate ?? undefined, trip.endDate ?? undefined)} />
            <Stat icon={<ListChecks className="size-4" />} label={`${s.days} ${s.days === 1 ? "day" : "days"}`} />
            <Stat icon={<MapPin className="size-4" />} label={`${s.places} places`} />
            <Stat icon={<Users className="size-4" />} label={`${s.travelers} ${s.travelers === 1 ? "traveler" : "travelers"}`} />
            {trip.estimatedBudget != null && <Stat icon={<Wallet className="size-4" />} label={`~$${trip.estimatedBudget.toLocaleString()} pp`} />}
            {trip.visibility === "PUBLIC" && <Stat icon={<GitFork className="size-4" />} label={`${formatCount(trip.forkCount)} remixes`} />}
          </dl>
        </div>

        <div className="flex flex-wrap gap-2 lg:shrink-0 lg:justify-end">
          {may("trip.edit_details") && (
            <Button href={`/trips/${trip.id}/settings`} variant="secondary">
              <PenLine className="size-4" /> Edit
            </Button>
          )}
          {may("members.invite") && (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="size-4" /> Invite
            </Button>
          )}
          {me && !trip.myRole && trip.visibility !== "PRIVATE" && (
            <Button variant="secondary" onClick={() => save.run(!trip.savedByMe)} disabled={save.isPending} aria-pressed={trip.savedByMe}>
              <Bookmark className={cx("size-4", trip.savedByMe && "fill-sunset text-sunset")} /> {trip.savedByMe ? "Saved" : "Save"}
            </Button>
          )}
          {may("trip.fork") && (
            <Button variant="accent" onClick={() => setForkOpen(true)}>
              <GitFork className="size-4" /> Use this trip
            </Button>
          )}
          {!me && trip.visibility === "PUBLIC" && trip.allowFork && (
            <Button variant="accent" href={`/login?next=/trips/${trip.id}`}>
              <GitFork className="size-4" /> Log in to remix
            </Button>
          )}
          {trip.visibility !== "PRIVATE" && (
            <Button variant="secondary" onClick={() => share(`/trips/${trip.id}`, trip.title)}>
              <Share2 className="size-4" /> Share
            </Button>
          )}
          {may("trip.change_visibility") && (
            <IconButton label="Trip settings" onClick={() => router.push(`/trips/${trip.id}/settings`)} className="border border-line bg-surface">
              <Settings className="size-4" />
            </IconButton>
          )}
        </div>
      </div>

      {trip.myRole === "VIEWER" && (
        <p className="flex items-center gap-2 rounded-2xl bg-sand-2 px-4 py-3 text-sm text-ink-2">
          <Eye className="size-4 shrink-0" /> You can view this trip. Ask {trip.owner.displayName} if you&apos;d like to help edit it.
        </p>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "plan", label: (<><ListChecks className="size-4" /> Plan</>) },
          { value: "map", label: (<><MapIcon className="size-4" /> Map</>) },
          { value: "members", label: (<><Users className="size-4" /> Members</>) },
        ]}
      />

      {tab === "plan" && (
        // Desktop: itinerary left, map right (spec §38). Mobile: itinerary only.
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
          <Itinerary trip={trip} selectedId={selected?.id} onSelect={select} />
          <div className="hidden lg:block">
            <div className="sticky top-6">
              <TripMap trip={trip} selectedId={selected?.id} onSelect={select} />
            </div>
          </div>
        </div>
      )}
      {tab === "map" && <TripMap trip={trip} selectedId={selected?.id} onSelect={select} />}
      {tab === "members" && <MembersPanel trip={trip} />}

      {may("members.invite") && <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} tripId={trip.id} />}
      {may("trip.fork") && <ForkSheet open={forkOpen} onClose={() => setForkOpen(false)} trip={trip} />}
    </div>
  );
}

function Stat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 font-medium text-ink-2">
      {icon}
      {label}
    </div>
  );
}
