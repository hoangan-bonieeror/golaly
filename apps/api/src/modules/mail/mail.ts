import { Global, Injectable, Logger, Module } from "@nestjs/common";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Mail driver boundary. Development writes .eml-style files to MAIL_OUTBOX_DIR so you can
 * click links locally — message bodies (which contain tokens) are never written to logs.
 * Production: add an SMTP/Resend/SES driver implementing `send`.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger("Mail");

  async send(msg: MailMessage) {
    if (env.MAIL_DRIVER === "disabled") return;
    const dir = path.resolve(env.MAIL_OUTBOX_DIR);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}.txt`);
    await writeFile(file, `To: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n`, "utf8");
    this.log.log(`"${msg.subject}" queued to dev outbox (${path.basename(file)})`);
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
