import { AppError } from "../../common/http";
import type { PrismaService } from "../../prisma/prisma.service";
import type { AuditService } from "../audit/audit";

/** Per-account brute-force protection: every LOCK_AFTER consecutive failures lock the account for LOCK_MS. */
export const LOCK_AFTER = 5;
export const LOCK_MS = 15 * 60_000;

/**
 * Past this many consecutive failures even a known device is held back (someone holding a stolen device
 * cookie mustn't get unlimited guesses).
 */
export const HARD_LOCK_AFTER = 20;

/** Throws 429 while the account is locked (the same message wherever a password is checked). */
export function assertNotLocked(lockedUntil: Date | null | undefined) {
  if (!lockedUntil || lockedUntil <= new Date()) return;
  lockedMessage(lockedUntil);
}

/**
 * At sign-in: a lockout stops strangers, not the owner. A browser that has signed in to this account before
 * (a valid device token) may still try — so guessing someone's password can no longer keep them out — up to
 * HARD_LOCK_AFTER failures in a row.
 */
export function assertMayTry(user: { lockedUntil: Date | null; failedLoginCount: number }, knownDevice: boolean) {
  if (!user.lockedUntil || user.lockedUntil <= new Date()) return;
  if (knownDevice && user.failedLoginCount < HARD_LOCK_AFTER) return;
  lockedMessage(user.lockedUntil);
}

function lockedMessage(lockedUntil: Date): never {
  const mins = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000));
  throw new AppError(429, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}, or reset your password.`);
}

/**
 * The same lockout for addresses that have no account, so the answer to "is there an account for this e-mail?"
 * can't be read off whether the sixth wrong guess says "locked". Kept in memory (it only has to look the same to a
 * prober) and bounded: the oldest entries drop out first.
 */
export class PhantomLockouts {
  private readonly rows = new Map<string, { failures: number; lockedUntil: Date | null }>();
  constructor(private readonly max = 10_000) {}

  assertNotLocked(email: string) {
    assertNotLocked(this.rows.get(key(email))?.lockedUntil);
  }

  recordFailure(email: string) {
    const k = key(email);
    const row = this.rows.get(k) ?? { failures: 0, lockedUntil: null };
    this.rows.delete(k); // re-insert so the Map's order is least-recently-failed first
    row.failures += 1;
    if (row.failures % LOCK_AFTER === 0) row.lockedUntil = new Date(Date.now() + LOCK_MS);
    this.rows.set(k, row);
    while (this.rows.size > this.max) this.rows.delete(this.rows.keys().next().value!);
  }
}
const key = (email: string) => email.trim().toLowerCase();

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
