import { Global, Injectable, Logger, Module } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { can, type NotificationView, type TripEvent, type TripEventName, type TripPresence } from "@triply/shared";
import type { Server, Socket } from "socket.io";
import { ACCESS_COOKIE, verifyAccess } from "../../common/auth";
import { corsOrigins } from "../../config/env";
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
/**
 * Browsers send Origin on the WebSocket upgrade, but Socket.IO's `cors` only governs HTTP polling: check it here
 * too, or a sibling site could open a socket with this site's cookie (cross-site WebSocket hijacking). Clients
 * that send no Origin (tests, native apps) still have to authenticate.
 */
export const allowOrigin = (origin: string | undefined) => !origin || corsOrigins.includes(origin);

/** Per socket: at most EVENT_BURST events in EVENT_WINDOW_MS; far beyond that the socket is dropped. */
const EVENT_WINDOW_MS = 10_000;
const EVENT_BURST = 40;
const EVENT_DROP = 200;

/** Plan changes outsiders of a public trip may hear about; never who's online, members or money. */
const PUBLIC_EVENTS = new Set<TripEventName>(["trip.item.created", "trip.item.updated", "trip.item.deleted", "trip.item.reordered", "trip.item.voted", "trip.day.created", "trip.updated"]);
const membersRoom = (tripId: string) => `trip:${tripId}`;
const publicRoom = (tripId: string) => `trip:${tripId}:public`;

