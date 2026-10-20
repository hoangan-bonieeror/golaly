"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LOCALE_NAMES, LOCALES, type Locale, type Me } from "@golaly/shared";
import { Monitor, Moon, Sun } from "lucide-react";
import { useI18n, useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { keys, useMe } from "@/lib/api/queries";
import { useTheme, type ThemePref } from "@/lib/theme";
import { cx } from "../ui";

/**
 * Segmented radio group (WAI-ARIA radio pattern: one tab stop, arrows move and select).
 * Used for the theme and language switches in the account menu, Settings and the auth pages.
 */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  compact,
}: {
  label: string;
  value: T;
  options: { value: T; label: React.ReactNode; title?: string; lang?: string }[];
  onChange: (v: T) => void;
  compact?: boolean;
}) {
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = options.length;
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + n) % n : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].value);
    (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cx("grid gap-1 rounded-xl bg-sand-2 p-1", compact ? "text-[13px]" : "text-sm")} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            title={o.title}
            lang={o.lang}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              "flex items-center justify-center gap-1.5 rounded-[9px] font-semibold transition-colors",
              compact ? "h-8 px-2" : "h-10 px-3",
              on ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ThemeSwitch({ compact }: { compact?: boolean }) {
  const t = useT().nav.theme;
  const { pref, setPref } = useTheme();
  const icon = "size-4 shrink-0";
  return (
    <Segmented<ThemePref>
      label={t.label}
      value={pref}
      onChange={setPref}
      compact={compact}
      options={[
        { value: "system", label: (<><Monitor className={icon} aria-hidden /> {t.system}</>) },
        { value: "light", label: (<><Sun className={icon} aria-hidden /> {t.light}</>) },
        { value: "dark", label: (<><Moon className={icon} aria-hidden /> {t.dark}</>) },
      ]}
    />
  );
}

/** Language names are always written in their own language, so anyone can find theirs. */
export function LanguageSwitch({ compact }: { compact?: boolean }) {
  const { locale, setLocale, m } = useI18n();
  const me = useMe().data;
  const qc = useQueryClient();
  const change = (l: Locale) => {
    setLocale(l);
    // Signed in: remember it on the account too, so other devices and emails follow.
    if (me && me.locale !== l)
      void api
        .patch<Me>("/users/me", { locale: l })
        .then((updated) => qc.setQueryData(keys.me, updated))
        .catch(() => undefined);
  };
  return (
    <Segmented<Locale>
      label={m.nav.language.label}
      value={locale}
      onChange={change}
      compact={compact}
      options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l], lang: l }))}
    />
  );
}
