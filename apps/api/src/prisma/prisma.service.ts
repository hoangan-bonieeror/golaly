import { Global, Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env";
import { PrismaClient } from "../generated/prisma/client";

/** Fuzzy word-match cut-off for search ("tokio" → "tokyo"); see search/ranker.ts. */
export const WORD_SIMILARITY_THRESHOLD = 0.4;
const WORK_MEM = "16MB";

export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

/** Side effects queued by code running inside `PrismaService.transaction()`. */
const pending = new AsyncLocalStorage<(() => void)[]>();

/**
 * Runs `fn` once the surrounding transaction has committed — or right away when there is none.
 * Used for realtime pushes: clients must never be told about a row they can't read yet, or about
 * one that was rolled back.
 */
export function afterCommit(fn: () => void) {
  const queue = pending.getStore();
  if (queue) queue.push(fn);
  else setImmediate(fn);
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: env.DATABASE_URL,
        // Per connection, so no database privileges are needed:
        // - fuzzy word matching uses the indexable operator `word <% text` (search/ranker.ts), whose cut-off is
        //   this setting (pg_trgm's default is 0.6);
        // - text searches build bitmaps of ~100k rows for common words; with the default 4 MB they go "lossy" and
        //   Postgres re-checks every row of every page (2–3× slower on a 2M-place catalog).
        options: `-c pg_trgm.word_similarity_threshold=${WORD_SIMILARITY_THRESHOLD} -c work_mem=${WORK_MEM}`,
      }),
    });
  }

  /** Interactive transaction whose `afterCommit` callbacks run only if it commits. */
  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const queue: (() => void)[] = [];
    const result = await pending.run(queue, () => this.$transaction((tx) => fn(tx)));
    for (const cb of queue) setImmediate(cb);
    return result;
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
