import Link from "next/link";
import { AtlasHero, pickJourney } from "@/components/art/AtlasHero";
import { Logo } from "@/components/layout/Logo";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/Preferences";
import { getLocale, getMessages } from "@/i18n/server";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const [t, locale] = await Promise.all([getMessages(), getLocale()]);
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* A hand-drawn map inks in a different journey on each visit. */}
      <aside className="relative hidden overflow-hidden border-r border-line bg-map lg:block">
        <AtlasHero journey={pickJourney()} locale={locale} />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-[42%] bg-gradient-to-t from-sand via-sand/85 to-transparent" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Link href="/" className="self-start">
            <Logo />
          </Link>
          <div className="max-w-md">
            <p className="font-display text-4xl font-semibold leading-tight text-ink">{t.auth.layout.heroTitle}</p>
            <p className="mt-4 text-ink-2">{t.auth.layout.heroBody}</p>
          </div>
        </div>
      </aside>
      <main className="flex flex-col px-6 py-8 md:px-12">
        <Link href="/" className="mb-10 self-start lg:hidden">
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
