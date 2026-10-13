import { titleFor } from "@/i18n/server";

// Per-route <title> (pages are client components, so metadata lives in this server layout).
export const generateMetadata = titleFor("explore");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
