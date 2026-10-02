/** Dates are stored as Postgres DATE and exchanged as YYYY-MM-DD strings. */
export function toDate(iso: string): Date;
export function toDate(iso: string | null | undefined): Date | null;
export function toDate(iso: string | null | undefined) {
  return iso ? new Date(`${iso}T00:00:00.000Z`) : null;
}

export function fromDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayCount(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
}

export const MAX_TRIP_DAYS = 60;
