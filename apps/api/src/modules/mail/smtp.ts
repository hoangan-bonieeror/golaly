import { randomUUID } from "node:crypto";
import net from "node:net";
import tls from "node:tls";

/**
 * A small SMTP client (RFC 5321) for transactional mail — no dependency, any provider: Gmail (an app password),
 * Brevo, Amazon SES, Resend, Postmark, Mailgun all accept it.
 *
 * - `smtps://user:pass@host:465` — TLS from the first byte.
 * - `smtp://user:pass@host:587` — upgraded with STARTTLS. Without STARTTLS the client refuses to go on, except for a
 *   server on this machine (a local catcher such as Mailpit, or tests), where plain text is allowed.
 * - AUTH PLAIN (only ever over TLS, or locally). One connection per message; messages are plain text, UTF-8.
 */
export interface SmtpConfig {
  secure: boolean;
  host: string;
  port: number;
  user?: string;
  pass?: string;
  /** Extra TLS options (tests: trust a self-signed certificate). */
  tls?: tls.ConnectionOptions;
}

export interface SmtpMessage {
  /** "TRIPLY <noreply@example.com>" or a bare address. */
  from: string;
  to: string;
  subject: string;
  text: string;
}

const TIMEOUT_MS = 20_000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function parseSmtpUrl(raw: string): SmtpConfig {
  const u = new URL(raw);
  if (u.protocol !== "smtp:" && u.protocol !== "smtps:") throw new Error("SMTP_URL must start with smtp:// or smtps://");
  const secure = u.protocol === "smtps:";
  return {
    secure,
    host: u.hostname.replace(/^\[|\]$/g, ""),
    port: u.port ? Number(u.port) : secure ? 465 : 587,
    user: u.username ? decodeURIComponent(u.username) : undefined,
    pass: u.password ? decodeURIComponent(u.password) : undefined,
  };
}

/** The bare address inside "Name <address>". */
export function addressOf(from: string): string {
  const m = /<([^<>]+)>\s*$/.exec(from);
  return (m ? m[1] : from).trim();
}

/** RFC 2047 encoded-word when the text isn't plain ASCII (Vietnamese subjects and names). */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function encodeFrom(from: string): string {
  const m = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(from);
  if (!m || !m[1]) return addressOf(from);
  return `${encodeHeader(m[1].replace(/^"|"$/g, ""))} <${m[2]}>`;
}

const noLineBreaks = (s: string) => s.replace(/[\r\n]+/g, " ");

