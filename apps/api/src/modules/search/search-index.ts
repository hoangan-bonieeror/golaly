import { Global, Injectable, Logger, Module, OnApplicationBootstrap } from "@nestjs/common";
import { normalizeSearch } from "@triply/shared";
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

  async trip(tripId: string, tx: Tx = this.prisma) {
    const t = await tx.trip.findUnique({ where: { id: tripId }, select: { title: true, description: true, destinations: { select: { destination: { select: { name: true, country: true } } } } } });
    if (t) await tx.trip.update({ where: { id: tripId }, data: { searchText: SearchIndexService.tripText(t) } });
  }

  async profile(userId: string, tx: Tx = this.prisma) {
    const p = await tx.userProfile.findUnique({ where: { userId }, select: { displayName: true, homeBase: true, user: { select: { username: true } } } });
    if (p) await tx.userProfile.update({ where: { userId }, data: { searchText: normalizeSearch(`${p.displayName} ${p.user.username} ${p.homeBase ?? ""}`) } });
  }

  async onApplicationBootstrap() {
    try {
      const n = await this.backfill();
      if (n) this.log.log(`Indexed ${n} rows for search`);
    } catch (e) {
      this.log.warn(`Search backfill skipped: ${(e as Error).message}`);
    }
  }

  /** Fills empty search_text columns. Safe to run repeatedly. */
  async backfill() {
    let n = 0;
    const dests = await this.prisma.destination.findMany({ where: { searchText: "" } });
    for (const d of dests) {
      await this.prisma.destination.update({ where: { id: d.id }, data: { searchText: normalizeSearch(`${d.name} ${d.country}`) } });
      n++;
    }
    const places = await this.prisma.place.findMany({ where: { searchText: "" }, include: { destination: { select: { name: true, country: true } } } });
    for (const p of places) {
      await this.prisma.place.update({ where: { id: p.id }, data: { searchText: normalizeSearch(`${p.name} ${p.address} ${p.destination.name} ${p.destination.country}`) } });
      n++;
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
