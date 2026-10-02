import { Global, Injectable, Logger, Module } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { can, type NotificationView, type TripEvent, type TripEventName } from "@triply/shared";
import type { Server, Socket } from "socket.io";
import { ACCESS_COOKIE, type JwtPayload } from "../../common/auth";
import { env } from "../../config/env";
import { PrismaService } from "../../prisma/prisma.service";

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * Realtime collaboration (spec §31). Clients authenticate with the same HTTP-only cookie,
 * then ask to join `trip:<id>` rooms; joining re-checks `trip.view` permission server-side.
 * Events are notifications to refetch — the REST API stays the single source of truth.
 */
@WebSocketGateway({ path: "/socket.io", cors: { origin: env.WEB_ORIGIN, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;
  private readonly log = new Logger("Realtime");

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(socket: Socket) {
    const token = parseCookies(socket.handshake.headers.cookie)[ACCESS_COOKIE] ?? (socket.handshake.auth?.token as string | undefined);
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token ?? "", { secret: env.JWT_SECRET });
      socket.data.userId = payload.sub;
      await socket.join(`user:${payload.sub}`);
    } catch {
      socket.emit("auth.error", { message: "Please log in to continue." });
      socket.disconnect(true);
    }
  }

  @SubscribeMessage("trip.join")
  async joinTrip(@ConnectedSocket() socket: Socket, @MessageBody() body: { tripId?: string }) {
    const userId = socket.data.userId as string | undefined;
    const tripId = typeof body?.tripId === "string" ? body.tripId : "";
    if (!userId || !/^[0-9a-f-]{36}$/i.test(tripId)) return { ok: false };
    const trip = await this.prisma.trip.findFirst({ where: { id: tripId, deletedAt: null }, include: { members: true } });
    if (!trip || !can("trip.view", { trip, members: trip.members, userId })) return { ok: false };
    await socket.join(`trip:${tripId}`);
    return { ok: true };
  }

  @SubscribeMessage("trip.leave")
  async leaveTrip(@ConnectedSocket() socket: Socket, @MessageBody() body: { tripId?: string }) {
    if (typeof body?.tripId === "string") await socket.leave(`trip:${body.tripId}`);
    return { ok: true };
  }

  emitToTrip(event: TripEvent) {
    this.server?.to(`trip:${event.tripId}`).emit("trip.event", event);
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  /** Removed members must stop receiving a trip's events immediately. */
  async kickFromTrip(tripId: string, userId: string) {
    if (!this.server) return;
    const sockets = await this.server.in(`user:${userId}`).fetchSockets();
    for (const s of sockets) s.leave(`trip:${tripId}`);
    this.log.debug(`removed ${sockets.length} socket(s) from trip room`);
  }
}

@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  trip(tripId: string, actorId: string, event: TripEventName, entityId?: string) {
    this.gateway.emitToTrip({ tripId, actorId, event, entityId });
  }

  notification(userId: string, n: NotificationView) {
    this.gateway.emitToUser(userId, "notification.new", n);
  }

  kick(tripId: string, userId: string) {
    return this.gateway.kickFromTrip(tripId, userId);
  }
}

@Global()
@Module({ providers: [RealtimeGateway, RealtimeService], exports: [RealtimeService] })
export class RealtimeModule {}
