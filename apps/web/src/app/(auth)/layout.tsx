import Link from "next/link";
import { Cover } from "@/components/trip/Cover";
import { Logo } from "@/components/layout/Logo";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/Preferences";
import { getMessages } from "@/i18n/server";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getMessages();
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="relative hidden lg:block">
        <Cover palette={["#3b2214", "#c8742f"]} seed="auth-hero" rounded={false} className="absolute inset-0">
          <div className="flex h-full flex-col justify-between p-12 text-white">
            <Link href="/">
              <Logo light />
            </Link>
            <div className="max-w-md">
              <p className="font-display text-4xl font-semibold leading-tight">{t.auth.layout.heroTitle}</p>
              <p className="mt-4 text-white/85">{t.auth.layout.heroBody}</p>
            </div>
          </div>
        </Cover>
      </aside>
      <main className="flex flex-col px-6 py-8 md:px-12">
        <Link href="/" className="mb-10 lg:hidden">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">{children}</div>
        {/* Logged-out visitors can switch language and theme too. */}
        <div role="group" aria-label={t.auth.layout.preferences} className="mx-auto mt-8 grid w-full max-w-sm gap-2">
          <LanguageSwitch compact />
          <ThemeSwitch compact />
        </div>
      </main>
    </div>
  );
}
