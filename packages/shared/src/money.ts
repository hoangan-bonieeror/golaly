/**
 * Splitting a trip's costs (roadmap phase 3). Amounts are integers of the currency's smallest unit
 * (₫ 1, ¥ 1, $0.01) so every split adds up exactly; the API and the web app share these rules.
 */
import type { ExpenseCategory } from "./types";

export const EXPENSE_CATEGORIES = ["FOOD", "LODGING", "TRANSPORT", "ACTIVITY", "SHOPPING", "OTHER"] as const satisfies readonly ExpenseCategory[];

/** Largest amount accepted, in minor units (well inside JavaScript's exact-integer range). */
export const MAX_AMOUNT = 10_000_000_000_000;

/** Decimal places of a currency's smallest unit: VND 0, JPY 0, USD 2, KWD 3. */
export function currencyDigits(code: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Whether `code` is an ISO 4217 currency the runtime knows. */
export function isCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return Intl.supportedValuesOf ? Intl.supportedValuesOf("currency").includes(code) : true;
  } catch {
    return false;
  }
}

/** "12.50" / "12,5" / "350 000" (as typed) → minor units, or null when it isn't a positive amount. */
export function parseAmount(text: string, digits: number): number | null {
  const t = text.replace(/[\s _']/g, "");
  if (!t) return null;
  // The last "," or "." followed by 1..digits figures is the decimal mark; other separators group thousands.
  const m = digits > 0 ? t.match(new RegExp(`^(.*?)[.,](\\d{1,${digits}})$`)) : null;
  const whole = (m ? m[1] : t).replace(/[.,]/g, "");
  const frac = m ? m[2] : "";
  if (!/^\d+$/.test(whole || "0") || !/^\d*$/.test(frac)) return null;
  const n = Number(whole || "0") * 10 ** digits + Number(frac.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_AMOUNT ? n : null;
}

/**
 * An amount shared equally: everyone gets the same, and the leftover smallest units (₫1, 1¢) go one
 * each to the first people in `userIds` — so the shares always add up to `amount`.
 */
export function splitEqually(amount: number, userIds: string[]): { userId: string; amount: number }[] {
  const n = userIds.length;
  if (!n) return [];
  const base = Math.floor(amount / n);
  let rest = amount - base * n;
  return userIds.map((userId) => ({ userId, amount: base + (rest-- > 0 ? 1 : 0) }));
}

export interface BalanceInput {
  expenses: { paidById: string; amount: number; shares: { userId: string; amount: number }[] }[];
  settlements: { fromId: string; toId: string; amount: number }[];
}

/** Per person: what they paid, what their share was, and the difference (+ = is owed money). */
export function balances({ expenses, settlements }: BalanceInput) {
  const m = new Map<string, { paid: number; owed: number; net: number }>();
  const row = (id: string) => m.get(id) ?? (m.set(id, { paid: 0, owed: 0, net: 0 }), m.get(id)!);
  for (const e of expenses) {
    row(e.paidById).paid += e.amount;
    row(e.paidById).net += e.amount;
    for (const s of e.shares) {
      row(s.userId).owed += s.amount;
      row(s.userId).net -= s.amount;
    }
  }
  // Paying someone back moves both towards zero.
  for (const s of settlements) {
    row(s.fromId).net += s.amount;
    row(s.toId).net -= s.amount;
  }
  return m;
}

/**
 * Who pays whom so everyone ends at zero: the biggest debtor pays the biggest creditor, repeatedly.
 * At most (people − 1) transfers, usually fewer; deterministic for equal amounts (by id).
 */
export function settleUp(net: Map<string, number> | Record<string, number>): { fromId: string; toId: string; amount: number }[] {
  const entries = net instanceof Map ? [...net.entries()] : Object.entries(net);
  const debt = entries.filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }));
  const cred = entries.filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }));
  const order = (a: { id: string; v: number }, b: { id: string; v: number }) => b.v - a.v || a.id.localeCompare(b.id);
  const out: { fromId: string; toId: string; amount: number }[] = [];
  while (debt.length && cred.length) {
    debt.sort(order);
    cred.sort(order);
    const d = debt[0];
    const c = cred[0];
    const amount = Math.min(d.v, c.v);
    out.push({ fromId: d.id, toId: c.id, amount });
    d.v -= amount;
    c.v -= amount;
    if (!d.v) debt.shift();
    if (!c.v) cred.shift();
  }
  return out;
}
