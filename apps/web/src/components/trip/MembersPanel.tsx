"use client";

import { ROLE_LABEL, type TripDetail, type TripRole } from "@triply/shared";
import { Clock, Link2, LogOut, Mail, UserMinus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { keys, useAction, useMe } from "@/lib/api/queries";
import { Avatar, Badge, Button, Sheet, timeAgo } from "../ui";
import { InviteSheet } from "./InviteSheet";

export function MembersPanel({ trip }: { trip: TripDetail }) {
  const me = useMe().data;
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ userId: string; name: string; self: boolean } | null>(null);
  const may = (a: string) => trip.permissions.includes(a as never);
  const isOwner = may("members.change_role");
  const invalidate = [keys.trip(trip.id), ["trips"]];

  const changeRole = useAction((a: { userId: string; role: Exclude<TripRole, "OWNER">; name: string }) => api.patch(`/trips/${trip.id}/members/${a.userId}`, { role: a.role }), {
    invalidate,
    success: () => "Role updated",
  });
  const remove = useAction((userId: string) => api.delete(`/trips/${trip.id}/members/${userId}`), { invalidate });
  const revoke = useAction((id: string) => api.delete(`/trips/${trip.id}/invitations/${id}`), { invalidate, success: "Invitation revoked" });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">Trip members · {trip.myRole ? trip.members.length : trip.stats.travelers}</h2>
        {may("members.invite") && (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" /> Invite
          </Button>
        )}
      </div>

      <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        {trip.members.map((m) => (
          <li key={m.user.id} className="flex items-center gap-3 p-3.5">
            <Link href={`/u/${m.user.username}`} aria-label={`${m.user.displayName}'s profile`}>
              <Avatar user={m.user} size={42} />
            </Link>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">
                {m.user.displayName} {m.user.id === me?.id && <span className="font-normal text-muted">(you)</span>}
              </div>
              <div className="truncate text-xs text-muted">@{m.user.username}</div>
            </div>
            {isOwner && m.role !== "OWNER" ? (
              <>
                <label className="sr-only" htmlFor={`role-${m.user.id}`}>
                  Role for {m.user.displayName}
                </label>
                <select
                  id={`role-${m.user.id}`}
                  value={m.role}
                  disabled={changeRole.isPending}
                  onChange={(e) => changeRole.run({ userId: m.user.id, role: e.target.value as "EDITOR" | "VIEWER", name: m.user.displayName })}
                  className="h-9 w-[104px] shrink-0 rounded-full border border-line bg-surface px-3 text-sm font-medium"
                >
                  <option value="EDITOR">Editor</option>
                  <option value="VIEWER">Viewer</option>
                </select>
                <button
                  onClick={() => setConfirm({ userId: m.user.id, name: m.user.displayName, self: false })}
                  aria-label={`Remove ${m.user.displayName}`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-sunset-50 hover:text-danger"
                >
                  <UserMinus className="size-4" />
                </button>
              </>
            ) : (
              <Badge tone={m.role === "OWNER" ? "sunset" : m.role === "EDITOR" ? "lagoon" : "neutral"}>{ROLE_LABEL[m.role]}</Badge>
            )}
          </li>
        ))}
      </ul>

      {!trip.myRole && <p className="text-sm text-muted">Only members can see who else is on this trip.</p>}

      {isOwner && (trip.pendingInvitations?.length ?? 0) > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink-2">Pending invitations</h3>
          <ul className="space-y-2">
            {trip.pendingInvitations!.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 rounded-2xl border border-dashed border-line bg-surface/60 p-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-sand-2 text-ink-2">{inv.email ? <Mail className="size-4" /> : <Link2 className="size-4" />}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{inv.email ?? "Invite link"}</div>
                  <div className="flex items-center gap-1 text-xs text-muted">
                    <Clock className="size-3" /> {ROLE_LABEL[inv.role]} · sent {timeAgo(inv.createdAt)} by {inv.invitedBy.displayName}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => revoke.run(inv.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {trip.myRole && trip.myRole !== "OWNER" && (
        <div className="flex flex-col gap-3 rounded-2xl bg-sand-2 px-4 py-3 text-sm text-ink-2 sm:flex-row sm:items-center">
          <p className="flex-1">Only the trip owner can invite people or change roles. You&apos;re {trip.myRole === "EDITOR" ? "an Editor" : "a Viewer"} on this trip.</p>
          <Button size="sm" variant="secondary" onClick={() => setConfirm({ userId: me!.id, name: trip.title, self: true })}>
            <LogOut className="size-4" /> Leave trip
          </Button>
        </div>
      )}

      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} tripId={trip.id} />
      <Sheet open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.self ? "Leave this trip?" : `Remove ${confirm?.name}?`}>
        <p className="text-sm text-ink-2">
          {confirm?.self ? "You'll lose access unless someone invites you again." : `${confirm?.name} will immediately lose access to this trip.`}
        </p>
        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            className="flex-1 !bg-danger"
            disabled={remove.isPending}
            onClick={async () => {
              const c = confirm!;
              setConfirm(null);
              if (await remove.run(c.userId)) {
                if (c.self) router.push("/trips");
              }
            }}
          >
            {confirm?.self ? "Leave" : "Remove"}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
