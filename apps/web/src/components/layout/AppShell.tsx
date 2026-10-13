"use client";

import type { Me } from "@triply/shared";
import { Bell, Bookmark, ChevronDown, Compass, Home, LogOut, Luggage, PlusCircle, Search, Settings, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useMe, useUnreadCount } from "@/lib/api/queries";
import { useNotificationStream } from "@/lib/realtime";
import { useSession } from "@/lib/session";
import { Avatar, Button, PageLoader, cx } from "../ui";
import { CreateSheet } from "./CreateSheet";
import { DemoSwitcher } from "./DemoSwitcher";
import { Logo } from "./Logo";
import { VerifyEmailBanner } from "./VerifyEmailBanner";

const PROTECTED = ["/trips", "/trips/new", "/saved", "/notifications", "/settings", "/posts/new"];
const PROTECTED_PREFIX = ["/invitations/", "/trips/new", "/admin"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const meQuery = useMe();
  const me = meQuery.data ?? null;
  const unread = useUnreadCount(!!me).data ?? 0;
  const [createOpen, setCreateOpen] = useState(false);
  useNotificationStream(me?.id);

  // Pages that only make sense for a signed-in user. Trips, posts, profiles and
  // Explore stay viewable when logged out (public content only — enforced by the API).
  const needsAuth = PROTECTED.includes(pathname) || PROTECTED_PREFIX.some((p) => pathname.startsWith(p)) || /^\/trips\/[^/]+\/settings$/.test(pathname);
  useEffect(() => {
    if (!meQuery.isLoading && !me && needsAuth) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [meQuery.isLoading, me, needsAuth, pathname, router]);

  const isActive = (href: string) => pathname === href || (href !== "/home" && pathname.startsWith(href));
  const profileHref = me ? `/u/${me.username}` : "/login";

  // Trip planner pages run edge to edge under the navbar (itinerary beside a full-height map).
  const fullBleed = /^\/trips\/[0-9a-f-]{36}$/i.test(pathname);

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only z-[60] rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      {/* Desktop navbar: the three places people go, global search, then create · alerts · account. */}
      <header className="sticky top-0 z-40 hidden h-16 items-center gap-5 border-b border-line bg-surface/95 px-6 backdrop-blur md:flex">
        <Link href="/home" aria-label="TRIPLY home" className="shrink-0 rounded-xl">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex shrink-0 gap-1">
          {[
            { href: "/home", label: "Home" },
            { href: "/explore", label: "Explore" },
            { href: "/trips", label: "Trips" },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={cx("rounded-[10px] px-3 py-2 text-sm font-semibold transition-colors", isActive(href) ? "bg-sand-2 text-ink" : "text-ink-2 hover:bg-sand-2 hover:text-ink")}
            >
              {label}
            </Link>
          ))}
        </nav>
        <NavSearch />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* Below 1024px the search field doesn't fit; Explore has it. */}
          <Link href="/explore" aria-label="Search TRIPLY" className="flex size-10 items-center justify-center rounded-xl border border-line bg-surface text-ink-2 hover:bg-sand-2 lg:hidden">
            <Search className="size-[18px]" aria-hidden />
          </Link>
          {me ? (
            <>
              <Button onClick={() => setCreateOpen(true)}>
                <PlusCircle className="size-4" aria-hidden /> Create
              </Button>
              <Link
                href="/notifications"
                aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
                aria-current={isActive("/notifications") ? "page" : undefined}
                className={cx("relative flex size-10 items-center justify-center rounded-xl border border-line text-ink-2 hover:bg-sand-2 hover:text-ink", isActive("/notifications") ? "bg-sand-2" : "bg-surface")}
              >
                <Bell className="size-[18px]" aria-hidden />
                {!!unread && (
                  <span aria-hidden className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-accent-700 px-1.5 text-center font-mono text-[11px] font-semibold leading-5 text-white ring-2 ring-surface">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </Link>
              <AccountMenu me={me} profileHref={profileHref} isActive={isActive} />
            </>
          ) : (
            <>
              <Button href={`/login?next=${encodeURIComponent(pathname)}`} variant="secondary">
                Log in
              </Button>
              <Button href="/register">Sign up</Button>
            </>
          )}
        </div>
      </header>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line/70 bg-sand/85 px-4 backdrop-blur md:hidden">
        <Link href="/home">
          <Logo />
        </Link>
        <Link href="/saved" aria-label="Saved" className="flex size-10 items-center justify-center rounded-xl text-ink-2">
          <Bookmark className="size-5" />
        </Link>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className={cx("w-full focus:outline-none", fullBleed ? "pb-28 md:pb-0" : "mx-auto max-w-6xl px-4 pb-28 pt-4 md:px-8 md:pb-16 md:pt-8")}
      >
        {me && !me.emailVerified && (
          <div className={cx(fullBleed && "px-4 pt-4 md:px-7")}>
            <VerifyEmailBanner email={me.email} />
          </div>
        )}
        {needsAuth && !me ? <PageLoader /> : children}
      </main>

      {/* Mobile bottom nav: Home · Explore · Trips · Create · Notifications · Profile */}
      <nav
        aria-label="Tab bar"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {[
          { href: "/home", label: "Home", icon: Home },
          { href: "/explore", label: "Explore", icon: Compass },
          { href: "/trips", label: "Trips", icon: Luggage },
        ].map(({ href, label, icon: Icon }) => (
          <MobileTab key={href} href={href} label={label} active={isActive(href)}>
            <Icon className="size-[22px]" strokeWidth={isActive(href) ? 2.4 : 1.8} />
          </MobileTab>
        ))}
        <button onClick={() => (me ? setCreateOpen(true) : router.push("/login"))} className="flex flex-col items-center justify-center py-2" aria-label="Create">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-white shadow-md">
            <PlusCircle className="size-5" />
          </span>
        </button>
        <MobileTab href="/notifications" label="Alerts" a11yLabel={unread ? `Notifications, ${unread} unread` : "Notifications"} active={isActive("/notifications")}>
          <span className="relative">
            <Bell className="size-[22px]" strokeWidth={isActive("/notifications") ? 2.4 : 1.8} />
            {!!unread && <span className="absolute -right-1.5 -top-1 size-2.5 rounded-full bg-accent ring-2 ring-surface" />}
          </span>
        </MobileTab>
        <MobileTab href={profileHref} label="Profile" active={isActive("/u/")}>
          {me ? <Avatar user={me} size={24} /> : <UserRound className="size-[22px]" />}
        </MobileTab>
      </nav>

      <CreateSheet open={createOpen} onClose={() => setCreateOpen(false)} />
      <DemoSwitcher />
    </div>
  );
}

function MobileTab({ href, label, a11yLabel, active, children }: { href: string; label: string; a11yLabel?: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-label={a11yLabel}
      aria-current={active ? "page" : undefined}
      className={cx("flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-primary" : "text-muted")}
    >
      {children}
      {label}
    </Link>
  );
}

/** Global search: jumps to Explore with the query (Explore shows trips, places, people and destinations). */
function NavSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      role="search"
      className="relative hidden max-w-[420px] flex-1 lg:block"
      onSubmit={(e) => {
        e.preventDefault();
        const v = q.trim();
        router.push(v ? `/explore?q=${encodeURIComponent(v)}` : "/explore");
      }}
    >
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        aria-label="Search TRIPLY"
        placeholder="Search places, trips and people"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        maxLength={100}
        className="h-10 w-full rounded-xl border border-line bg-sand pl-10 pr-3 text-sm text-ink placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </form>
  );
}