@WebSocketGateway({
  path: "/socket.io",
  cors: { origin: corsOrigins, credentials: true },
  allowRequest: (req, cb) => cb(null, allowOrigin(req.headers.origin)),
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayInit {
  @WebSocketServer() server: Server;
  private readonly log = new Logger("Realtime");

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Authenticate in a handshake middleware, not in handleConnection: middleware finishes before
   * the client sees "connect", so no event can arrive from a socket whose user isn't known yet.
   * A rejected handshake surfaces on the client as `connect_error` with message "unauthorized".
   *
   * Two ways in: the access cookie, when the socket shares a site with the API; or `auth.token` — a
   * one-minute socket token from POST /auth/socket-token (or an access token, for non-browser clients).
   * The token is what makes realtime work when the web app is on another domain than the API
   * (e.g. Vercel → Render): the browser won't send the API's cookie there, and Vercel's rewrites
   * don't carry WebSockets, but the token request does go through the rewrite with the cookie.
   */
  afterInit(server: Server) {
    server.use((socket, next) => {
      const cookie = parseCookies(socket.handshake.headers.cookie)[ACCESS_COOKIE];
      const handed = socket.handshake.auth?.token;
      // An expired cookie can come with a fresh token (same-site setups that also send one): try both.
      verifyAccess(this.jwt, this.prisma, cookie)
        .then((user) => user ?? verifyAccess(this.jwt, this.prisma, typeof handed === "string" ? handed : null, ["access", "socket"]))
        .then((user) => {
          if (!user) return next(new Error("unauthorized"));
          socket.data.userId = user.id;
          socket.data.sessionId = user.sessionId;
          next();
        })
        .catch(() => next(new Error("unauthorized")));
    });
  }

  async handleConnection(socket: Socket) {
    socket.data.activity = {} as Record<string, number | null>;
    // Closing the tab (or losing the connection) drops the user from every trip's presence list.
    // "disconnecting" still sees the rooms; they're left right after, so recount on the next tick.
    socket.on("disconnecting", () => {
      const trips = [...socket.rooms].filter((r) => r.startsWith("trip:") && !r.endsWith(":public")).map((r) => r.slice(5));
      if (trips.length) setImmediate(() => trips.forEach((id) => void this.broadcastPresence(id)));
    });
    await socket.join([`user:${socket.data.userId}`, `session:${socket.data.sessionId}`]);
  }

  /**
   * Fixed-window budget per socket: past the burst an event is refused; a client far past it (a script, not a
   * person) is disconnected. Every handler checks it first, before touching the database.
   */
  private allow(socket: Socket): boolean {
    const now = Date.now();
    const b = (socket.data.budget ??= { start: now, n: 0 }) as { start: number; n: number };
    if (now - b.start > EVENT_WINDOW_MS) {
      b.start = now;
      b.n = 0;
    }
    b.n++;
    if (b.n > EVENT_DROP) {
      socket.disconnect(true);
      return false;
    }
    return b.n <= EVENT_BURST;
  }

  /**
   * Members join the trip's room (events, presence, money); anyone else allowed to view a public or link-only
   * trip joins its public room: plan changes only, without who made them, and they don't appear in presence.
   */
  @SubscribeMessage("trip.join")
  async joinTrip(@ConnectedSocket() socket: Socket, @MessageBody() body: { tripId?: string }) {
    if (!this.allow(socket)) return { ok: false, error: "rate_limited" };
    const userId = socket.data.userId as string | undefined;
    const tripId = typeof body?.tripId === "string" ? body.tripId : "";
    if (!userId || !/^[0-9a-f-]{36}$/i.test(tripId)) return { ok: false };
    const trip = await this.prisma.trip.findFirst({ where: { id: tripId, deletedAt: null }, include: { members: true } });
    if (!trip || !can("trip.view", { trip, members: trip.members, userId })) return { ok: false };
    // At most 20 trips watched at once per connection.
    if ([...socket.rooms].filter((r) => r.startsWith("trip:")).length >= 20) return { ok: false, error: "too_many_trips" };
    const member = trip.members.some((m) => m.userId === userId);
    await socket.join(member ? membersRoom(tripId) : publicRoom(tripId));
    if (member) await this.broadcastPresence(tripId);
    return { ok: true, member };
  }

  @SubscribeMessage("trip.leave")
  async leaveTrip(@ConnectedSocket() socket: Socket, @MessageBody() body: { tripId?: string }) {
    if (!this.allow(socket)) return { ok: false, error: "rate_limited" };
    if (typeof body?.tripId !== "string") return { ok: true };
    await socket.leave(publicRoom(body.tripId));
    const room = membersRoom(body.tripId);
    if (!socket.rooms.has(room)) return { ok: true };
    await socket.leave(room);
    delete socket.data.activity?.[body.tripId];
    await this.broadcastPresence(body.tripId);
    return { ok: true };
  }

  /**
   * "Minh is editing Day 2": a member reports which day they have an editor open on (null when
   * they close it). Only sockets already in the trip room — i.e. allowed to view it — may report.
   */
  @SubscribeMessage("trip.activity")
  async activity(@ConnectedSocket() socket: Socket, @MessageBody() body: { tripId?: string; editingDay?: number | null }) {
    if (!this.allow(socket)) return { ok: false, error: "rate_limited" };
    const tripId = typeof body?.tripId === "string" ? body.tripId : "";
    if (!socket.rooms.has(`trip:${tripId}`)) return { ok: false };
    const day = body.editingDay;
    if (day !== null && day !== undefined && !(Number.isInteger(day) && day >= 1 && day <= 366)) return { ok: false };
    const activity = (socket.data.activity ??= {}) as Record<string, number | null>;
    if (activity[tripId] === (day ?? null)) return { ok: true };
    activity[tripId] = day ?? null;
    this.presenceSoon(tripId);
    return { ok: true };
  }

  /** Coalesces bursts of activity reports into one presence broadcast per trip. */
  private pendingPresence = new Map<string, NodeJS.Timeout>();
  private presenceSoon(tripId: string) {
    if (this.pendingPresence.has(tripId)) return;
    this.pendingPresence.set(
      tripId,
      setTimeout(() => {
        this.pendingPresence.delete(tripId);
        void this.broadcastPresence(tripId);
      }, 150),
    );
  }

  /** One entry per user (several tabs collapse into one); a day being edited in any tab wins. */
  async broadcastPresence(tripId: string) {
    if (!this.server) return;
    const users = new Map<string, number | null>();
    for (const s of await this.server.in(membersRoom(tripId)).fetchSockets()) {
      const id = s.data.userId as string;
      const day = (s.data.activity as Record<string, number | null> | undefined)?.[tripId] ?? null;
      if (!users.has(id) || (users.get(id) === null && day !== null)) users.set(id, day);
    }
    const payload: TripPresence = { tripId, users: [...users].map(([userId, editingDay]) => ({ userId, editingDay })) };
    this.server.to(membersRoom(tripId)).emit("trip.presence", payload);
  }

  /** Catalog admin screens: live sync-run updates. Role is re-checked against the database. */
  @SubscribeMessage("admin.join")
  async joinAdmin(@ConnectedSocket() socket: Socket) {
    if (!this.allow(socket)) return { ok: false, error: "rate_limited" };
    const userId = socket.data.userId as string | undefined;
    if (!userId) return { ok: false };
    const ok = await this.prisma.user.count({ where: { id: userId, role: "ADMIN", deletedAt: null } });
    if (!ok) return { ok: false };
    await socket.join("admin");
    return { ok: true };
  }

  emitToAdmins(event: string, payload: unknown) {
    this.server?.to("admin").emit(event, payload);
  }

  emitToTrip(event: TripEvent) {
    this.server?.to(membersRoom(event.tripId)).emit("trip.event", event);
    // Outsiders: plan changes only, and not who made them.
    if (PUBLIC_EVENTS.has(event.event)) this.server?.to(publicRoom(event.tripId)).emit("trip.event", { ...event, actorId: "" });
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  /** Removed members must stop receiving a trip's events immediately. */
  async kickFromTrip(tripId: string, userId: string) {
    if (!this.server) return;
    const sockets = await this.server.in(`user:${userId}`).fetchSockets();
    for (const s of sockets) s.leave(membersRoom(tripId));
    this.log.debug(`removed ${sockets.length} socket(s) from trip room`);
    await this.broadcastPresence(tripId);
  }

  /** A trip turned private: everyone who isn't a member leaves its room right away. */
  async evictNonMembers(tripId: string, memberIds: string[]) {
    if (!this.server) return;
    const keep = new Set(memberIds);
    this.server.in(publicRoom(tripId)).socketsLeave(publicRoom(tripId));
    for (const s of await this.server.in(membersRoom(tripId)).fetchSockets()) if (!keep.has(s.data.userId)) s.leave(membersRoom(tripId));
    await this.broadcastPresence(tripId);
  }

  /** Revoked sessions lose their live connection immediately (logout, password change/reset, account deletion). */
  async disconnectSessions(opts: { sessionIds?: string[]; userId?: string; exceptSessionId?: string }) {
    if (!this.server) return;
    const rooms = opts.userId ? [`user:${opts.userId}`] : (opts.sessionIds ?? []).map((id) => `session:${id}`);
    if (!rooms.length) return;
    for (const s of await this.server.in(rooms).fetchSockets()) {
      if (opts.exceptSessionId && s.data.sessionId === opts.exceptSessionId) continue;
      s.emit("auth.error", { message: "You've been signed out." });
      s.disconnect(true);
    }
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

  evictNonMembers(tripId: string, memberIds: string[]) {
    return this.gateway.evictNonMembers(tripId, memberIds);
  }

  disconnectSessions(opts: { sessionIds?: string[]; userId?: string; exceptSessionId?: string }) {
    return this.gateway.disconnectSessions(opts);
  }

  admins(event: string, payload: unknown) {
    this.gateway.emitToAdmins(event, payload);
  }
}

@Global()
@Module({ providers: [RealtimeGateway, RealtimeService], exports: [RealtimeService] })
export class RealtimeModule {}
