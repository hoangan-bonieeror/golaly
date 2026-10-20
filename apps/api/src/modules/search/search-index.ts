import { Global, Injectable, Logger, Module, OnApplicationBootstrap } from "@nestjs/common";
import { accentSearch, normalizeSearch, splitAreaName } from "@golaly/shared";
import { env } from "../../config/env";
import { PrismaService, type Tx } from "../../prisma/prisma.service";

/**
 * Maintains the denormalised, accent-free `search_text` columns that power fuzzy search
 * (pg_trgm GIN indexes). Writers call `trip()/profile()` after changes; on boot, any rows
 * with an empty `search_text` (e.g. after the P1 migration) are back-filled.
 */
@Injectable()
export class SearchIndexService implements OnApplicationBootstrap {
  private readonly log = new Logger("SearchIndex");

  constructor(private readonly prisma: PrismaService) {}

  static tripText(t: { title: string; description: string; destinations: { destination: { name: string; country: string } }[] }) {
    return normalizeSearch([t.title, t.description, ...t.destinations.flatMap((d) => [d.destination.name, d.destination.country])].join(" ")).slice(0, 4000);
  }

  /**
   * Same parts and order as the catalog pipeline (publish.refresh_names_and_search), minus imported names. `nameNorm`
   * drives the name tiers of the ranking (an exact or prefix match on the name beats a match elsewhere in the text).
   */
  static placeText(p: { name: string; address: string; destination: { name: string; country: string } | null; area: { name: string } | null }) {
    const text = [p.name, p.address, p.destination?.name ?? "", p.destination?.country ?? "", p.area ? splitAreaName(p.area.name).short : ""].join(" ");
    return { nameNorm: normalizeSearch(p.name), searchText: normalizeSearch(text).slice(0, 4000), searchAccent: accentSearch(text).slice(0, 4000) };
  }

  async trip(tripId: string, tx: Tx = this.prisma) {
    const t = await tx.trip.findUnique({ where: { id: tripId }, select: { title: true, description: true, destinations: { select: { destination: { select: { name: true, country: true } } } } } });
    if (t) await tx.trip.update({ where: { id: tripId }, data: { searchText: SearchIndexService.tripText(t) } });
  }

  async profile(userId: string, tx: Tx = this.prisma) {
    const p = await tx.userProfile.findUnique({ where: { userId }, select: { displayName: true, homeBase: true, user: { select: { username: true } } } });
    if (p) await tx.userProfile.update({ where: { userId }, data: { searchText: normalizeSearch(`${p.displayName} ${p.user.username} ${p.homeBase ?? ""}`) } });
  }

  async onApplicationBootstrap() {
    // Nest awaits this hook before `listen()`, so a slow or lock-blocked database (a migration queued behind a long
    // transaction) would keep the port closed. Outside tests, index in the background and serve meanwhile.
    const run = this.backfill().then(
      (n) => n && this.log.log(`Indexed ${n} rows for search`),
      (e) => this.log.warn(`Search backfill skipped: ${(e as Error).message}`),
    );
    if (env.NODE_ENV === "test") await run;
  }

  /** Fills empty search columns (and places' name_norm). Safe to run repeatedly. */
  async backfill() {
    let n = 0;
    const dests = await this.prisma.destination.findMany({ where: { searchText: "" } });
    for (const d of dests) {
      await this.prisma.destination.update({ where: { id: d.id }, data: { searchText: normalizeSearch(`${d.name} ${d.country}`) } });
      n++;
    }
    // Literal '' (not a parameter) so the planner can use places_search_unfilled_idx and the name_norm index: without
    // them this read the whole catalog on every start. In batches, so a large backfill (after a big import) doesn't
    // load everything at once. Places created outside the catalog pipeline (seed, demo) may arrive without name_norm.
    const seen = new Set<string>(); // a place with no text at all stays empty: don't loop on it
    for (;;) {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM places WHERE search_text = '' OR search_accent = '' OR (name_norm = '' AND name <> '') LIMIT ${500 + seen.size}`;
      const ids = rows.map((r) => r.id).filter((id) => !seen.has(id));
      if (!ids.length) break;
      ids.forEach((id) => seen.add(id));
      const places = await this.prisma.place.findMany({
        where: { id: { in: ids } },
        include: { destination: { select: { name: true, country: true } }, area: { select: { name: true } } },
      });
      for (const p of places) {
        await this.prisma.place.update({ where: { id: p.id }, data: SearchIndexService.placeText(p) });
        n++;
      }
    }
    const trips = await this.prisma.trip.findMany({ where: { searchText: "" }, select: { id: true, updatedAt: true, title: true, description: true, destinations: { select: { destination: { select: { name: true, country: true } } } } } });
    for (const t of trips) {
      // Keep updatedAt unchanged — indexing isn't an edit.
      await this.prisma.trip.update({ where: { id: t.id }, data: { searchText: SearchIndexService.tripText(t), updatedAt: t.updatedAt } });
      n++;
    }
    const profiles = await this.prisma.userProfile.findMany({ where: { searchText: "" }, select: { userId: true } });
    for (const p of profiles) {
      await this.profile(p.userId);
      n++;
    }
    return n;
  }
}

@Global()
@Module({ providers: [SearchIndexService], exports: [SearchIndexService] })
export class SearchIndexModule {}
