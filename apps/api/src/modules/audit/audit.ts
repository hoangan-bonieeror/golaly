import { Global, Injectable, Module } from "@nestjs/common";
import { PrismaService, type Tx } from "../../prisma/prisma.service";

export type AuditAction =
  | "trip.member.role_changed"
  | "trip.member.removed"
  | "trip.member.left"
  | "trip.member.joined"
  | "trip.invitation.created"
  | "trip.invitation.revoked"
  | "trip.visibility_changed"
  | "trip.deleted"
  | "user.deleted"
  | "user.password_reset"
  | "user.password_changed"
  | "user.email_verified"
  | "user.google_linked"
  | "user.login_locked"
  | "session.reuse_detected"
  | "place_photo.approved"
  | "place_photo.hidden"
  | "place_photo.removed"
  | "catalog.job.created"
  | "catalog.job.updated"
  | "catalog.job.deleted"
  | "catalog.run.started"
  | "catalog.run.cancelled"
  | "catalog.run.resumed"
  | "catalog.merge.decided"
  | "catalog.merge.undone"
  | "catalog.place.edited"
  | "catalog.category_map.changed"
  | "admin.analytics.viewed";

/** Append-only log of sensitive permission changes (spec §42). Never stores tokens or passwords. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(actorId: string | null, action: AuditAction, entityType: "trip" | "user" | "invitation" | "place_photo" | "sync_job" | "sync_run" | "merge" | "place" | "category_map", entityId: string, meta: Record<string, unknown> = {}, tx: Tx = this.prisma) {
    return tx.auditLog.create({ data: { actorId, action, entityType, entityId, meta: meta as object } });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
