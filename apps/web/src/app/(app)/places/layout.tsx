import { titleFor } from "@/i18n/server";

// Fallback title; the page sets the place's own name once it has loaded.
export const generateMetadata = titleFor("places");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
