import { randomToken, sha256 } from "../src/common/crypto";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type TestAgent from "supertest/lib/agent";
import { createApp } from "../src/main";
import { PrismaService } from "../src/prisma/prisma.service";

export const DEMO_PASSWORD = "demo1234";

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  /** Logged-in agent; cookies persist between calls like a browser. */
  as(email: string, password?: string): Promise<Agent>;
  anon(): Agent;
  register(prefix: string, opts?: { verified?: boolean }): Promise<Agent & { email: string; username: string; id: string }>;
  /** Confirms a user's email through the real endpoint (token row inserted directly — no inbox). */
  verifyEmail(userId: string): Promise<void>;
}

export type Agent = {
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  delete: (url: string, body?: object) => request.Test;
  raw: TestAgent;
  cookies: () => string;
};

const API = "/api/v1";

function wrap(raw: TestAgent): Agent {
  let cookieHeader = "";
  const csrf = (t: request.Test) => t.set("X-Requested-With", "triply");
  return {
    raw,
    get: (url) => raw.get(API + url),
    post: (url, body) => csrf(raw.post(API + url)).send(body ?? {}),
    patch: (url, body) => csrf(raw.patch(API + url)).send(body ?? {}),
    put: (url, body) => csrf(raw.put(API + url)).send(body ?? {}),
    delete: (url, body) => csrf(raw.delete(API + url)).send(body ?? {}),
    cookies: () => cookieHeader,
    set cookie(v: string) {
      cookieHeader = v;
    },
  } as Agent;
}

let counter = 0;

export async function createTestContext(): Promise<TestContext> {
  const app = await createApp();
  await app.init();
  const prisma = app.get(PrismaService);
  const server = app.getHttpServer();

  const ctx: TestContext = {
    app,
    prisma,
    anon: () => wrap(request.agent(server)),
    async as(email, password = DEMO_PASSWORD) {
      const raw = request.agent(server);
      const res = await raw.post(`${API}/auth/login`).set("X-Requested-With", "triply").send({ email, password });
      if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
      const a = wrap(raw);
      (a as unknown as { cookie: string }).cookie = (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");
      return a;
    },
    async verifyEmail(userId) {
      const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
      const token = randomToken();
      await prisma.emailVerificationToken.create({ data: { userId, email: u.email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3_600_000) } });
      const res = await request(server).post(`${API}/auth/verify-email`).set("X-Requested-With", "triply").send({ token });
      if (res.status !== 200) throw new Error(`verify failed: ${res.status} ${JSON.stringify(res.body)}`);
    },
    async register(prefix, opts) {
      const n = `${prefix}${Date.now().toString(36)}${counter++}`.toLowerCase().slice(0, 24);
      const email = `${n}@example.com`;
      const raw = request.agent(server);
      const res = await raw.post(`${API}/auth/register`).set("X-Requested-With", "triply").send({ email, username: n, password: "password123" });
      if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
      const a = wrap(raw);
      (a as unknown as { cookie: string }).cookie = (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");
      if (opts?.verified) await ctx.verifyEmail(res.body.id);
      return Object.assign(a, { email, username: n, id: res.body.id as string });
    },
  };
  return ctx;
}

export async function demoTrip(prisma: PrismaService, title: string) {
  return prisma.trip.findFirstOrThrow({ where: { title }, include: { days: { orderBy: { dayNumber: "asc" } } } });
}
