"use client";

import { FlaskConical, LogOut, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMe, useStore } from "@/lib/store/store";
import { Avatar, cx } from "../ui";

/**
 * PROTOTYPE-ONLY control. Lets reviewers act as any demo user to test
 * roles (Owner / Editor / Viewer / outsider). Not part of the product UI.
 */
export function DemoSwitcher() {
  const { db, signIn, signOut, resetDemo } = useStore();
  const me = useMe();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="fixed right-14 top-2.5 z-40 md:bottom-5 md:right-5 md:top-auto">
      {open && (
        <div className="animate-rise absolute right-0 top-12 w-64 md:bottom-12 md:top-auto rounded-2xl border border-line bg-surface p-2 shadow-pop">
          <p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Prototype · act as</p>
          {db.users.map((u) => (
            <button
              key={u.id}
              onClick={() => {
                signIn(u.id);
                setOpen(false);
              }}
              className={cx("flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-sm hover:bg-sand-2", me?.id === u.id && "bg-lagoon-50")}
            >
              <Avatar user={u} size={28} />
              <span className="font-medium">{u.displayName}</span>
              <span className="ml-auto truncate text-xs text-muted">@{u.username}</span>
            </button>
          ))}
          <div className="my-1 h-px bg-line" />
          <button
            onClick={() => {
              signOut();
              setOpen(false);
              router.push("/welcome");
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-sm text-ink-2 hover:bg-sand-2"
          >
            <LogOut className="size-4" /> Log out
          </button>
          <button
            onClick={() => {
              resetDemo();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-sm text-ink-2 hover:bg-sand-2"
          >
            <RotateCcw className="size-4" /> Reset demo data
          </button>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-full md:h-10 border border-dashed border-ink/30 bg-surface/95 pl-2.5 pr-3 text-xs font-semibold text-ink-2 shadow-card backdrop-blur"
        aria-expanded={open}
      >
        <FlaskConical className="size-4 text-sunset" />
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
