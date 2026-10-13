import { isLocale } from "@triply/shared";
import { requestLocale } from "../../common/locale";
import { mails } from "../mail/templates";
import { Injectable } from "@nestjs/common";
import type { CreatedInvitation, CreateInvitationInput, InvitationLookup, MemberDatesInput, MemberView, TripRole } from "@triply/shared";
import { randomToken, sha256 } from "../../common/crypto";
import { AppError, Errors } from "../../common/http";
import { mediaUrl, toUserSummary, userSummarySelect } from "../../common/presenters";
import { fromDate, toDate } from "../../common/dates";
import { TripEventsService } from "../activity/trip-events";
import { env } from "../../config/env";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit";
import { MailService } from "../mail/mail";
import { NotificationsService } from "../notifications/notifications";
import { RealtimeService } from "../realtime/realtime";
import { TripAccessService } from "../trips/trip-access.service";

const INVITE_TTL_MS = 7 * 86_400_000;
type InvRole = Exclude<TripRole, "OWNER">;

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TripAccessService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly events: TripEventsService,
  ) {}

  async members(tripId: string, viewerId: string): Promise<MemberView[]> {
    const trip = await this.access.require("members.view", tripId, viewerId);
    if (!trip.members.some((m) => m.userId === viewerId)) throw Errors.forbidden("Only trip members can see who's on this trip.");
    const rows = await this.prisma.tripMember.findMany({ where: { tripId }, include: { user: { select: userSummarySelect } }, orderBy: { joinedAt: "asc" } });
    const order = { OWNER: 0, EDITOR: 1, VIEWER: 2 } as const;
    return rows
      .sort((a, b) => order[a.role] - order[b.role])
      .map((m) => ({ user: toUserSummary(m.user), role: m.role, joinedAt: m.joinedAt.toISOString(), arriveOn: fromDate(m.arriveOn), leaveOn: fromDate(m.leaveOn) }));
  }

  /**
   * PATCH /trips/:id/members/:userId/dates — the part of the trip a member is there for. Members set
   * their own; the owner can set anyone's (they often plan for the group). Dates may fall outside
   * the trip's range (someone arriving early); the planner only uses them to show who's there.
   */
  async setDates(tripId: string, userId: string, viewerId: string, input: MemberDatesInput): Promise<MemberView> {
    const trip = await this.access.require("members.view", tripId, viewerId);
    if (!trip.members.some((m) => m.userId === viewerId)) throw Errors.forbidden("Only trip members can see who's on this trip.");
    if (userId !== viewerId && trip.ownerId !== viewerId) throw new AppError(403, "Only the trip owner can change other members' dates.");
    if (!trip.members.some((m) => m.userId === userId)) throw Errors.notFound("That member");
    const m = await this.prisma.transaction(async (tx) => {
      const row = await tx.tripMember.update({
        where: { tripId_userId: { tripId, userId } },
        data: { arriveOn: toDate(input.arriveOn), leaveOn: toDate(input.leaveOn) },
        include: { user: { select: userSummarySelect } },
      });
      await this.events.log({ tripId, actorId: viewerId, type: "member.dates", payload: { member: userId, arriveOn: input.arriveOn, leaveOn: input.leaveOn } }, tx);
      return row;
    });
    this.realtime.trip(tripId, viewerId, "trip.member.updated", userId);
    return { user: toUserSummary(m.user), role: m.role, joinedAt: m.joinedAt.toISOString(), arriveOn: fromDate(m.arriveOn), leaveOn: fromDate(m.leaveOn) };
  }

  // ── Invitations ────────────────────────────────────────────────────────
  async invite(tripId: string, viewerId: string, input: CreateInvitationInput): Promise<CreatedInvitation> {
    const trip = await this.access.require("members.invite", tripId, viewerId);
    if (input.email) {
      const existingUser = await this.prisma.user.findFirst({ where: { email: input.email, deletedAt: null }, select: { id: true } });
      if (existingUser && trip.members.some((m) => m.userId === existingUser.id)) throw Errors.conflict("That person is already on this trip.");
      const pending = await this.prisma.tripInvitation.findFirst({ where: { tripId, email: input.email, revokedAt: null, acceptedAt: null, expiresAt: { gt: new Date() } } });
      if (pending) throw Errors.conflict("That person already has a pending invite.");
    }
    const token = randomToken();
    const url = `${env.WEB_ORIGIN}/invite/${token}`;
    const inv = await this.prisma.transaction(async (tx) => {
      const created = await tx.tripInvitation.create({
        data: { tripId, email: input.email ?? null, role: input.role, tokenHash: sha256(token), invitedBy: viewerId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
        include: { inviter: { select: userSummarySelect } },
      });
      await this.audit.log(viewerId, "trip.invitation.created", "trip", tripId, { invitationId: created.id, role: input.role, kind: input.email ? "email" : "link" }, tx);
      if (input.email) {
        // Only notify an account that has proven it owns the address.
        const invitee = await tx.user.findFirst({ where: { email: input.email, deletedAt: null, emailVerifiedAt: { not: null } }, select: { id: true } });
        if (invitee)
          await this.notifications.notify([invitee.id], viewerId, "TRIP_INVITE", { k: "invited", role: input.role, trip: trip.title }, { tripId, invitationId: created.id }, tx);
      }
      return created;
    });
    if (input.email) {
      const inviter = toUserSummary(inv.inviter);
      // Written in the invitee's language when they already have an account, else in the inviter's.
      const invitee = await this.prisma.user.findFirst({ where: { email: input.email, deletedAt: null }, select: { profile: { select: { locale: true } } } });
      const locale = isLocale(invitee?.profile?.locale) ? invitee.profile.locale : requestLocale();
      await this.mail.send({ to: input.email, ...mails.invitation(locale, { inviter: inviter.displayName, trip: trip.title, role: input.role, url }) });
    }
    return {
      id: inv.id,
      email: inv.email,
      role: inv.role as InvRole,
      expiresAt: inv.expiresAt.toISOString(),
      createdAt: inv.createdAt.toISOString(),
      invitedBy: toUserSummary(inv.inviter),
      token,
      url,
    };
  }

  async revoke(tripId: string, invitationId: string, viewerId: string) {
    await this.access.require("members.invite", tripId, viewerId);
    const r = await this.prisma.tripInvitation.updateMany({ where: { id: invitationId, tripId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw Errors.notFound("That invitation");
    await this.audit.log(viewerId, "trip.invitation.revoked", "trip", tripId, { invitationId });
    return { ok: true };
  }

  private async findInvitation(by: { token: string } | { id: string }) {
    return this.prisma.tripInvitation.findFirst({
      // By id (from an in-app notification) only works for email invitations: a link invitation
      // must always be opened with its secret token.
      where: "token" in by ? { tokenHash: sha256(by.token) } : { id: by.id, email: { not: null } },
      include: {
        inviter: { select: userSummarySelect },
        trip: {
          include: {
            destinations: { orderBy: { position: "asc" }, include: { destination: { select: { name: true } } } },
            cover: { select: { storageKey: true } },
            members: { include: { user: { select: userSummarySelect } } },
          },
        },
      },
    });
  }

  private statusOf(inv: { revokedAt: Date | null; acceptedAt: Date | null; expiresAt: Date; email: string | null; trip: { deletedAt: Date | null } }) {
    if (inv.revokedAt || inv.trip.deletedAt) return "revoked" as const;
    if (inv.acceptedAt && inv.email) return "accepted" as const;
    if (inv.expiresAt < new Date()) return "expired" as const;
    return "valid" as const;
  }

  /** The invite holder sees just enough to decide — title, route, dates, who's going. */
  async lookup(by: { token: string } | { id: string }, viewerId: string | null): Promise<InvitationLookup> {
    const inv = await this.findInvitation(by);
    if (!inv) return { status: "invalid" };
    if ("id" in by) await this.assertInvitee(inv, viewerId);
    const status = this.statusOf(inv);
    if (status !== "valid" && status !== "accepted") return { status };
    const t = inv.trip;
    return {
      status,
      role: inv.role as InvRole,
      invitedBy: toUserSummary(inv.inviter),
      alreadyMember: !!viewerId && t.members.some((m) => m.userId === viewerId),
      trip: {
        id: t.id,
        title: t.title,
        cover: [t.coverA, t.coverB],
        coverUrl: mediaUrl(t.cover?.storageKey),
        route: t.destinations.map((d) => d.destination.name).join(" → "),
        startDate: fromDate(t.startDate),
        endDate: fromDate(t.endDate),
        members: t.members.map((m) => toUserSummary(m.user)),
      },
    };
  }

  /** Email invitations are bound to that email address. */
  private async assertInvitee(inv: { email: string | null }, viewerId: string | null) {
    if (!inv.email) return;
    if (!viewerId) throw Errors.unauthorized();
    const me = await this.prisma.user.findUnique({ where: { id: viewerId }, select: { email: true, emailVerifiedAt: true } });
    if (me?.email !== inv.email) throw new AppError(403, "This invitation was sent to a different email address. Log in with that account to accept it.");
    // Anyone can register any address; only a confirmed owner may claim an invitation sent to it.
    if (!me.emailVerifiedAt) throw new AppError(403, "Confirm your email address first — we sent you a link when you signed up. Then open this invitation again.");
  }

  async accept(by: { token: string } | { id: string }, viewerId: string): Promise<{ tripId: string }> {
    const inv = await this.findInvitation(by);
    if (!inv) throw Errors.notFound("That invitation");
    const status = this.statusOf(inv);
    if (status === "expired") throw Errors.invalid("This invitation has expired.");
    if (status === "revoked") throw Errors.invalid("This invitation was cancelled by the trip owner.");
    if (status === "accepted") throw Errors.invalid("This invitation has already been used.");
    await this.assertInvitee(inv, viewerId);

    const joined = await this.prisma.transaction(async (tx) => {
      const existing = await tx.tripMember.findUnique({ where: { tripId_userId: { tripId: inv.tripId, userId: viewerId } } });
      if (!existing) {
        await tx.tripMember.create({ data: { tripId: inv.tripId, userId: viewerId, role: inv.role } });
        await this.audit.log(viewerId, "trip.member.joined", "trip", inv.tripId, { invitationId: inv.id, role: inv.role }, tx);
        await this.notifications.notify([inv.trip.ownerId], viewerId, "TRIP_INVITE", { k: "joined", role: inv.role as "EDITOR" | "VIEWER", trip: inv.trip.title }, { tripId: inv.tripId }, tx);
      }
      // Email invites are single-use; link invites stay valid until they expire or are revoked.
      if (inv.email) await tx.tripInvitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
      await tx.notification.updateMany({ where: { invitationId: inv.id, userId: viewerId, readAt: null }, data: { readAt: new Date() } });
      return !existing;
    });
    if (joined) this.realtime.trip(inv.tripId, viewerId, "trip.member.joined", viewerId);
    return { tripId: inv.tripId };
  }

  async reject(by: { token: string } | { id: string }, viewerId: string) {
    const inv = await this.findInvitation(by);
    if (!inv) return { ok: true };
    await this.assertInvitee(inv, viewerId);
    if (inv.email) await this.prisma.tripInvitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
    await this.prisma.notification.updateMany({ where: { invitationId: inv.id, userId: viewerId }, data: { readAt: new Date() } });
    return { ok: true };
  }

  // ── Roles ──────────────────────────────────────────────────────────────
  async changeRole(tripId: string, userId: string, viewerId: string, role: InvRole): Promise<MemberView[]> {
    const trip = await this.access.require("members.change_role", tripId, viewerId);
    if (userId === trip.ownerId) throw Errors.invalid("The owner's role can't be changed.");
    const m = trip.members.find((x) => x.userId === userId);
    if (!m) throw Errors.notFound("That member");
    if (m.role !== role) {
      await this.prisma.transaction(async (tx) => {
        await tx.tripMember.update({ where: { tripId_userId: { tripId, userId } }, data: { role } });
        await this.audit.log(viewerId, "trip.member.role_changed", "trip", tripId, { userId, from: m.role, to: role }, tx);
        await this.notifications.notify([userId], viewerId, "TRIP_MEMBER_ROLE_CHANGED", { k: "role_changed", role, trip: trip.title }, { tripId }, tx);
      });
      this.realtime.trip(tripId, viewerId, "trip.member.role_changed", userId);
    }
    return this.members(tripId, viewerId);
  }

  /** Owner removes someone, or a member leaves on their own. The owner can't be removed. */
  async remove(tripId: string, userId: string, viewerId: string) {
    const trip = await this.access.load(tripId);
    const leaving = userId === viewerId;
    if (!leaving) this.access.assert("members.remove", trip, viewerId);
    if (userId === trip.ownerId) throw Errors.invalid(leaving ? "Owners can't leave their own trip — delete it instead." : "The owner can't be removed.");
    if (!trip.members.some((m) => m.userId === userId)) throw Errors.notFound("That member");
    await this.prisma.transaction(async (tx) => {
      await tx.tripMember.delete({ where: { tripId_userId: { tripId, userId } } });
      await this.audit.log(viewerId, leaving ? "trip.member.left" : "trip.member.removed", "trip", tripId, { userId }, tx);
    });
    await this.realtime.kick(tripId, userId);
    this.realtime.trip(tripId, viewerId, "trip.member.removed", userId);
    return { ok: true };
  }
}
