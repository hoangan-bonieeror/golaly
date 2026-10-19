#!/usr/bin/env node
/**
 * Run Golaly in dev mode so you can open it on a phone.
 *
 *   node scripts/dev-phone.mjs            # same Wi-Fi: http://<this computer's IP>:3100
 *   node scripts/dev-phone.mjs --tunnel   # anywhere, over HTTPS (Cloudflare quick tunnel)
 *
 * It starts `npm run dev` (stop yours first) plus a small proxy on :3100 that serves the web app
 * and forwards /socket.io to the API, so a phone needs only one address and realtime works.
 * --tunnel also opens a free https://…trycloudflare.com address (needs `cloudflared` installed),
 * which phones treat as secure: location features (directions, "Near me") work there.
 *
 * Options: --port <n> (proxy port, default 3100) · --ip <address> (pick the LAN address yourself).
 * No dependencies beyond Node itself.
 */
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import os from "node:os";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const TUNNEL = args.includes("--tunnel");
const PORT = Number(opt("--port") ?? 3100);
const WEB = 3000;
const API = 4000;
const win = process.platform === "win32";

const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m` };
const log = (...m) => console.log(c.dim("[phone]"), ...m);

/** The address other devices on the Wi-Fi reach this computer at (skipping VPN / VM / WSL adapters). */
function lanAddress() {
  const virtual = /virtual|vbox|vmware|vethernet|wsl|docker|hyper-v|loopback|tailscale|zerotier|utun|bridge|vEthernet/i;
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const priv = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      // VirtualBox's host-only network is 192.168.56.x by default.
      const score = (priv ? 2 : 0) + (virtual.test(name) || a.address.startsWith("192.168.56.") ? -3 : 0) + (/wi-?fi|wlan|en0|ethernet|eth0/i.test(name) ? 1 : 0);
      candidates.push({ name, address: a.address, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return { best: candidates[0]?.address, all: candidates };
}

/** Resolves true if something already listens on `port` (locally). */
const portBusy = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" }, () => {
      s.destroy();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });

/**
 * One address for everything: /socket.io → the API (realtime), the rest → the Next dev server
 * (which already proxies /api/v1 and /media to the API). WebSocket upgrades (realtime, hot reload)
 * are piped through as raw TCP.
 */
function startProxy() {
  const target = (url = "/") => (url.startsWith("/socket.io") ? API : WEB);
  const server = http.createServer((req, res) => {
    const up = http.request({ host: "127.0.0.1", port: target(req.url), method: req.method, path: req.url, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("Golaly dev server isn't answering yet — wait a few seconds and reload.");
    });
    req.pipe(up);
  });
  server.on("upgrade", (req, socket, head) => {
    const up = net.connect({ host: "127.0.0.1", port: target(req.url) }, () => {
      const headers = Object.entries(req.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${v}`]));
      up.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers.join("\r\n")}\r\n\r\n`);
      if (head?.length) up.write(head);
      up.pipe(socket).pipe(up);
    });
    const close = () => {
      socket.destroy();
      up.destroy();
    };
    up.on("error", close);
    socket.on("error", close);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "0.0.0.0", () => resolve(server));
  });
}

/** Starts a Cloudflare quick tunnel to the proxy and resolves with its https URL. */
function startTunnel() {
  return new Promise((resolve, reject) => {
    const child = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`], { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => reject(new Error("cloudflared didn't report a tunnel address within 45 s.")), 45_000);
    const scan = (buf) => {
      const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        clearTimeout(timer);
        resolve({ url: m[0], child });
      }
    };
    child.stdout.on("data", scan);
    child.stderr.on("data", scan);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e.code === "ENOENT" ? Object.assign(new Error("cloudflared isn't installed."), { missing: true }) : e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`cloudflared exited (${code}).`));
    });
  });
}

