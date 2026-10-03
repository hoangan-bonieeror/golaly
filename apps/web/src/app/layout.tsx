import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import { Toaster } from "@/components/layout/Toaster";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TRIPLY — Plan together. Discover together. Travel together.", template: "%s · TRIPLY" },
  description: "A social travel planning platform that turns real travelers' trips into reusable, collaborative travel plans.",
};

export const viewport: Viewport = { themeColor: "#f6eee2", width: "device-width", initialScale: 1 };

const fraunces = Fraunces({ subsets: ["latin", "latin-ext", "vietnamese"], axes: ["SOFT", "WONK", "opsz"], display: "swap", variable: "--font-fraunces" });
const inter = Inter({ subsets: ["latin", "latin-ext", "vietnamese"], display: "swap", variable: "--font-inter" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
