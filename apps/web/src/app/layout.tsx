import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/layout/Toaster";
import { getLocale, getMessages } from "@/i18n/server";
import { THEME_SCRIPT } from "@/lib/theme";
import { Providers } from "./providers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = (await getMessages()).titles;
  return { title: { default: t.default, template: "%s · TRIPLY" }, description: t.description };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3efe6" },
    { media: "(prefers-color-scheme: dark)", color: "#15130f" },
  ],
  width: "device-width",
  initialScale: 1,
};

// Atlas type: Be Vietnam Pro for UI (static font, so weights are explicit), Bricolage Grotesque
// for display (variable, optical size), JetBrains Mono for times and distances.
const sans = Be_Vietnam_Pro({ weight: ["400", "500", "600", "700"], subsets: ["latin", "latin-ext", "vietnamese"], display: "swap", variable: "--font-be-vietnam" });
const display = Bricolage_Grotesque({ subsets: ["latin", "latin-ext", "vietnamese"], axes: ["opsz"], display: "swap", variable: "--font-bricolage" });
const mono = JetBrains_Mono({ subsets: ["latin", "latin-ext", "vietnamese"], display: "swap", variable: "--font-jetbrains" });

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    // data-theme is set by THEME_SCRIPT before paint, so the server markup can't know it.
    <html lang={locale} suppressHydrationWarning className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers locale={locale}>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
