"use client";

import { localizeMessage, memberDatesSchema, type MemberView, type TripDetail, type TripRole } from "@triply/shared";
import { CalendarRange, Clock, Link2, LogOut, Mail, UserMinus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { keys, useAction, useMe } from "@/lib/api/queries";
import { useFormat, useI18n, useT } from "@/i18n/client";
import { Avatar, Badge, Button, Field, Sheet, inputCls } from "../ui";
import { InviteSheet } from "./InviteSheet";

export function MembersPanel({ trip }: { trip: TripDetail }) {
  const me = useMe().data;
  const router = useRouter();
  const t = useT();
  const f = useFormat();
  const tm = t.trips.members;
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ userId: string; name: string; self: boolean } | null>(null);
  const may = (a: string) => trip.permissions.includes(a as never);
  const isOwner = may("members.change_role");
  const invalidate = [keys.trip(trip.id), ["trips"]];

  const changeRole = useAction((a: { userId: string; role: Exclude<TripRole, "OWNER">; name: string }) => api.patch(`/trips/${trip.id}/members/${a.userId}`, { role: a.role }), {
    invalidate,
    success: () => tm.roleUpdated,
  });
  const remove = useAction((userId: string) => api.delete<{ ok: true; invitationsRevoked?: number }>(`/trips/${trip.id}/members/${userId}`), {
    invalidate,
    // Their way back in is closed: say so when open invite links were cancelled with it.
    success: (r) => (r?.invitationsRevoked ? tm.linksRevoked(r.invitationsRevoked) : null),
  });
  const revoke = useAction((id: string) => api.delete(`/trips/${trip.id}/invitations/${id}`), { invalidate, success: tm.revoked });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">{tm.title(trip.myRole ? trip.members.length : trip.stats.travelers)}</h2>
        {may("members.invite") && (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" /> {t.common.invite}
          </Button>
        )}
      </div>

      <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        {trip.members.map((m) => (
          <li key={m.user.id} className="flex items-center gap-3 p-3.5">
            <Link href={`/u/${m.user.username}`} aria-label={tm.profileOf(m.user.displayName)}>
              <Avatar user={m.user} size={42} />
            </Link>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">
                {m.user.displayName} {m.user.id === me?.id && <span className="font-normal text-muted">{tm.you}</span>}
              </div>
              <div className="truncate text-xs text-muted">@{m.user.username}</div>
              {trip.myRole && <MemberDates trip={trip} member={m} canEdit={m.user.id === me?.id || trip.myRole === "OWNER"} />}
            </div>
            {isOwner && m.role !== "OWNER" ? (
              <>
                <label className="sr-only" htmlFor={`role-${m.user.id}`}>
                  {tm.roleFor(m.user.displayName)}
                </label>
                <select
                  id={`role-${m.user.id}`}
                  value={m.role}
                  disabled={changeRole.isPending}
                  onChange={(e) => changeRole.run({ userId: m.user.id, role: e.target.value as "EDITOR" | "VIEWER", name: m.user.displayName })}
                  className="h-9 w-[104px] shrink-0 rounded-full border border-line bg-surface px-3 text-sm font-medium"
                >
                  <option value="EDITOR">{t.labels.role.EDITOR}</option>
                  <option value="VIEWER">{t.labels.role.VIEWER}</option>
                </select>
                <button
                  onClick={() => setConfirm({ userId: m.user.id, name: m.user.displayName, self: false })}
                  aria-label={tm.remove(m.user.displayName)}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-accent-50 hover:text-danger"
                >
                  <UserMinus className="size-4" />
                </button>
              </>
            ) : (
              <Badge tone={m.role === "OWNER" ? "accent" : m.role === "EDITOR" ? "primary" : "neutral"}>{t.labels.role[m.role]}</Badge>
            )}
          </li>
        ))}
      </ul>

      {!trip.myRole && <p className="text-sm text-muted">{tm.membersOnly}</p>}

      {isOwner && (trip.pendingInvitations?.length ?? 0) > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink-2">{tm.pending}</h3>
          <ul className="space-y-2">
            {trip.pendingInvitations!.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 rounded-2xl border border-dashed border-line bg-surface/60 p-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-sand-2 text-ink-2">{inv.email ? <Mail className="size-4" /> : <Link2 className="size-4" />}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{inv.email ?? tm.inviteLink}</div>
                  <div className="flex items-center gap-1 text-xs text-muted">
                    <Clock className="size-3" /> {tm.sent(t.labels.role[inv.role], f.timeAgo(inv.createdAt), inv.invitedBy.displayName)}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => revoke.run(inv.id)}>
                  {tm.revoke}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {trip.myRole && trip.myRole !== "OWNER" && (
        <div className="flex flex-col gap-3 rounded-2xl bg-sand-2 px-4 py-3 text-sm text-ink-2 sm:flex-row sm:items-center">
          <p className="flex-1">{tm.ownerOnly(t.labels.roleWithArticle[trip.myRole])}</p>
          <Button size="sm" variant="secondary" onClick={() => setConfirm({ userId: me!.id, name: trip.title, self: true })}>
            <LogOut className="size-4" /> {tm.leaveTrip}
          </Button>
        </div>
      )}

      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} tripId={trip.id} />
      <Sheet open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.self ? tm.leaveTitle : tm.removeTitle(confirm?.name ?? "")}>
        <p className="text-sm text-ink-2">
          {confirm?.self ? tm.leaveBody : tm.removeBody(confirm?.name ?? "")}
        </p>
        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirm(null)}>
            {t.common.cancel}
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
            {confirm?.self ? tm.leave : t.common.remove}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

