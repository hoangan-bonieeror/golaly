"use client";

import { ROLE_LABEL } from "@triply/shared";
import { CalendarX2, Link2Off, MailOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { useAction, useInvitation, useMe } from "@/lib/api/queries";
import { Avatar, Button, EmptyState, ErrorState, PageLoader, formatDateRange } from "../ui";
import { Cover } from "./Cover";

/** Accept / decline an invitation, by link token or (from a notification) by id. */
export function InvitationCard({ by }: { by: { token: string } | { id: string } }) {
  const me = useMe();
  const router = useRouter();
  const q = useInvitation(by);
  const base = "token" in by ? `/invitations/${encodeURIComponent(by.token)}` : `/invitations/id/${by.id}`;
  const here = "token" in by ? `/invite/${by.token}` : `/invitations/${by.id}`;
  const accept = useAction(() => api.post<{ tripId: string }>(`${base}/accept`), { invalidate: [["trips"], ["notifications"]] });
  const reject = useAction(() => api.post(`${base}/reject`), { invalidate: [["notifications"]], success: "Invitation declined" });

  if (q.isLoading || me.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} />;
  const inv = q.data!;
  if (inv.status === "invalid" || inv.status === "revoked")
    return <EmptyState icon={<Link2Off className="size-7" />} title="This invitation isn't valid anymore" body="Ask the trip owner to send you a new link." action={<Button href="/home">Go home</Button>} />;
  if (inv.status === "expired")
    return <EmptyState icon={<CalendarX2 className="size-7" />} title="This invitation has expired." body="Invites last 7 days. Ask the owner for a fresh one." action={<Button href="/home">Go home</Button>} />;
  const trip = inv.trip!;

  return (
    <div className="mx-auto max-w-md">
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-card">
        <Cover palette={trip.cover} imageUrl={trip.coverUrl} seed={trip.id} rounded={false} className="aspect-[16/9]">
          <div className="flex h-full items-end p-4 font-display text-2xl font-semibold text-white">{trip.title}</div>
        </Cover>
        <div className="space-y-5 p-5">
          <div className="flex items-center gap-3">
            <Avatar user={inv.invitedBy} size={40} />
            <p className="text-[15px]">
              <b>{inv.invitedBy?.displayName}</b> invited you to join as <b>{ROLE_LABEL[inv.role!]}</b>
            </p>
          </div>
          <dl className="space-y-1 text-sm text-ink-2">
            {trip.route && <div>{trip.route}</div>}
            <div>{formatDateRange(trip.startDate ?? undefined, trip.endDate ?? undefined)}</div>
            <div className="flex items-center gap-2 pt-1">
              <div className="flex -space-x-2">
                {trip.members.slice(0, 5).map((m) => (
                  <Avatar key={m.id} user={m} size={24} ring />
                ))}
              </div>
              {trip.members.length} going
            </div>
          </dl>
          <p className="rounded-xl bg-sand-2 px-3 py-2 text-xs text-ink-2">
            {inv.role === "EDITOR" ? "Editors can add, edit and reorder itinerary items." : "Viewers can see the plan but can't change it."}
          </p>
          {!me.data ? (
            <div className="grid gap-2">
              <Button href={`/login?next=${encodeURIComponent(here)}`} size="lg" className="w-full">
                Log in to accept
              </Button>
              <Button href="/register" variant="secondary" size="lg" className="w-full">
                Create an account
              </Button>
            </div>
          ) : inv.alreadyMember ? (
            <Button href={`/trips/${trip.id}`} size="lg" className="w-full">
              You&apos;re already on this trip — open it
            </Button>
          ) : inv.status === "accepted" ? (
            <p className="text-center text-sm text-muted">This invitation has already been used.</p>
          ) : (
            <div className="flex gap-3">
              <Button
                variant="secondary"
                size="lg"
                disabled={reject.isPending}
                onClick={async () => {
                  if (await reject.run(undefined)) router.push("/home");
                }}
              >
                Decline
              </Button>
              <Button
                size="lg"
                className="flex-1"
                disabled={accept.isPending}
                onClick={async () => {
                  const r = await accept.run(undefined);
                  if (r) router.push(`/trips/${r.tripId}`);
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
