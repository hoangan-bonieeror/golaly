/** Counts, durations and relative times (pluralised in code). */
export const format = {
  justNow: "just now",
  minutesShort: (n: number) => `${n}m`,
  hoursShort: (n: number) => `${n}h`,
  daysShort: (n: number) => `${n}d`,
  minutes: (n: number) => `${n} min`,
  hoursMinutes: (h: number, m: number) => (m ? `${h} h ${m} min` : `${h} h`),
  days: (n: number) => (n === 1 ? "1 day" : `${n} days`),
  places: (n: number) => (n === 1 ? "1 place" : `${n} places`),
  stops: (n: number) => (n === 1 ? "1 stop" : `${n} stops`),
  travelers: (n: number) => (n === 1 ? "1 traveler" : `${n} travelers`),
  datesNotSet: "Dates not set",
  thousandSuffix: "k",
};
