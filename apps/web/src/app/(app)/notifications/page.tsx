"use client";

import type { NotificationView } from "@triply/shared";
import { Bell, Bookmark, GitFork, Heart, MessageCircle, PencilLine, Plus, ShieldCheck, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Avatar, Button, EmptyState, ErrorState, Skeleton, cx, timeAgo } from "@/components/ui";
import { api } from "@/lib/api/client";
import { keys, useAction, useNotifications } from "@/lib/api/queries";

const ICON: Record<NotificationView["type"], React.ElementType> = {
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
  const router = useRouter();
  const q = useNotifications();
  const list = q.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = list.filter((n) => !n.readAt).length;
  const markAll = useAction(() => api.patch("/notifications/read-all"), { invalidate: [keys.notifications] });
  const markOne = useAction((id: string) => api.patch(`/notifications/${id}/read`), { invalidate: [keys.notifications], silentErrors: true });

  const hrefFor = (n: NotificationView) => {
    if (n.type === "TRIP_INVITE" && n.invitationId && !n.readAt) return `/invitations/${n.invitationId}`;
    if (n.tripId) return `/trips/${n.tripId}`;
    if (n.postId) return `/posts/${n.postId}`;
    return n.actor ? `/u/${n.actor.username}` : "/home";
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold md:text-4xl">Notifications</h1>
          <p className="text-sm text-muted">{q.isLoading ? " " : unread ? `${unread} unread` : "All read"}</p>
        </div>
        {unread > 0 && (
          <Button variant="secondary" size="sm" onClick={() => markAll.run(undefined)} disabled={markAll.isPending}>
            Mark all as read
          </Button>
        )}
      </header>

      {q.isLoading ? (
        <Skeleton className="h-72" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon={<Bell className="size-7" />} title="You're all caught up." />
      ) : (
        <ul className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          {list.map((n) => {
            const Icon = ICON[n.type];
            return (
              <li key={n.id} className="border-b border-line last:border-0">
                <button
                  onClick={() => {
                    const href = hrefFor(n);
                    if (!n.readAt && !(n.type === "TRIP_INVITE" && n.invitationId)) void markOne.run(n.id);
                    router.push(href);
                  }}
                  className={cx("flex w-full items-start gap-3 p-4 text-left hover:bg-sand/60", !n.readAt && "bg-lagoon-50/50")}
                >
                  <span className="relative">
                    <Avatar user={n.actor} size={42} />
                    <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-ink text-white ring-2 ring-surface">
                      <Icon className="size-3" />
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] leading-snug">
                    <b>{n.actor?.displayName ?? "Someone"}</b> {n.text}
                    <span className="mt-0.5 block text-xs text-muted">{timeAgo(n.createdAt)}</span>
                    {n.type === "TRIP_INVITE" && n.invitationId && !n.readAt && (
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
      {q.hasNextPage && (
        <Button variant="secondary" className="w-full" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          Load more
        </Button>
      )}
    </div>
  );
}
