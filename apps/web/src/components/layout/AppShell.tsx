"use client";

import {
  Bell,
  Bookmark,
  Compass,
  Home,
  Luggage,
  PlusCircle,
  Settings,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMe, useUnreadCount } from "@/lib/api/queries";
import { useNotificationStream } from "@/lib/realtime";
import { Avatar, Button, PageLoader, cx } from "../ui";
import { CreateSheet } from "./CreateSheet";
import { DemoSwitcher } from "./DemoSwitcher";
import { Logo } from "./Logo";
import { VerifyEmailBanner } from "./VerifyEmailBanner";

const PROTECTED = ["/trips", "/trips/new", "/saved", "/notifications", "/settings", "/posts/new"];
const PROTECTED_PREFIX = ["/invitations/", "/trips/new"];

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

  const desktop = [
    { href: "/home", label: "Home", icon: Home },
    { href: "/explore", label: "Explore", icon: Compass },
    { href: "/trips", label: "Trips", icon: Luggage },
    { href: "/saved", label: "Saved", icon: Bookmark },
    { href: "/notifications", label: "Notifications", icon: Bell, badge: unread },
    { href: profileHref, label: "Profile", icon: UserRound },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-dvh md:pl-64">
      <a
        href="#main"
        className="sr-only z-[60] rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface/80 px-4 py-6 backdrop-blur md:flex">
        <Link href="/home" className="mb-8 px-2">
          <Logo />
        </Link>
        <nav className="flex flex-1 flex-col gap-1" aria-label="Sidebar">
          {desktop.map(({ href, label, icon: Icon, badge }) => (
            <Link
              key={label}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              aria-label={badge ? `${label}, ${badge} unread` : undefined}
              className={cx(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors",
                isActive(href) ? "bg-lagoon-50 text-lagoon" : "text-ink-2 hover:bg-sand-2",
              )}
            >
              <Icon className="size-5" strokeWidth={isActive(href) ? 2.4 : 1.8} />
              {label}
              {!!badge && (
                <span aria-hidden className="ml-auto rounded-full bg-sunset-700 px-2 text-xs font-bold text-white">
                  {badge}
                </span>
              )}
            </Link>
          ))}
          <Button className="mt-4" size="lg" onClick={() => (me ? setCreateOpen(true) : router.push("/login"))}>
            <PlusCircle className="size-5" /> Create
          </Button>
        </nav>
        {me ? (
          <Link href={profileHref} className="flex items-center gap-3 rounded-xl p-2 hover:bg-sand-2">
            <Avatar user={me} size={36} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{me.displayName}</div>
              <div className="truncate text-xs text-muted">@{me.username}</div>
            </div>
          </Link>
        ) : (
          <Button href="/login" variant="secondary">
            Log in
          </Button>
        )}
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line/70 bg-sand/85 px-4 backdrop-blur md:hidden">
        <Link href="/home">
          <Logo />
        </Link>
        <Link href="/saved" aria-label="Saved" className="flex size-10 items-center justify-center rounded-full text-ink-2">
          <Bookmark className="size-5" />
        </Link>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 pb-28 pt-4 focus:outline-none md:px-8 md:pb-16 md:pt-8">
        {me && !me.emailVerified && <VerifyEmailBanner email={me.email} />}
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
          <span className="flex size-10 items-center justify-center rounded-2xl bg-lagoon text-white shadow-md">
            <PlusCircle className="size-5" />
          </span>
        </button>
        <MobileTab href="/notifications" label="Alerts" a11yLabel={unread ? `Notifications, ${unread} unread` : "Notifications"} active={isActive("/notifications")}>
          <span className="relative">
            <Bell className="size-[22px]" strokeWidth={isActive("/notifications") ? 2.4 : 1.8} />
            {!!unread && <span className="absolute -right-1.5 -top-1 size-2.5 rounded-full bg-sunset ring-2 ring-surface" />}
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
      className={cx("flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-lagoon" : "text-muted")}
    >
      {children}
      {label}
    </Link>
  );
}