/** The message as sent after DATA: headers + a base64 body (no line can start with "."). */
export function buildMessage(msg: SmtpMessage, now = new Date()): string {
  const domain = addressOf(msg.from).split("@")[1] ?? "localhost";
  const body = Buffer.from(msg.text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: ${encodeFrom(noLineBreaks(msg.from))}`,
    `To: ${noLineBreaks(msg.to)}`,
    `Subject: ${encodeHeader(noLineBreaks(msg.subject))}`,
    `Date: ${now.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** Reads SMTP replies (possibly multi-line: "250-…" then "250 …") off a socket that may be swapped for a TLS one. */
class Conversation {
  private buffer = "";
  private lines: string[] = [];
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;
  private failWaiting: ((e: Error) => void) | null = null;

  constructor(private socket: net.Socket) {
    this.attach(socket);
  }

  attach(socket: net.Socket) {
    this.socket = socket;
    socket.setTimeout(TIMEOUT_MS, () => this.fail(new Error("SMTP server timed out")));
    socket.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      let i: number;
      while ((i = this.buffer.indexOf("\r\n")) >= 0) {
        this.lines.push(this.buffer.slice(0, i));
        this.buffer = this.buffer.slice(i + 2);
      }
      this.flush();
    });
    socket.on("error", (e) => this.fail(e));
    socket.on("close", () => this.fail(new Error("SMTP connection closed")));
  }

  /** Stop reading the plain socket before the TLS handshake takes it over. */
  detach() {
    this.socket.removeAllListeners("data");
    this.socket.removeAllListeners("error");
    this.socket.removeAllListeners("close");
    this.socket.setTimeout(0);
  }

  private fail(e: Error) {
    if (this.failure) return;
    this.failure = e;
    this.failWaiting?.(e);
  }

  private flush() {
    if (this.waiting && this.lines.length) {
      const w = this.waiting;
      this.waiting = null;
      this.failWaiting = null;
      w(this.lines.shift()!);
    }
  }

  private line(): Promise<string> {
    if (this.lines.length) return Promise.resolve(this.lines.shift()!);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiting = resolve;
      this.failWaiting = reject;
    });
  }

  /** One reply: its code and the text of every line. Throws unless the code is one of `expect`. */
  async reply(expect: number[], step: string): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    for (;;) {
      const l = await this.line();
      lines.push(l.slice(4));
      if (l.charAt(3) !== "-") {
        const code = Number(l.slice(0, 3));
        // The server's own words can echo addresses: keep only the code and the step in errors.
        if (!expect.includes(code)) throw new Error(`SMTP ${step} refused (${code})`);
        return { code, lines };
      }
    }
  }

  write(s: string) {
    this.socket.write(s);
  }

  async command(cmd: string, expect: number[], step = cmd.split(" ")[0]) {
    this.write(`${cmd}\r\n`);
    return this.reply(expect, step);
  }

  get raw() {
    return this.socket;
  }
}

function connect(cfg: SmtpConfig): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error) => reject(e);
    const s = cfg.secure
      ? tls.connect({ ...cfg.tls, host: cfg.host, port: cfg.port, servername: cfg.host }, () => resolve(s))
      : net.connect({ host: cfg.host, port: cfg.port }, () => resolve(s));
    s.once("error", onError);
    s.setTimeout(TIMEOUT_MS, () => s.destroy(new Error("SMTP connection timed out")));
  });
}

function upgrade(socket: net.Socket, cfg: SmtpConfig): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ ...cfg.tls, socket, servername: cfg.host }, () => resolve(s));
    s.once("error", reject);
  });
}

export async function sendSmtp(cfg: SmtpConfig, msg: SmtpMessage, heloName = "triply"): Promise<void> {
  const socket = await connect(cfg);
  const c = new Conversation(socket);
  try {
    await c.reply([220], "greeting");
    let ehlo = await c.command(`EHLO ${heloName}`, [250]);
    let encrypted = cfg.secure;
    if (!encrypted) {
      const canTls = ehlo.lines.some((l) => /^STARTTLS\b/i.test(l));
      if (canTls) {
        await c.command("STARTTLS", [220]);
        c.detach();
        const secured = await upgrade(c.raw, cfg);
        c.attach(secured);
        encrypted = true;
        ehlo = await c.command(`EHLO ${heloName}`, [250]);
      } else if (!LOCAL_HOSTS.has(cfg.host)) {
        throw new Error("SMTP server offers no STARTTLS: refusing to send in plain text (use smtps:// on port 465)");
      }
    }
    if (cfg.user) {
      if (!encrypted && !LOCAL_HOSTS.has(cfg.host)) throw new Error("refusing to send SMTP credentials in plain text");
      const token = Buffer.from(`\0${cfg.user}\0${cfg.pass ?? ""}`, "utf8").toString("base64");
      await c.command(`AUTH PLAIN ${token}`, [235], "AUTH");
    }
    await c.command(`MAIL FROM:<${addressOf(msg.from)}>`, [250], "MAIL FROM");
    await c.command(`RCPT TO:<${addressOf(msg.to)}>`, [250, 251], "RCPT TO");
    await c.command("DATA", [354]);
    c.write(`${buildMessage(msg)}\r\n.\r\n`);
    await c.reply([250], "message");
    await c.command("QUIT", [221]).catch(() => undefined);
  } finally {
    c.raw.destroy();
  }
}
