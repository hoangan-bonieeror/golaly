import { Controller, Get, Global, Injectable, Module, Param, ParseUUIDPipe, Patch, Query } from "@nestjs/common";
import { notificationText, pageQuerySchema, type NotificationMessage, type NotificationType, type NotificationView, type Paged } from "@golaly/shared";
import { ViewerId, requireUser } from "../../common/auth";
import { ZodPipe } from "../../common/http";
import { notificationInclude, toNotificationView } from "../../common/presenters";
import type { Prisma } from "../../generated/prisma/client";
import { afterCommit, PrismaService, type Tx } from "../../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime";

/** Item edits within this window update the existing unread notification instead of stacking new ones. */
const COALESCE_MS = 10 * 60_000;
const COALESCED: NotificationType[] = ["TRIP_ITEM_ADDED", "TRIP_ITEM_UPDATED"];

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async notify(
    recipients: string[],
    actorId: string | null,
    type: NotificationType,
    message: NotificationMessage,
    refs: { tripId?: string; postId?: string; invitationId?: string } = {},
    tx: Tx = this.prisma,
  ) {
    const unique = [...new Set(recipients)].filter((r) => r !== actorId);
    const text = notificationText(message, "en");
    const params = message as unknown as Prisma.InputJsonObject;
    const created: { userId: string; view: NotificationView }[] = [];
    for (const userId of unique) {
      let row;
      if (COALESCED.includes(type)) {
        const recent = await tx.notification.findFirst({
          where: { userId, actorId, type, tripId: refs.tripId, readAt: null, createdAt: { gte: new Date(Date.now() - COALESCE_MS) } },
        });
        if (recent)
          row = await tx.notification.update({ where: { id: recent.id }, data: { text, params, createdAt: new Date() }, include: notificationInclude });
      }
      row ??= await tx.notification.create({ data: { userId, actorId, type, text, params, ...refs }, include: notificationInclude });
      created.push({ userId, view: toNotificationView(row) });
    }
    // Push only after the surrounding transaction commits (never for rows that were rolled back).
    afterCommit(() => created.forEach((c) => this.realtime.notification(c.userId, c.view)));
  }

  async list(userId: string, cursor: string | undefined, limit: number): Promise<Paged<NotificationView>> {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: notificationInclude,
    });
    const page = rows.slice(0, limit);
    return { items: page.map(toNotificationView), nextCursor: rows.length > limit ? page.at(-1)!.id : null };
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
  }

  async markAllRead(userId: string) {
    const r = await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return r.count;
  }
}

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@ViewerId() me: string | null, @Query(new ZodPipe(pageQuerySchema)) q: { cursor?: string; limit: number }) {
    return this.svc.list(requireUser(me), q.cursor, q.limit);
  }

  @Get("unread-count")
  async unread(@ViewerId() me: string | null) {
    return { count: await this.svc.unreadCount(requireUser(me)) };
  }

  @Patch("read-all")
  async readAll(@ViewerId() me: string | null) {
    return { updated: await this.svc.markAllRead(requireUser(me)) };
  }

  @Patch(":id/read")
  async read(@ViewerId() me: string | null, @Param("id", ParseUUIDPipe) id: string) {
    await this.svc.markRead(requireUser(me), id);
    return { ok: true };
  }
}

@Global()
@Module({ providers: [NotificationsService], controllers: [NotificationsController], exports: [NotificationsService] })
export class NotificationsModule {}
