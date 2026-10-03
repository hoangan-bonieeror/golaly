import type { Metadata } from "next";

// Fallback title; the page sets the place's own name once it has loaded.
export const metadata: Metadata = { title: "Place" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