/**
 * The part of the trip a member is there for. Shown to members; editable by the member themselves
 * and by the owner. Empty = from the start / to the end of the trip.
 */
function MemberDates({ trip, member, canEdit }: { trip: TripDetail; member: MemberView; canEdit: boolean }) {
  const { m: t, locale } = useI18n();
  const f = useFormat();
  const td = t.trips.plan.dates;
  const [editing, setEditing] = useState(false);
  const [arrive, setArrive] = useState(member.arriveOn ?? "");
  const [leave, setLeave] = useState(member.leaveOn ?? "");
  const [error, setError] = useState<string>();
  const save = useAction((body: { arriveOn: string | null; leaveOn: string | null }) => api.patch(`/trips/${trip.id}/members/${member.user.id}/dates`, body), {
    invalidate: [keys.trip(trip.id)],
    success: td.saved,
  });
  const day = (iso: string) => f.day(iso, { day: "numeric", month: "short" });
  const label =
    member.arriveOn && member.leaveOn ? td.range(day(member.arriveOn), day(member.leaveOn)) : member.arriveOn ? td.from(day(member.arriveOn)) : member.leaveOn ? td.until(day(member.leaveOn)) : td.whole;

  if (!editing)
    return (
      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-2">
        <CalendarRange className="size-3.5 text-muted" aria-hidden />
        <span>{label}</span>
        {canEdit && (
          <button type="button" onClick={() => setEditing(true)} aria-label={td.editFor(member.user.displayName)} className="font-semibold text-primary hover:underline">
            {td.edit}
          </button>
        )}
      </div>
    );
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const body = { arriveOn: arrive || null, leaveOn: leave || null };
        const parsed = memberDatesSchema.safeParse(body);
        if (!parsed.success) return setError(localizeMessage(parsed.error.issues[0]?.message ?? "", locale));
        setError(undefined);
        if (await save.run(body)) setEditing(false);
      }}
      aria-label={td.editFor(member.user.displayName)}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label={td.arrive}>
          <input type="date" className={inputCls} value={arrive} min={trip.startDate ?? undefined} max={trip.endDate ?? undefined} onChange={(e) => setArrive(e.target.value)} />
        </Field>
        <Field label={td.leave}>
          <input type="date" className={inputCls} value={leave} min={arrive || trip.startDate || undefined} max={trip.endDate ?? undefined} onChange={(e) => setLeave(e.target.value)} />
        </Field>
      </div>
      <p className="text-xs text-muted">{td.hint}</p>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {td.save}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>
          {td.cancel}
        </Button>
      </div>
    </form>
  );
}
