import { Injectable } from "@nestjs/common";
import type { Me, PostView, ProfileView, TripSummary, UpdateProfileInput } from "@triply/shared";
import { verifyPassword } from "../../common/crypto";
import { AppError, Errors } from "../../common/http";
import {
  mediaUrl,
  postInclude,
  toPostView,
  toTripSummary,
  toUserSummary,
  tripSummaryInclude,
  userSummarySelect,
} from "../../common/presenters";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit";
import { NotificationsService } from "../notifications/notifications";

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async me(userId: string): Promise<Me> {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { profile: { include: { avatar: { select: { storageKey: true, thumbKey: true } } } } },
    });
    if (!u) throw Errors.unauthorized();
    return {
      id: u.id,
      username: u.username,
      email: u.email,
      displayName: u.profile?.displayName ?? u.username,
      avatarHue: u.profile?.avatarHue ?? 180,
      avatarUrl: mediaUrl(u.profile?.avatar?.thumbKey ?? u.profile?.avatar?.storageKey),
      bio: u.profile?.bio ?? "",
      homeBase: u.profile?.homeBase ?? null,
      travelerType: u.profile?.travelerType ?? null,
      interests: (u.profile?.interests ?? []) as Me["interests"],
      onboarded: !!u.profile?.onboardedAt,
    };
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<Me> {
    if (input.avatarMediaId) {
      const m = await this.prisma.media.findFirst({ where: { id: input.avatarMediaId, ownerId: userId } });
      if (!m) throw Errors.invalid("Upload the photo first.");
    }
    const onboarding = input.travelerType !== undefined || input.interests !== undefined;
    await this.prisma.userProfile.update({
      where: { userId },
      data: { ...input, ...(onboarding ? { onboardedAt: new Date() } : {}) },
    });
    return this.me(userId);
  }

  async findByHandle(handle: string) {
    const u = await this.prisma.user.findFirst({
      where: { deletedAt: null, ...(isUuid(handle) ? { id: handle } : { username: handle.toLowerCase() }) },
      select: { ...userSummarySelect, profile: { select: { displayName: true, avatarHue: true, bio: true, homeBase: true, avatar: { select: { storageKey: true, thumbKey: true } } } } },
    });
    if (!u) throw Errors.notFound("That traveler");
    return u;
  }

  async profile(handle: string, viewerId: string | null): Promise<ProfileView> {
    const u = await this.findByHandle(handle);
    const isMe = u.id === viewerId;
    const [followers, following, trips, followedByMe] = await Promise.all([
      this.prisma.follow.count({ where: { followingId: u.id } }),
      this.prisma.follow.count({ where: { followerId: u.id } }),
      this.prisma.trip.count({ where: { ownerId: u.id, deletedAt: null, ...(isMe ? {} : { visibility: "PUBLIC" }) } }),
      viewerId ? this.prisma.follow.count({ where: { followerId: viewerId, followingId: u.id } }).then(Boolean) : false,
    ]);
    return {
      user: { ...toUserSummary(u), bio: u.profile?.bio ?? "", homeBase: u.profile?.homeBase ?? null },
      followers,
      following,
      trips,
      followedByMe,
      isMe,
    };
  }

  /** Public profile never exposes private or link-only trips (spec §21, §34). */
  async trips(handle: string, viewerId: string | null): Promise<TripSummary[]> {
    const u = await this.findByHandle(handle);
    const isMe = u.id === viewerId;
    const rows = await this.prisma.trip.findMany({
      where: { ownerId: u.id, deletedAt: null, ...(isMe ? {} : { visibility: "PUBLIC" }) },
      orderBy: { updatedAt: "desc" },
      include: tripSummaryInclude(viewerId),
    });
    return rows.map((t) => toTripSummary(t, viewerId));
  }

  async posts(handle: string, viewerId: string | null): Promise<PostView[]> {
    const u = await this.findByHandle(handle);
    const isMe = u.id === viewerId;
    const follows = viewerId ? await this.prisma.follow.count({ where: { followerId: viewerId, followingId: u.id } }) : 0;
    const rows = await this.prisma.post.findMany({
      where: {
        userId: u.id,
        deletedAt: null,
        visibility: isMe ? undefined : { in: follows ? ["PUBLIC", "FOLLOWERS"] : ["PUBLIC"] },
      },
      orderBy: { createdAt: "desc" },
      include: postInclude(viewerId),
    });
    return rows.map((p) => toPostView(p, viewerId));
  }

  async follow(viewerId: string, handle: string, on: boolean) {
    const target = await this.findByHandle(handle);
    if (target.id === viewerId) throw Errors.invalid("You can't follow yourself.");
    if (on) {
      const existing = await this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: target.id } } });
      if (!existing) {
        await this.prisma.follow.create({ data: { followerId: viewerId, followingId: target.id } });
        await this.notifications.notify([target.id], viewerId, "FOLLOW", "started following you");
      }
    } else {
      await this.prisma.follow.deleteMany({ where: { followerId: viewerId, followingId: target.id } });
    }
    return this.profile(target.id, viewerId);
  }

  /**
   * Account deletion (spec §42): requires the password, revokes every session, removes
   * memberships, soft-deletes owned trips & posts, and anonymises the account row.
   */
  async deleteAccount(userId: string, password: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || u.deletedAt) throw Errors.unauthorized();
    if (!(await verifyPassword(u.passwordHash, password))) throw new AppError(403, "That password isn't right.");
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      await tx.tripMember.deleteMany({ where: { userId, role: { not: "OWNER" } } });
      await tx.trip.updateMany({ where: { ownerId: userId, deletedAt: null }, data: { deletedAt: now } });
      await tx.post.updateMany({ where: { userId, deletedAt: null }, data: { deletedAt: now } });
      await tx.postComment.updateMany({ where: { userId, deletedAt: null }, data: { deletedAt: now } });
      await tx.follow.deleteMany({ where: { OR: [{ followerId: userId }, { followingId: userId }] } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.user.update({
        where: { id: userId },
        data: { deletedAt: now, email: `deleted+${userId}@triply.invalid`, username: `deleted_${userId.slice(0, 8)}`, passwordHash: "!" },
      });
      await tx.userProfile.update({ where: { userId }, data: { displayName: "Deleted user", bio: "", homeBase: null, avatarMediaId: null } });
      await this.audit.log(userId, "user.deleted", "user", userId, {}, tx);
    });
  }
}
