/**
 * Flexible planning rules shared by the API and the web app (roadmap phases 0–1).
 *
 * A trip plan has three layers: anchors (items with a clock time — flights, bookings), a soft day
 * plan where every other item sits in a part of the day, and the place pool (items with no day yet).
 */
import type { ItemSlot, ItemStatus, VoteLevel } from "./types";

export const ITEM_SLOTS = ["MORNING", "AFTERNOON", "EVENING", "ANY"] as const satisfies readonly ItemSlot[];
export const ITEM_STATUSES = ["PLANNED", "VISITED", "SKIPPED"] as const satisfies readonly ItemStatus[];
export const VOTE_LEVELS = ["LOVE", "OK", "SKIP"] as const satisfies readonly VoteLevel[];

/** Order of the parts of a day; "any time" comes last. */
export const SLOT_RANK: Record<ItemSlot, number> = { MORNING: 0, AFTERNOON: 1, EVENING: 2, ANY: 3 };

/** The part of the day a clock time falls in: before 12:00 morning, before 17:00 afternoon, else evening. */
export function slotForTime(hhmm: string): Exclude<ItemSlot, "ANY"> {
  return hhmm < "12:00" ? "MORNING" : hhmm < "17:00" ? "AFTERNOON" : "EVENING";
}

interface Sortable {
  id: string;
  slot: ItemSlot;
  startTime: string | null;
  sortOrder: number;
}

/**
 * A day's items grouped by part of the day (stable); within a part, items with a time stay in
 * chronological order in the positions timed items occupy, untimed ones keep the place the user
 * gave them. Returns ids in their new order.
 */
export function orderBySlot<T extends Sortable>(items: T[]): string[] {
  const list = [...items].sort((a, b) => SLOT_RANK[a.slot] - SLOT_RANK[b.slot] || a.sortOrder - b.sortOrder);
  const out: string[] = [];
  for (const slot of ITEM_SLOTS) {
    const part = list.filter((i) => i.slot === slot);
    const timed = part.filter((i) => i.startTime).sort((a, b) => a.startTime!.localeCompare(b.startTime!) || a.sortOrder - b.sortOrder);
    let t = 0;
    for (const i of part) out.push((i.startTime ? timed[t++] : i).id);
  }
  return out;
}

/** How much the group wants an item: love +2, fine +1, skip −1 per member. */
export const VOTE_WEIGHT: Record<VoteLevel, number> = { LOVE: 2, OK: 1, SKIP: -1 };
export function groupScore(votes: { level: VoteLevel }[]): number {
  return votes.reduce((s, v) => s + VOTE_WEIGHT[v.level], 0);
}

/** Whether a member is on the trip on `date` (YYYY-MM-DD); unknown dates count as present. */
export function presentOn(m: { arriveOn: string | null; leaveOn: string | null }, date: string | null): boolean {
  if (!date) return true;
  return (!m.arriveOn || m.arriveOn <= date) && (!m.leaveOn || date <= m.leaveOn);
}

/** Great-circle distance in km. */
export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const s = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(s));
}

export interface AreaPoint {
  id: string;
  lat: number;
  lng: number;
  /** The place's district / city, used to name the area. */
  areaName?: string | null;
}
export interface AreaCluster {
  /** Stable key: the smallest member id. */
  key: string;
  ids: string[];
  center: { lat: number; lng: number };
  /** The most common area name among its places, or null. */
  label: string | null;
  /** Widest distance from the centre, km. */
  radiusKm: number;
}

/**
 * Groups places that are within `epsKm` of each other (chains count: A–B–C with each hop ≤ eps
 * is one area), largest first; areas with fewer than `minSize` places are left out. Meant for a
 * trip's pool (tens to a few hundred places), so a plain O(n²) pass is fine.
 */
export function clusterByArea(points: AreaPoint[], epsKm = 1.5, minSize = 2): AreaCluster[] {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) if (km(points[i], points[j]) <= epsKm) parent[find(i)] = find(j);
  const groups = new Map<number, AreaPoint[]>();
  points.forEach((p, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), p]));
  return [...groups.values()]
    .filter((g) => g.length >= minSize)
    .map((g) => {
      const center = { lat: g.reduce((s, p) => s + p.lat, 0) / g.length, lng: g.reduce((s, p) => s + p.lng, 0) / g.length };
      const names = new Map<string, number>();
      g.forEach((p) => p.areaName && names.set(p.areaName, (names.get(p.areaName) ?? 0) + 1));
      const label = [...names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
      const ids = g.map((p) => p.id).sort();
      return { key: ids[0], ids, center, label, radiusKm: Math.max(...g.map((p) => km(center, p))) };
    })
    .sort((a, b) => b.ids.length - a.ids.length || a.key.localeCompare(b.key));
}
