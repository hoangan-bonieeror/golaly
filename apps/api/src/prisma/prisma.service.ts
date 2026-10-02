import { Global, Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env";
import { PrismaClient } from "../generated/prisma/client";

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
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
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
