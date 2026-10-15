"use client";

import { BarChart3, Boxes, CalendarClock, Copy, Globe2, Image as ImageIcon, MapPin, ShieldAlert, Tags } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { EmptyState, PageLoader, cx } from "@/components/ui";
import { useMe } from "@/lib/api/queries";

const NAV = [
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin", label: "Areas", icon: Globe2, exact: true },
  { href: "/admin/jobs", label: "Sync jobs", icon: CalendarClock },
  { href: "/admin/runs", label: "Runs", icon: Boxes },
  { href: "/admin/duplicates", label: "Duplicates", icon: Copy },
  { href: "/admin/places", label: "Places", icon: MapPin },
  { href: "/admin/categories", label: "Categories", icon: Tags },
  { href: "/admin/photos", label: "Photos", icon: ImageIcon },
];

/** Admin area: one role check for every screen, and a section nav that scrolls sideways on phones. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const pathname = usePathname();
  if (me.isLoading) return <PageLoader />;
  if (!me.data?.isAdmin) return <EmptyState level="h1" icon={<ShieldAlert className="size-7" />} title="Admins only" body="This part of TRIPLY is for the team that runs the catalog." />;
  return (
    <div className="space-y-6">
      <nav aria-label="Admin sections" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="flex w-max gap-1 rounded-2xl border border-line bg-surface p-1">
          {NAV.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                    active ? "bg-primary-50 text-primary" : "text-ink-2 hover:bg-sand-2",
                  )}
                >
                  <Icon className="size-4" aria-hidden /> {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {children}
    </div>
  );
}

/** Page heading used by every admin screen. */
export function AdminHeader({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-semibold md:text-4xl">{title}</h1>
        {body && <p className="mt-1 max-w-2xl text-sm text-muted">{body}</p>}
      </div>
      {action}
    </header>
  );
}
