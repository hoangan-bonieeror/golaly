import { Global, Injectable, Logger, Module } from "@nestjs/common";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env";
import { parseSmtpUrl, sendSmtp, type SmtpConfig } from "./smtp";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Waits between attempts when the mail server is unreachable or answers with a temporary error. */
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

/**
 * Mail driver boundary (MAIL_DRIVER):
 * - `dev-outbox` writes .eml-style files to MAIL_OUTBOX_DIR so you can click links locally;
 * - `smtp` sends through SMTP_URL from MAIL_FROM (`./smtp.ts`, any provider). Sending happens after the request
 *   has answered — a slow or failing mail server never slows down or breaks sign-up, invites or password reset —
 *   with a few retries; mails still queued are lost if the process restarts;
 * - `disabled` drops everything.
 * Message bodies (which contain tokens) and recipients are never written to logs.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger("Mail");
  private readonly smtp: SmtpConfig | null = env.MAIL_DRIVER === "smtp" && env.SMTP_URL ? parseSmtpUrl(env.SMTP_URL) : null;
  /** One message at a time: providers throttle bursts, and order is kept. */
  private queue: Promise<void> = Promise.resolve();
  /** For tests: resolves once everything queued so far has been sent or given up. */
  idle() {
    return this.queue;
  }

  async send(msg: MailMessage) {
    if (env.MAIL_DRIVER === "disabled") return;
    if (env.MAIL_DRIVER === "smtp") {
      this.queue = this.queue.then(() => this.deliver(msg));
      return;
    }
    const dir = path.resolve(env.MAIL_OUTBOX_DIR);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}.txt`);
    await writeFile(file, `To: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n`, "utf8");
    this.log.log(`"${msg.subject}" queued to dev outbox (${path.basename(file)})`);
  }

  private async deliver(msg: MailMessage) {
    for (let attempt = 0; ; attempt++) {
      try {
        await sendSmtp(this.smtp!, { from: env.MAIL_FROM!, ...msg });
        this.log.log(`"${msg.subject}" sent`);
        return;
      } catch (e) {
        const reason = (e as Error).message;
        // 5xx = permanent (bad address, refused sender, wrong password): retrying won't help.
        const permanent = /\((5\d\d)\)/.test(reason);
        if (permanent || attempt >= RETRY_DELAYS_MS.length) {
          this.log.error(`"${msg.subject}" not sent: ${reason}`);
          return;
        }
        this.log.warn(`"${msg.subject}" not sent yet (${reason}); retrying`);
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
