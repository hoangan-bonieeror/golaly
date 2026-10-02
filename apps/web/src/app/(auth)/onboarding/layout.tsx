import type { Metadata } from "next";

// Per-route <title> (pages are client components, so metadata lives in this server layout).
export const metadata: Metadata = { title: "Welcome aboard" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
