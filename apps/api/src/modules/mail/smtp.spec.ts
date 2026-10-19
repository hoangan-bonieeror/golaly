/** The SMTP client against an in-process server that speaks just enough SMTP (plain, STARTTLS, implicit TLS). */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { buildMessage, parseSmtpUrl, sendSmtp, type SmtpConfig } from "./smtp";

type Received = { auth: string | null; from: string; to: string; data: string; tls: boolean };

/** A tiny SMTP server: records what it receives; `startTls` advertises STARTTLS, `password` is the one it accepts. */
function fakeServer(opts: { startTls?: boolean; implicitTls?: boolean; password?: string; cert?: { key: string; cert: string } }) {
  const received: Received[] = [];
  const handle = (raw: net.Socket, secure: boolean) => {
    let socket: net.Socket = raw;
    let buf = "";
    let inData = false;
    let cur: Received = { auth: null, from: "", to: "", data: "", tls: secure };
    const say = (s: string) => socket.write(`${s}\r\n`);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          cur.data = buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          received.push(cur);
          cur = { auth: cur.auth, from: "", to: "", data: "", tls: cur.tls };
          say("250 queued");
          continue;
        }
        const i = buf.indexOf("\r\n");
        if (i < 0) return;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const verb = line.split(" ")[0].toUpperCase();
        if (verb === "EHLO") {
          const ext = [opts.startTls && !cur.tls ? "STARTTLS" : null, "AUTH PLAIN"].filter(Boolean) as string[];
          socket.write(["250-fake.test", ...ext.map((e, j) => `${j === ext.length - 1 ? "250 " : "250-"}${e}`)].join("\r\n") + "\r\n");
        } else if (verb === "STARTTLS") {
          say("220 go ahead");
          socket.removeListener("data", onData);
          const secured = new tls.TLSSocket(socket, { isServer: true, key: opts.cert!.key, cert: opts.cert!.cert });
          secured.on("data", onData);
          socket = secured;
          cur.tls = true;
        } else if (verb === "AUTH") {
          const [, user, pass] = Buffer.from(line.split(" ")[2], "base64").toString("utf8").split("\0");
          if (pass === opts.password) {
            cur.auth = user;
            say("235 ok");
          } else say("535 bad credentials");
        } else if (verb === "MAIL") {
          cur.from = line;
          say("250 ok");
        } else if (verb === "RCPT") {
          cur.to = line;
          say("250 ok");
        } else if (verb === "DATA") {
          inData = true;
          say("354 send it");
        } else if (verb === "QUIT") {
          say("221 bye");
          socket.end();
        } else say("502 what");
      }
    };
    socket.on("data", onData);
    socket.on("error", () => undefined);
    say("220 fake.test ESMTP");
  };
  const server = opts.implicitTls
    ? tls.createServer({ key: opts.cert!.key, cert: opts.cert!.cert }, (s) => handle(s, true))
    : net.createServer((s) => handle(s, false));
  return new Promise<{ port: number; received: Received[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, received, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

let cert: { key: string; cert: string };
beforeAll(() => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "smtp-cert-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem")], { stdio: "ignore" });
  cert = { key: readFileSync(path.join(dir, "k.pem"), "utf8"), cert: readFileSync(path.join(dir, "c.pem"), "utf8") };
});

const msg = { from: "Golaly Đà Lạt <noreply@golaly.test>", to: "lan@example.com", subject: "Xác nhận email Golaly của bạn", text: "Xin chào!\n.leading dot line\nhttps://example.com/verify?token=abc" };
const bodyOf = (data: string) => Buffer.from(data.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");

describe("smtp", () => {
  it("parses SMTP URLs, with encoded credentials and default ports", () => {
    expect(parseSmtpUrl("smtps://me%40gmail.com:ab%20cd@smtp.gmail.com")).toEqual({ secure: true, host: "smtp.gmail.com", port: 465, user: "me@gmail.com", pass: "ab cd" });
    expect(parseSmtpUrl("smtp://u:p@smtp-relay.brevo.com")).toMatchObject({ secure: false, port: 587 });
    expect(() => parseSmtpUrl("https://x")).toThrow(/smtp/);
  });

  it("encodes Vietnamese subjects and names, and a body no line of which starts with a dot", () => {
    const m = buildMessage(msg, new Date("2026-10-19T08:00:00Z"));
    expect(m).toContain(`Subject: =?UTF-8?B?${Buffer.from(msg.subject).toString("base64")}?=`);
    expect(m).toContain(`From: =?UTF-8?B?${Buffer.from("Golaly Đà Lạt").toString("base64")}?= <noreply@golaly.test>`);
    expect(m).toContain("Date: Mon, 19 Oct 2026 08:00:00 +0000");
    expect(m.split("\r\n").some((l) => l.startsWith("."))).toBe(false);
    expect(bodyOf(m)).toBe(msg.text.replace(/\n/g, "\r\n"));
  });

  it("delivers over STARTTLS with AUTH PLAIN", async () => {
    const srv = await fakeServer({ startTls: true, password: "s3cret", cert });
    const cfg: SmtpConfig = { ...parseSmtpUrl(`smtp://me%40golaly.test:s3cret@localhost:${srv.port}`), tls: { ca: cert.cert } };
    await sendSmtp(cfg, msg);
    await srv.close();
    expect(srv.received).toHaveLength(1);
    const r = srv.received[0];
    expect(r).toMatchObject({ tls: true, auth: "me@golaly.test", from: "MAIL FROM:<noreply@golaly.test>", to: "RCPT TO:<lan@example.com>" });
    expect(bodyOf(r.data)).toContain("token=abc");
  });

  it("delivers over implicit TLS (smtps://)", async () => {
    const srv = await fakeServer({ implicitTls: true, password: "pw", cert });
    await sendSmtp({ ...parseSmtpUrl(`smtps://u:pw@localhost:${srv.port}`), tls: { ca: cert.cert } }, msg);
    await srv.close();
    expect(srv.received[0]).toMatchObject({ tls: true, auth: "u" });
  });

  it("refuses a certificate it can't verify", async () => {
    const srv = await fakeServer({ implicitTls: true, password: "pw", cert });
    await expect(sendSmtp(parseSmtpUrl(`smtps://u:pw@localhost:${srv.port}`), msg)).rejects.toThrow(/certificate/);
    await srv.close();
    expect(srv.received).toHaveLength(0);
  });

  it("reports a wrong password as a permanent (5xx) failure, without echoing the server's text", async () => {
    const srv = await fakeServer({ startTls: true, password: "right", cert });
    await expect(sendSmtp({ ...parseSmtpUrl(`smtp://u:wrong@localhost:${srv.port}`), tls: { ca: cert.cert } }, msg)).rejects.toThrow("SMTP AUTH refused (535)");
    await srv.close();
  });

  it("allows plain text only to a server on this machine", async () => {
    const srv = await fakeServer({ password: "pw" });
    await sendSmtp(parseSmtpUrl(`smtp://u:pw@127.0.0.1:${srv.port}`), msg);
    await srv.close();
    expect(srv.received[0]).toMatchObject({ tls: false, auth: "u" });
  });
});
