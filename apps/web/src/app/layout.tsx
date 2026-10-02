import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/layout/Toaster";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TRIPLY — Plan together. Discover together. Travel together.", template: "%s · TRIPLY" },
  description: "A social travel planning platform that turns real travelers' trips into reusable, collaborative travel plans.",
};

export const viewport: Viewport = { themeColor: "#f7f4ee", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
