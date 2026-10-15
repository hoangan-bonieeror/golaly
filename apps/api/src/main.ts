import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import type { Request, Response } from "express";
import helmet from "helmet";
import path from "node:path";
import { AppModule } from "./app.module";
import { localeMiddleware } from "./common/locale";
import { corsOrigins, env } from "./config/env";

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: env.NODE_ENV === "test" ? ["error"] : ["log", "warn", "error"],
  });
  // Only trusted hops may set the client IP that rate limits key on (see TRUST_PROXY in env.ts).
  app.set("trust proxy", env.TRUST_PROXY);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cookieParser());
  app.use(localeMiddleware);
  app.enableCors({ origin: corsOrigins, credentials: true, allowedHeaders: ["Content-Type", "X-Requested-With", "Accept-Language", "X-Triply-Locale"] });
  app.setGlobalPrefix("api/v1", { exclude: ["health"] });
  if (env.S3) {
    // Bucket storage: the web normally rewrites /media/* straight to the bucket (MEDIA_ORIGIN); anything that
    // still reaches the API (old links, a web without MEDIA_ORIGIN) is sent there permanently.
    const publicUrl = env.S3.publicUrl;
    app.use("/media", (req: Request, res: Response) => res.redirect(301, `${publicUrl}${req.path}`));
  } else {
    // Local media driver serves files directly.
    app.useStaticAssets(path.resolve(env.MEDIA_DIR), { prefix: "/media/", maxAge: "30d", immutable: true, index: false, dotfiles: "deny" });
  }
  app.enableShutdownHooks();
  return app;
}

async function bootstrap() {
  const app = await createApp();
  await app.listen(env.PORT);
  new Logger("TRIPLY").log(`API ready on http://localhost:${env.PORT}/api/v1`);
}

if (require.main === module) void bootstrap();
