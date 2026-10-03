"use client";

import { FlaskConical, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { Avatar, cx } from "../ui";

/** Seeded demo accounts (apps/api/prisma/seed.ts). Password: demo1234. */
const DEMO = [
  { email: "an@triply.dev", displayName: "An", hue: 172, note: "Owner of Japan" },
  { email: "minh@triply.dev", displayName: "Minh", hue: 210, note: "Editor" },
  { email: "linh@triply.dev", displayName: "Linh", hue: 330, note: "Viewer" },
  { email: "nam@triply.dev", displayName: "Nam", hue: 45, note: "Viewer" },
  { email: "sarah@triply.dev", displayName: "Sarah", hue: 14, note: "Not a member" },
];

/**
 * DEVELOPMENT-ONLY helper: logs in as a seeded demo user with a real API login, so
 * reviewers can test Owner / Editor / Viewer / outsider quickly. Hidden in production builds
 * and when NEXT_PUBLIC_DEMO_SWITCHER=false.
 */
export function DemoSwitcher() {
  const enabled = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEMO_SWITCHER !== "false";
  const { me, login, logout } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!enabled) return null;

  const actAs = async (email: string) => {
    setOpen(false);
    try {
      const u = await login({ email, password: "demo1234" });
      toast(`Signed in as ${u.displayName}`);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? `${e.message} Did you run npm run db:seed?` : "Couldn't switch user.", "error");
    }
  };

  return (
    <div ref={ref} className="fixed right-14 top-2.5 z-40 md:bottom-5 md:right-5 md:top-auto">
      {open && (
        <div className="animate-rise absolute right-0 top-12 w-64 rounded-2xl border border-line bg-surface p-2 shadow-pop md:bottom-12 md:top-auto">
          <p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Dev only · sign in as</p>
          {DEMO.map((u) => (
            <button
              key={u.email}
              onClick={() => actAs(u.email)}
              className={cx("flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-sm hover:bg-sand-2", me?.email === u.email && "bg-primary-50")}
            >
              <Avatar user={{ displayName: u.displayName, avatarHue: u.hue }} size={28} />
              <span className="font-medium">{u.displayName}</span>
              <span className="ml-auto truncate text-xs text-muted">{u.note}</span>
            </button>
          ))}
          {me && (
            <>
              <div className="my-1 h-px bg-line" />
              <button
                onClick={async () => {
                  setOpen(false);
                  await logout();
                  router.push("/welcome");
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-sm text-ink-2 hover:bg-sand-2"
              >
                <LogOut className="size-4" /> Log out
              </button>
            </>
          )}
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-full border border-dashed border-ink/30 bg-surface/95 pl-2.5 pr-3 text-xs font-semibold text-ink-2 shadow-card backdrop-blur md:h-10"
        aria-expanded={open}
        aria-label="Developer: switch demo user"
      >
        <FlaskConical className="size-4 text-accent" />
        {me ? (
          <>
            <Avatar user={me} size={20} /> {me.displayName}
          </>
        ) : (
          "Logged out"
        )}
      </button>
    </div>
  );
}
