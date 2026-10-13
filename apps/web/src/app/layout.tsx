import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/layout/Toaster";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TRIPLY — Plan together. Discover together. Travel together.", template: "%s · TRIPLY" },
  description: "A social travel planning platform that turns real travelers' trips into reusable, collaborative travel plans.",
};

export const viewport: Viewport = { themeColor: "#f3efe6", width: "device-width", initialScale: 1 };

// Atlas type: Be Vietnam Pro for UI (static font, so weights are explicit), Bricolage Grotesque
// for display (variable, optical size), JetBrains Mono for times and distances.
const sans = Be_Vietnam_Pro({ weight: ["400", "500", "600", "700"], subsets: ["latin", "latin-ext", "vietnamese"], display: "swap", variable: "--font-be-vietnam" });
const display = Bricolage_Grotesque({ subsets: ["latin", "latin-ext", "vietnamese"], axes: ["opsz"], display: "swap", variable: "--font-bricolage" });
const mono = JetBrains_Mono({ subsets: ["latin", "latin-ext", "vietnamese"], display: "swap", variable: "--font-jetbrains" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