/** Avatar button → account links (profile, saved, settings, admin) and log out. */
function AccountMenu({ me, profileHref, isActive }: { me: Me; profileHref: string; isActive: (href: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const router = useRouter();
  const pathname = usePathname();
  const { logout } = useSession();
  // Close on navigation, outside click and Escape (focus returns to the avatar).
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const links = [
    { href: profileHref, label: "Profile", icon: UserRound },
    { href: "/saved", label: "Saved", icon: Bookmark },
    { href: "/settings", label: "Settings", icon: Settings },
    ...(me.isAdmin ? [{ href: "/admin", label: "Admin", icon: ShieldCheck }] : []),
  ];
  const item = "flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-2 hover:bg-sand-2 hover:text-ink";
  return (
    <div ref={ref} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={`Account: ${me.displayName}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center gap-1 rounded-xl pl-0.5 pr-1.5 text-muted hover:bg-sand-2"
      >
        <Avatar user={me} size={36} />
        <ChevronDown className="size-4" aria-hidden />
      </button>
      {open && (
        <div id={panelId} className="animate-rise absolute right-0 top-full z-50 mt-2 w-60 rounded-2xl border border-line bg-surface p-1.5 shadow-pop">
          <div className="border-b border-line px-2.5 pb-2.5 pt-1.5">
            <div className="truncate text-sm font-semibold">{me.displayName}</div>
            <div className="truncate font-mono text-xs text-muted">@{me.username}</div>
          </div>
          <nav aria-label="Account" className="pt-1.5">
            {links.map(({ href, label, icon: Icon }) => (
              <Link key={label} href={href} aria-current={isActive(href) ? "page" : undefined} className={cx(item, isActive(href) && "bg-sand-2 text-ink")}>
                <Icon className="size-4" aria-hidden /> {label}
              </Link>
            ))}
          </nav>
          <div className="mt-1.5 border-t border-line pt-1.5">
            <button
              type="button"
              className={item}
              onClick={async () => {
                setOpen(false);
                await logout();
                router.push("/login");
              }}
            >
              <LogOut className="size-4" aria-hidden /> Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

