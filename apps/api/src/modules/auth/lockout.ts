import { AppError } from "../../common/http";
import type { PrismaService } from "../../prisma/prisma.service";
import type { AuditService } from "../audit/audit";

/** Per-account brute-force protection: every LOCK_AFTER consecutive failures lock the account for LOCK_MS. */
export const LOCK_AFTER = 5;
export const LOCK_MS = 15 * 60_000;

/** Throws 429 while the account is locked (the same message wherever a password is checked). */
export function assertNotLocked(lockedUntil: Date | null | undefined) {
  if (!lockedUntil || lockedUntil <= new Date()) return;
  const mins = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000));
  throw new AppError(429, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}, or reset your password.`);
}

/**
 * Counts a wrong password atomically (concurrent guesses can't slip past the threshold) — at sign-in, and when
 * someone already signed in re-enters it (change password, delete account), so a stolen session can't be used to
 * guess the real password. Returns true when this failure locked the account.
 */
export async function recordPasswordFailure(prisma: PrismaService, audit: AuditService, userId: string): Promise<boolean> {
  const { failedLoginCount } = await prisma.user.update({ where: { id: userId }, data: { failedLoginCount: { increment: 1 } }, select: { failedLoginCount: true } });
  if (failedLoginCount % LOCK_AFTER !== 0) return false;
  await prisma.user.update({ where: { id: userId }, data: { lockedUntil: new Date(Date.now() + LOCK_MS) } });
  await audit.log(null, "user.login_locked", "user", userId, { failures: failedLoginCount });
  return true;
}
