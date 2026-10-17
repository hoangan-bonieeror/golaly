import { Global, Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env";
import { queryStarted } from "../common/timing";
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

/**
 * Times every statement the driver runs (also inside transactions) for the per-request Server-Timing header
 * (common/timing.ts). A Proxy, so the adapter's other members pass through untouched.
 */
function timedAdapter<T extends object>(factory: T): T {
  const time = <F extends (...a: never[]) => Promise<unknown>>(fn: F) =>
    (async (...args: Parameters<F>) => {
      const done = queryStarted();
      try {
        return await fn(...args);
      } finally {
        done();
      }
    }) as F;
  const queryable = <Q extends object>(target: Q): Q =>
    new Proxy(target, {
      get(obj, key) {
        const value = Reflect.get(obj, key, obj) as unknown;
        if (typeof value !== "function") return value;
        const bound = (value as (...a: never[]) => Promise<unknown>).bind(obj);
        if (key === "queryRaw" || key === "executeRaw") return time(bound);
        if (key === "startTransaction") return async (...a: never[]) => queryable((await bound(...a)) as object);
        return bound;
      },
    });
  return new Proxy(factory, {
    get(obj, key) {
      const value = Reflect.get(obj, key, obj) as unknown;
      if (key === "connect" && typeof value === "function") return async () => queryable((await (value as () => Promise<object>).call(obj)) as object);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(obj) : value;
    },
  });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      adapter: timedAdapter(new PrismaPg({
        connectionString: env.DATABASE_URL,
        // Per connection, so no database privileges are needed:
        // - fuzzy word matching uses the indexable operator `word <% text` (search/ranker.ts), whose cut-off is
        //   this setting (pg_trgm's default is 0.6);
        // - text searches build bitmaps of ~100k rows for common words; with the default 4 MB they go "lossy" and
        //   Postgres re-checks every row of every page (2–3× slower on a 2M-place catalog).
        options: `-c pg_trgm.word_similarity_threshold=${WORD_SIMILARITY_THRESHOLD} -c work_mem=${WORK_MEM}`,
      })),
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
