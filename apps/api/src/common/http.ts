import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  PipeTransform,
  BadRequestException,
} from "@nestjs/common";
import { localizeMessage, type ApiErrorBody } from "@golaly/shared";
import { requestLocale } from "./locale";
import type { Response } from "express";
import { ZodError, type ZodType } from "zod";

/** Every error a client sees has a message that is safe and friendly (spec §40). */
export class AppError extends HttpException {
  constructor(status: number, message: string, fields?: Record<string, string>) {
    super({ statusCode: status, message, fields } satisfies ApiErrorBody, status);
  }
}

export const Errors = {
  unauthorized: () => new AppError(401, "Please log in to continue."),
  forbidden: (msg = "You no longer have permission to edit this trip.") => new AppError(403, msg),
  notFound: (what = "That") => new AppError(404, `${what} couldn't be found.`),
  conflict: (msg: string) => new AppError(409, msg),
  invalid: (msg: string, fields?: Record<string, string>) => new AppError(422, msg, fields),
};

/** Validates & parses with a shared Zod schema. Usage: @Body(new ZodPipe(schema)). */
export class ZodPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    throw zodToAppError(result.error);
  }
}

export function zodToAppError(error: ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  return new AppError(422, Object.values(fields)[0] ?? "Some fields need attention.", fields);
}

const FRIENDLY: Record<number, string> = {
  400: "That request didn't look right.",
  401: "Please log in to continue.",
  403: "You don't have permission to do that.",
  404: "We couldn't find that.",
  409: "That conflicts with something that already exists.",
  413: "That file is too large.",
  422: "Some fields need attention.",
  429: "You're doing that a bit too fast. Please wait a moment and try again.",
  500: "Something went wrong. Please try again.",
};

/**
 * Global filter: never leaks stack traces, SQL, or internal ids.
 * Prisma "not found"/"unique" errors become 404/409. Request bodies are never logged
 * (they can contain passwords or tokens — spec §42).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger("HTTP");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    if (!res || typeof res.status !== "function") return; // websocket context

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiErrorBody = { statusCode: 500, message: FRIENDLY[500] };

    if (exception instanceof AppError) {
      status = exception.getStatus();
      body = exception.getResponse() as ApiErrorBody;
    } else if (exception instanceof ZodError) {
      const e = zodToAppError(exception);
      status = 422;
      body = e.getResponse() as ApiErrorBody;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      const raw = typeof r === "string" ? r : (r as { message?: unknown }).message;
      // Nest's built-in messages are fine for 4xx except where they may be technical.
      const message = status === 429 || typeof raw !== "string" || exception instanceof BadRequestException ? FRIENDLY[status] : raw;
      body = { statusCode: status, message: message ?? FRIENDLY[status] ?? FRIENDLY[500] };
    } else if (isPrismaError(exception)) {
      if (exception.code === "P2025") {
        status = 404;
        body = { statusCode: 404, message: FRIENDLY[404] };
      } else if (exception.code === "P2002") {
        status = 409;
        body = { statusCode: 409, message: FRIENDLY[409] };
      } else {
        this.log.error(`Prisma ${exception.code}`, (exception as unknown as Error).stack);
      }
    } else {
      this.log.error("Unhandled error", exception instanceof Error ? exception.stack : String(exception));
    }
    // Messages are written in English where they're thrown; the client gets them in its interface language.
    const locale = requestLocale();
    if (locale !== "en") {
      body = {
        ...body,
        message: localizeMessage(body.message, locale),
        ...(body.fields ? { fields: Object.fromEntries(Object.entries(body.fields).map(([k, v]) => [k, localizeMessage(v, locale)])) } : {}),
      };
    }
    res.status(status).json(body);
  }
}

function isPrismaError(e: unknown): e is { code: string } {
  return typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string" && /^P\d{4}$/.test((e as { code: string }).code);
}