const children = [];
function shutdown(code = 0) {
  for (const ch of children) {
    if (ch.exitCode !== null) continue;
    // npm on Windows runs through cmd.exe: kill the whole tree.
    if (win) spawnSync("taskkill", ["/pid", String(ch.pid), "/T", "/F"], { stdio: "ignore" });
    else ch.kill("SIGINT");
  }
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// ── Go ──────────────────────────────────────────────────────────────────
for (const [port, what] of [[WEB, "web"], [API, "API"], [PORT, "phone proxy"]]) {
  if (await portBusy(port)) {
    console.error(c.red(`Port ${port} (${what}) is already in use. Stop your running \`npm run dev\` (Ctrl+C) and try again.`));
    process.exit(1);
  }
}

const { best, all } = lanAddress();
const ip = opt("--ip") ?? best;
if (!ip && !TUNNEL) {
  console.error(c.red("Couldn't find this computer's Wi-Fi/Ethernet address. Use --ip <address> or --tunnel."));
  process.exit(1);
}

await startProxy();
const lanUrl = ip ? `http://${ip}:${PORT}` : null;

let tunnelUrl = null;
if (TUNNEL) {
  log("Opening an HTTPS tunnel (Cloudflare)…");
  try {
    const t = await startTunnel();
    tunnelUrl = t.url;
    children.push(t.child);
  } catch (e) {
    console.error(c.red(e.message));
    if (e.missing) {
      console.error(`Install it once, then run this again:
  Windows:  winget install --id Cloudflare.cloudflared
  macOS:    brew install cloudflared
  Linux:    https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`);
    }
    shutdown(1);
  }
}

const publicUrl = tunnelUrl ?? lanUrl;
const env = {
  ...process.env,
  // Web: allow these hostnames to load the dev server; realtime picks API (:3000) or same origin (proxy/tunnel).
  DEV_ALLOWED_ORIGINS: [ip, tunnelUrl && "*.trycloudflare.com"].filter(Boolean).join(","),
  NEXT_PUBLIC_REALTIME_URL: "auto",
  // API: links in emails/invites point at the phone-reachable address; the socket accepts every origin in use.
  WEB_ORIGIN: publicUrl,
  CORS_EXTRA_ORIGINS: ["http://localhost:3000", lanUrl, tunnelUrl].filter((o) => o && o !== publicUrl).join(","),
};
const dev = spawn(win ? "npm.cmd" : "npm", ["run", "dev"], { stdio: "inherit", env, shell: win });
children.push(dev);
dev.on("exit", (code) => shutdown(code ?? 0));

console.log(`
${c.green(c.bold("Golaly on your phone"))}  ${c.dim("(the dev servers start below; the first page load compiles for a few seconds)")}
${lanUrl ? `  Same Wi-Fi:  ${c.bold(lanUrl)}` : ""}${tunnelUrl ? `\n  Anywhere:   ${c.bold(tunnelUrl)}  ${c.dim("(HTTPS — location features work)")}` : ""}
  This computer: http://localhost:${WEB}

  ${c.dim("•")} Log in with your account or a demo one (an@golaly.dev / demo1234 after npm run db:seed).
  ${c.dim("•")} Google sign-in only works on localhost (its redirect address is registered for that).
  ${c.dim("•")} ${tunnelUrl ? "Location (directions, \"Near me\") works on the HTTPS address; the Wi-Fi one is plain HTTP, where phones block it." : 'Same Wi-Fi is plain HTTP, so the phone\'s browser blocks location (directions, "Near me") — run with --tunnel for those.'}
  ${c.dim("•")} Windows asks once to let Node.js accept connections: allow it on ${c.bold("Private networks")}.
${all.length > 1 && !opt("--ip") ? c.dim(`  Other addresses on this computer: ${all.slice(1).map((a) => `${a.address} (${a.name})`).join(", ")} — pick one with --ip if the phone can't connect.\n`) : ""}  ${c.dim("Ctrl+C stops everything.")}
`);
