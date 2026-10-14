/**
 * Money on screen. The API sends whole minor units (đồng, cents, yen); the currency decides how many
 * decimals they have (`currencyDigits`), and Intl formats them in the interface language.
 */
import { currencyDigits } from "@triply/shared";

const tag = (locale: string) => (locale === "vi" ? "vi-VN" : "en-US");

export function formatMoney(minor: number, currency: string, locale: string, opts: { sign?: boolean } = {}) {
  const digits = currencyDigits(currency);
  const value = minor / 10 ** digits;
  try {
    return new Intl.NumberFormat(tag(locale), { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: opts.sign ? "exceptZero" : "auto" }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${currency}`;
  }
}

/** Minor units → what goes back into an amount field ("250000", "12.50"). */
export function amountInput(minor: number, currency: string) {
  const digits = currencyDigits(currency);
  return digits ? (minor / 10 ** digits).toFixed(digits) : String(minor);
}

/** The currency's name in the interface language ("Vietnamese dong", "Đồng Việt Nam"). */
export function currencyName(code: string, locale: string) {
  try {
    return new Intl.DisplayNames([tag(locale)], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Currencies offered first in the picker (the trip's own is always included). */
export const COMMON_CURRENCIES = ["VND", "USD", "EUR", "JPY", "KRW", "THB", "SGD", "GBP", "AUD", "CNY", "TWD", "HKD", "MYR", "IDR", "PHP", "CAD", "CHF", "INR"];
