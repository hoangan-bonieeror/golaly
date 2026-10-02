import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import path from "node:path";
import { AppModule } from "./app.module";
import { env } from "./config/env";

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: env.NODE_ENV === "test" ? ["error"] : ["log", "warn", "error"],
  });
  // Only trusted hops may set the client IP that rate limits key on (see TRUST_PROXY in env.ts).
  app.set("trust proxy", env.TRUST_PROXY);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cookieParser());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true, allowedHeaders: ["Content-Type", "X-Requested-With"] });
  app.setGlobalPrefix("api/v1", { exclude: ["health"] });
  // Local media driver serves files directly; S3/R2 would hand out signed URLs instead.
  app.useStaticAssets(path.resolve(env.MEDIA_DIR), { prefix: "/media/", maxAge: "30d", immutable: true, index: false, dotfiles: "deny" });
  app.enableShutdownHooks();
  return app;
}

async function bootstrap() {
  const app = await createApp();
  await app.listen(env.PORT);
  new Logger("TRIPLY").log(`API ready on http://localhost:${env.PORT}/api/v1`);
}

if (require.main === module) void bootstrap();
