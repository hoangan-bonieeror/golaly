import { titleFor } from "@/i18n/server";

// Per-route <title> (pages are client components, so metadata lives in this server layout).
export const generateMetadata = titleFor("forgotPassword");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
