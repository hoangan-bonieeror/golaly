"use client";

import { ROLE_LABEL } from "@triply/shared";
import { CalendarX2, Link2Off, MailOpen } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { Cover } from "@/components/trip/Cover";
import { Avatar, Button, EmptyState, formatDateRange } from "@/components/ui";
import { lookupInvitation } from "@/lib/mock/api";
import { routeLabel, tripMembers, userById } from "@/lib/mock/selectors";
import { useStore } from "@/lib/store/store";

/** GET /invitations/:token → accept / reject (spec §16). */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { db, me, actions, toast, ready } = useStore();
  const router = useRouter();
  if (!ready) return null;

  const res = lookupInvitation(db, decodeURIComponent(token));
  if (res.status === "invalid" || res.status === "revoked")
    return <EmptyState icon={<Link2Off className="size-7" />} title="This invitation isn't valid anymore" body="Ask the trip owner to send you a new link." action={<Button href="/home">Go home</Button>} />;
  if (res.status === "expired")
    return <EmptyState icon={<CalendarX2 className="size-7" />} title="This invitation has expired." body="Invites last 7 days. Ask the owner for a fresh one." action={<Button href="/home">Go home</Button>} />;

  const inv = res.inv;
  const trip = db.trips.find((t) => t.id === inv.tripId && !t.deletedAt);
  if (!trip) return <EmptyState icon={<Link2Off className="size-7" />} title="This trip was deleted" />;
  const inviter = userById(db, inv.invitedBy)!;
  const already = db.members.some((m) => m.tripId === trip.id && m.userId === me);
  const members = tripMembers(db, trip.id);

  return (
    <div className="mx-auto max-w-md">
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-card">
        <Cover palette={trip.cover} seed={trip.id} rounded={false} className="aspect-[16/9]">
          <div className="flex h-full items-end p-4 font-display text-2xl font-semibold text-white">{trip.title}</div>
        </Cover>
        <div className="space-y-5 p-5">
          <div className="flex items-center gap-3">
            <Avatar user={inviter} size={40} />
            <p className="text-[15px]">
              <b>{inviter.displayName}</b> invited you to join as <b>{ROLE_LABEL[inv.role]}</b>
            </p>
          </div>
          <dl className="space-y-1 text-sm text-ink-2">
            <div>{routeLabel(db, trip)}</div>
            <div>{formatDateRange(trip.startDate, trip.endDate)}</div>
            <div className="flex items-center gap-2 pt-1">
              <div className="flex -space-x-2">
                {members.slice(0, 5).map((m) => (
                  <Avatar key={m.userId} user={m.user} size={24} ring />
                ))}
              </div>
              {members.length} going
            </div>
          </dl>
          <p className="rounded-xl bg-sand-2 px-3 py-2 text-xs text-ink-2">
            {inv.role === "EDITOR" ? "Editors can add, edit and reorder itinerary items." : "Viewers can see the plan but can't change it."}
          </p>
          {!me ? (
            <Button href="/login" size="lg" className="w-full">
              Log in to accept
            </Button>
          ) : already ? (
            <Button href={`/trips/${trip.id}`} size="lg" className="w-full">
              You&apos;re already on this trip — open it
            </Button>
          ) : (
            <div className="flex gap-3">
              <Button
                variant="secondary"
                size="lg"
                onClick={() => {
                  actions.rejectInvitation(inv.token);
                  toast("Invitation declined");
                  router.push("/home");
                }}
              >
                Decline
              </Button>
              <Button
                size="lg"
                className="flex-1"
                onClick={() => {
                  const id = actions.acceptInvitation(inv.token);
                  if (id) {
                    toast(`You joined ${trip.title}`);
                    router.push(`/trips/${id}`);
                  }
                }}
              >
                <MailOpen className="size-4" /> Accept & open trip
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
