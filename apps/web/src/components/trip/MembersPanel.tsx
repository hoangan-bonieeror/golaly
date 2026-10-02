"use client";

import { ROLE_LABEL, type TripRole, type UUID } from "@triply/shared";
import { Clock, Link2, Mail, UserMinus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { tripMembers, userById } from "@/lib/mock/selectors";
import { usePermissions } from "@/lib/store/hooks";
import { useStore } from "@/lib/store/store";
import { Avatar, Badge, Button, timeAgo } from "../ui";
import { InviteSheet } from "./InviteSheet";

export function MembersPanel({ tripId }: { tripId: UUID }) {
  const { db, me, actions, toast } = useStore();
  const perm = usePermissions(tripId);
  const members = tripMembers(db, tripId);
  const [inviteOpen, setInviteOpen] = useState(false);
  const pending = db.invitations.filter((i) => i.tripId === tripId && !i.revokedAt && !i.acceptedAt && Date.parse(i.expiresAt) > Date.now());
  const isOwner = perm.can("members.change_role");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-xl font-semibold">Trip members · {members.length}</h3>
        {perm.can("members.invite") && (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" /> Invite
          </Button>
        )}
      </div>

      <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 p-3.5">
            <Link href={`/u/${m.user.username}`}>
              <Avatar user={m.user} size={42} />
            </Link>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                {m.user.displayName} {m.userId === me && <span className="font-normal text-muted">(you)</span>}
              </div>
              <div className="truncate text-xs text-muted">@{m.user.username}</div>
            </div>
            {isOwner && m.role !== "OWNER" ? (
              <>
                <label className="sr-only" htmlFor={`role-${m.userId}`}>
                  Role for {m.user.displayName}
                </label>
                <select
                  id={`role-${m.userId}`}
                  value={m.role}
                  onChange={(e) => {
                    const role = e.target.value as Exclude<TripRole, "OWNER">;
                    actions.changeRole(tripId, m.userId, role);
                    toast(`${m.user.displayName} is now ${role === "EDITOR" ? "an Editor" : "a Viewer"}`);
                  }}
                  className="h-9 w-[104px] shrink-0 rounded-full border border-line bg-surface px-3 text-sm font-medium"
                >
                  <option value="EDITOR">Editor</option>
                  <option value="VIEWER">Viewer</option>
                </select>
                <button
                  onClick={() => {
                    actions.removeMember(tripId, m.userId);
                    toast(`${m.user.displayName} removed from trip`);
                  }}
                  aria-label={`Remove ${m.user.displayName}`}
                  className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-sunset-50 hover:text-danger"
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

      {isOwner && pending.length > 0 && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-ink-2">Pending invitations</h4>
          <ul className="space-y-2">
            {pending.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 rounded-2xl border border-dashed border-line bg-surface/60 p-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-sand-2 text-ink-2">
                  {inv.email ? <Mail className="size-4" /> : <Link2 className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{inv.email ?? "Invite link"}</div>
                  <div className="flex items-center gap-1 text-xs text-muted">
                    <Clock className="size-3" /> {ROLE_LABEL[inv.role]} · sent {timeAgo(new Date(Date.parse(inv.expiresAt) - 7 * 86400_000).toISOString())} by {userById(db, inv.invitedBy)?.displayName}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    actions.revokeInvitation(inv.id);
                    toast("Invitation revoked");
                  }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!isOwner && perm.role && (
        <p className="rounded-2xl bg-sand-2 px-4 py-3 text-sm text-ink-2">
          Only the trip owner can invite people or change roles. You&apos;re {perm.role === "EDITOR" ? "an Editor" : "a Viewer"} on this trip.
        </p>
      )}

      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} tripId={tripId} />
    </div>
  );
}
