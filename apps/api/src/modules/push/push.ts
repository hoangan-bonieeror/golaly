import { Body, Controller, Delete, Global, HttpCode, Injectable, Logger, Module, Put } from "@nestjs/common";
import { isLocale, notificationText, registerPushDeviceSchema, removePushDeviceSchema, type NotificationMessage, type RegisterPushDeviceInput } from "@golaly/shared";
import { CurrentUser, type AuthUser } from "../../common/auth";
import { Errors, ZodPipe } from "../../common/http";
import { env } from "../../config/env";
import { PrismaService } from "../../prisma/prisma.service";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo takes at most 100 messages per request. */
const BATCH = 100;

export interface PushMessage {
  to: string;
  title?: string;
  body: string;
  /** Read by the app when the notification is opened (which screen to show). */
  data: Record<string, string | null>;
  sound?: "default";
  badge?: number;
}

/** A ticket per message, in order: "ok", or an error code such as DeviceNotRegistered. */
export type PushTicket = { status: "ok" } | { status: "error"; error?: string };

/** Talks to Expo's push service. Swapped for a fake in tests. */
@Injectable()
export class ExpoPushSender {
  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Expo push answered ${res.status}`);
    const body = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
    return (body.data ?? []).map((t) => (t.status === "ok" ? { status: "ok" } : { status: "error", error: t.details?.error }));
  }
}

/**
 * Push notifications to the app. Devices are registered by the signed-in app and tied to that session; only
 * devices whose session is still live receive anything. Sending is best-effort and out of band: a slow or failing
 * push service never fails (or slows) the action that caused the notification.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger("Push");

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: ExpoPushSender,
  ) {}

  get enabled() {
    return env.PUSH_DRIVER === "expo";
  }

  /** Registers this phone for the current session (or moves it here from an older session or account). */
  async register(user: AuthUser, input: RegisterPushDeviceInput) {
    const data = { userId: user.id, sessionId: user.sessionId, platform: input.platform, lastSeenAt: new Date() };
    await this.prisma.pushDevice.upsert({ where: { token: input.token }, create: { token: input.token, ...data }, update: data });
  }

  async unregister(userId: string, token: string) {
    await this.prisma.pushDevice.deleteMany({ where: { token, userId } });
  }

  /** Signed out: these sessions' phones stop getting notifications. */
  async forgetSessions(sessionIds: string[]) {
    if (sessionIds.length) await this.prisma.pushDevice.deleteMany({ where: { sessionId: { in: sessionIds } } });
  }

  /** Fire and forget: one push per notification, to every live device of each recipient, in their language. */
  notify(items: { userId: string; notificationId: string; actorName: string | null; message: NotificationMessage; tripId?: string | null; postId?: string | null; invitationId?: string | null }[]) {
    if (!this.enabled || !items.length) return;
    void this.deliver(items).catch((e: Error) => this.log.warn(`Push delivery failed: ${e.message}`));
  }

  private async deliver(items: Parameters<PushService["notify"]>[0]) {
    const now = new Date();
    const devices = await this.prisma.pushDevice.findMany({
      where: { userId: { in: [...new Set(items.map((i) => i.userId))] }, session: { revokedAt: null, expiresAt: { gt: now }, user: { deletedAt: null } } },
      select: { token: true, userId: true, user: { select: { profile: { select: { locale: true } } } } },
    });
    if (!devices.length) return;
    const messages: PushMessage[] = [];
    for (const item of items) {
      for (const d of devices.filter((x) => x.userId === item.userId)) {
        const locale = isLocale(d.user.profile?.locale) ? d.user.profile.locale : "en";
        const text = notificationText(item.message, locale);
        messages.push({
          to: d.token,
          title: "Golaly",
          body: item.actorName ? `${item.actorName} ${text}` : text,
          sound: "default",
          data: { notificationId: item.notificationId, tripId: item.tripId ?? null, postId: item.postId ?? null, invitationId: item.invitationId ?? null },
        });
      }
    }
    for (let i = 0; i < messages.length; i += BATCH) {
      const batch = messages.slice(i, i + BATCH);
      const tickets = await this.sender.send(batch);
      // The app was uninstalled or the token was revoked: stop sending to it.
      const gone = batch.filter((_, j) => tickets[j]?.status === "error" && (tickets[j] as { error?: string }).error === "DeviceNotRegistered").map((m) => m.to);
      if (gone.length) await this.prisma.pushDevice.deleteMany({ where: { token: { in: gone } } });
    }
  }
}

@Controller("push/devices")
export class PushController {
  constructor(private readonly push: PushService) {}

  /** The app calls this after sign-in and whenever Expo hands it a (new) token. Idempotent. */
  @HttpCode(200)
  @Put()
  async register(@CurrentUser() user: AuthUser | null, @Body(new ZodPipe(registerPushDeviceSchema)) body: RegisterPushDeviceInput) {
    if (!user) throw Errors.unauthorized();
    await this.push.register(user, body);
    return { ok: true, enabled: this.push.enabled };
  }

  /** Notifications turned off in the app (signing out removes the device on its own). */
  @HttpCode(200)
  @Delete()
  async remove(@CurrentUser() user: AuthUser | null, @Body(new ZodPipe(removePushDeviceSchema)) body: { token: string }) {
    if (!user) throw Errors.unauthorized();
    await this.push.unregister(user.id, body.token);
    return { ok: true };
  }
}

@Global()
@Module({ providers: [PushService, ExpoPushSender], controllers: [PushController], exports: [PushService] })
export class PushModule {}
