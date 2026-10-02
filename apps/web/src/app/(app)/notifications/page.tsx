"use client";

import type { Notification } from "@triply/shared";
import { Bell, Bookmark, GitFork, Heart, MessageCircle, PencilLine, Plus, ShieldCheck, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Avatar, Button, EmptyState, cx, timeAgo } from "@/components/ui";
import { userById } from "@/lib/mock/selectors";
import { useStore } from "@/lib/store/store";

const ICON: Record<Notification["type"], React.ElementType> = {
  TRIP_INVITE: UserPlus,
  TRIP_ITEM_ADDED: Plus,
  TRIP_ITEM_UPDATED: PencilLine,
  TRIP_MEMBER_ROLE_CHANGED: ShieldCheck,
  COMMENT: MessageCircle,
  LIKE: Heart,
  FOLLOW: UserPlus,
  TRIP_SAVED: Bookmark,
  TRIP_FORKED: GitFork,
};

export default function NotificationsPage() {
  const { db, me, actions } = useStore();
  const router = useRouter();
  const list = db.notifications.filter((n) => n.userId === me).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = list.filter((n) => !n.readAt).length;

  const hrefFor = (n: Notification) => {
    if (n.type === "TRIP_INVITE" && n.invitationToken) return `/invite/${n.invitationToken}`;
    if (n.tripId) return `/trips/${n.tripId}`;
    if (n.postId) return `/posts/${n.postId}`;
    const actor = userById(db, n.actorId);
    return actor ? `/u/${actor.username}` : "/home";
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold md:text-4xl">Notifications</h1>
          <p className="text-sm text-muted">{unread ? `${unread} unread` : "All read"}</p>
        </div>
        {unread > 0 && (
          <Button variant="secondary" size="sm" onClick={() => actions.markAllRead()}>
            Mark all as read
          </Button>
        )}
      </header>

      {list.length === 0 ? (
        <EmptyState icon={<Bell className="size-7" />} title="You're all caught up." />
      ) : (
        <ul className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          {list.map((n) => {
            const actor = userById(db, n.actorId);
            const Icon = ICON[n.type];
            return (
              <li key={n.id} className="border-b border-line last:border-0">
                <button
                  onClick={() => {
                    actions.markRead(n.id);
                    router.push(hrefFor(n));
                  }}
                  className={cx("flex w-full items-start gap-3 p-4 text-left hover:bg-sand/60", !n.readAt && "bg-lagoon-50/50")}
                >
                  <span className="relative">
                    <Avatar user={actor} size={42} />
                    <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-ink text-white ring-2 ring-surface">
                      <Icon className="size-3" />
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] leading-snug">
                    <b>{actor?.displayName}</b> {n.text}
                    <span className="mt-0.5 block text-xs text-muted">{timeAgo(n.createdAt)}</span>
                    {n.type === "TRIP_INVITE" && n.invitationToken && !n.readAt && (
                      <span className="mt-2 inline-flex rounded-full bg-lagoon px-3 py-1 text-xs font-semibold text-white">View invitation</span>
                    )}
                  </span>
                  {!n.readAt && <span className="mt-2 size-2.5 shrink-0 rounded-full bg-sunset" aria-label="Unread" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-center text-xs text-muted">
        Prototype tip: switch demo users with the flask button to see the other side of invites and edits.
      </p>
    </div>
  );
}
