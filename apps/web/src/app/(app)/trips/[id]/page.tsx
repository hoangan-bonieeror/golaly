"use client";

import { ROLE_LABEL, VISIBILITY_LABEL, type ItineraryItem } from "@triply/shared";
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
  Settings,
  Share2,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { Itinerary } from "@/components/itinerary/Itinerary";
import { TripMap } from "@/components/map/TripMap";
import { useShare } from "@/components/social/PostCard";
import { Cover } from "@/components/trip/Cover";
import { ForkSheet } from "@/components/trip/ForkSheet";
import { InviteSheet } from "@/components/trip/InviteSheet";
import { MembersPanel } from "@/components/trip/MembersPanel";
import { Avatar, Badge, Button, EmptyState, IconButton, Tabs, cx, formatCount, formatDateRange } from "@/components/ui";
import { routeLabel, tripMembers, tripStats, userById } from "@/lib/mock/selectors";
import { usePermissions } from "@/lib/store/hooks";
import { useStore } from "@/lib/store/store";

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
  const { db, me, actions, toast, ready } = useStore();
  const perm = usePermissions(id);
  const share = useShare();
  const [selected, setSelected] = useState<ItineraryItem | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const tab = (search.get("tab") as Tab) ?? "plan";
  const setTab = (t: Tab) => router.replace(`/trips/${id}${t === "plan" ? "" : `?tab=${t}`}`, { scroll: false });

  const trip = db.trips.find((t) => t.id === id && !t.deletedAt);
  if (!ready) return null;
  if (!trip)
    return <EmptyState icon={<MapPin className="size-7" />} title="Trip not found" body="It may have been deleted by its owner." action={<Button href="/trips">My trips</Button>} />;
  if (!perm.can("trip.view"))
    return (
      <EmptyState
        icon={<Lock className="size-7" />}
        title="This trip is private."
        body="Only people the owner has invited can see it. Ask them for an invite link."
        action={<Button href="/explore">Explore public trips</Button>}
      />
    );

  const s = tripStats(db, trip);
  const owner = userById(db, trip.ownerId)!;
  const members = tripMembers(db, trip.id);
  const isMember = !!perm.role;
  const saved = db.savedTrips.some((x) => x.userId === me && x.tripId === trip.id);
  const VisIcon = trip.visibility === "PUBLIC" ? Globe2 : trip.visibility === "LINK_ONLY" ? Link2 : Lock;
  const select = (it: ItineraryItem) => setSelected((cur) => (cur?.id === it.id ? null : it));

  return (
    <div className="space-y-6">
      {/* Hero */}
      <Cover palette={trip.cover} seed={trip.id} className="-mx-4 -mt-4 aspect-[4/3] rounded-none sm:aspect-[16/7] md:mx-0 md:mt-0 md:rounded-[var(--radius-card)]">
        <div className="flex h-full flex-col justify-between p-4 text-white md:p-7">
          <div className="flex items-center justify-between">
            <IconButton label="Back" onClick={() => router.back()} className="bg-black/30 text-white backdrop-blur hover:bg-black/40">
              <ArrowLeft className="size-5" />
            </IconButton>
            <span className="flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1.5 text-xs font-semibold backdrop-blur">
              <VisIcon className="size-3.5" /> {VISIBILITY_LABEL[trip.visibility].label}
            </span>
          </div>
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-white/90">
              <MapPin className="size-4" /> {routeLabel(db, trip) || "Destination TBD"}
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
            <Link href={`/trips/${trip.forkedFrom.sourceTripId}`} className="font-semibold text-ink hover:underline">
              {trip.forkedFrom.sourceTripTitle}
            </Link>{" "}
            by{" "}
            <Link href={`/u/${trip.forkedFrom.sourceOwnerUsername}`} className="font-semibold text-ink hover:underline">
              @{trip.forkedFrom.sourceOwnerUsername}
            </Link>
          </span>
        </p>
      )}

      {/* Summary + actions */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-4">
          <div className="flex items-center gap-3">
            <Link href={`/u/${owner.username}`} className="flex items-center gap-2">
              <Avatar user={owner} size={32} />
              <span className="text-sm font-semibold">{owner.displayName}</span>
            </Link>
            {perm.role && <Badge tone={perm.role === "OWNER" ? "sunset" : perm.role === "EDITOR" ? "lagoon" : "neutral"}>You · {ROLE_LABEL[perm.role]}</Badge>}
            <div className="flex -space-x-2">
              {members.slice(0, 5).map((m) => (
                <Avatar key={m.userId} user={m.user} size={26} ring />
              ))}
            </div>
          </div>
          {trip.description && <p className="max-w-2xl text-[15px] leading-relaxed text-ink-2">{trip.description}</p>}
          <dl className="flex flex-wrap gap-2 text-sm">
            <Stat icon={<CalendarDays className="size-4" />} label={formatDateRange(trip.startDate, trip.endDate)} />
            <Stat icon={<ListChecks className="size-4" />} label={`${s.days} days`} />
            <Stat icon={<MapPin className="size-4" />} label={`${s.places} places`} />
            <Stat icon={<Users className="size-4" />} label={`${s.travelers} ${s.travelers === 1 ? "traveler" : "travelers"}`} />
            {trip.estimatedBudget && <Stat icon={<Wallet className="size-4" />} label={`~$${trip.estimatedBudget.toLocaleString()} pp`} />}
            {trip.visibility === "PUBLIC" && <Stat icon={<GitFork className="size-4" />} label={`${formatCount(trip.forkCount)} remixes`} />}
          </dl>
        </div>

        <div className="flex flex-wrap gap-2 lg:shrink-0 lg:justify-end">
          {perm.can("trip.edit_details") && (
            <Button href={`/trips/${trip.id}/settings`} variant="secondary">
              <PenLine className="size-4" /> Edit
            </Button>
          )}
          {perm.can("members.invite") && (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="size-4" /> Invite
            </Button>
          )}
          {!isMember && me && trip.visibility !== "PRIVATE" && (
            <Button
              variant="secondary"
              onClick={() => {
                const r = actions.toggleSaveTrip(trip.id);
                if (r !== undefined) toast(r ? "Saved to your trips" : "Removed from saved");
              }}
            >
              <Bookmark className={cx("size-4", saved && "fill-sunset text-sunset")} /> {saved ? "Saved" : "Save"}
            </Button>
          )}
          {perm.can("trip.fork") && trip.ownerId !== me && (
            <Button variant="accent" onClick={() => setForkOpen(true)}>
              <GitFork className="size-4" /> Use this trip
            </Button>
          )}
          {!me && trip.visibility === "PUBLIC" && (
            <Button variant="accent" href="/login">
              <GitFork className="size-4" /> Log in to remix
            </Button>
          )}
          {trip.visibility !== "PRIVATE" && (
            <Button variant="secondary" onClick={() => share(`/trips/${trip.id}`)}>
              <Share2 className="size-4" /> Share
            </Button>
          )}
          {perm.can("trip.change_visibility") && (
            <IconButton label="Trip settings" onClick={() => router.push(`/trips/${trip.id}/settings`)} className="border border-line bg-surface">
              <Settings className="size-4" />
            </IconButton>
          )}
        </div>
      </div>

      {perm.role === "VIEWER" && (
        <p className="flex items-center gap-2 rounded-2xl bg-sand-2 px-4 py-3 text-sm text-ink-2">
          <Eye className="size-4 shrink-0" /> You can view this trip. Ask {owner.displayName} if you&apos;d like to help edit it.
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
          <Itinerary tripId={trip.id} selectedId={selected?.id} onSelect={select} />
          <div className="hidden lg:block">
            <div className="sticky top-6">
              <TripMap tripId={trip.id} selectedId={selected?.id} onSelect={select} />
            </div>
          </div>
        </div>
      )}
      {tab === "map" && <TripMap tripId={trip.id} selectedId={selected?.id} onSelect={select} />}
      {tab === "members" && <MembersPanel tripId={trip.id} />}

      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} tripId={trip.id} />
      <ForkSheet open={forkOpen} onClose={() => setForkOpen(false)} tripId={trip.id} />
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
