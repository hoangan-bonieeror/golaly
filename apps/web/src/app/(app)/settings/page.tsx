"use client";

import { localizeMessage, passwordSchema, updateProfileSchema, type MediaView, type Me } from "@triply/shared";
import { Camera, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/Preferences";
import { Avatar, Button, Field, PageLoader, Sheet, cx, inputCls } from "@/components/ui";
import { useI18n, useT } from "@/i18n/client";
import { api, ApiError } from "@/lib/api/client";
import { keys, useAction, useMe } from "@/lib/api/queries";
import { getPlaceNameChoice, PLACE_NAME_OPTIONS, setPlaceNameChoice, type PlaceNameChoice } from "@/lib/placeLanguage";
import { useSession } from "@/lib/session";

export default function SettingsPage() {
  const me = useMe().data;
  if (!me) return <PageLoader />;
  // Keyed by user: the form starts from that user's saved values (no effect-driven reset).
  return <Settings key={me.id} me={me} />;
}

function Settings({ me }: { me: Me }) {
  const { logout } = useSession();
  const router = useRouter();
  const { locale, m: t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ displayName: me.displayName, bio: me.bio, homeBase: me.homeBase ?? "" });
  const [error, setError] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [deleteError, setDeleteError] = useState<string>();

  const save = useAction((body: object) => api.patch<Me>("/users/me", body), { invalidate: [keys.me, ["profile"]], success: t.settings.profileSaved });
  const avatar = useAction(
    async (file: File) => {
      const m = await api.upload<MediaView>("/media", file);
      return api.patch<Me>("/users/me", { avatarMediaId: m.id });
    },
    { invalidate: [keys.me, ["profile"], ["feed"]], success: t.settings.photoUpdated },
  );

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <h1 className="font-display text-3xl font-semibold md:text-4xl">{t.settings.title}</h1>

      <PreferencesCard />

      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const body = { ...form, homeBase: form.homeBase.trim() };
          const parsed = updateProfileSchema.safeParse(body);
          if (!parsed.success) {
            const msg = parsed.error.issues[0]?.message;
            return setError(msg && localizeMessage(msg, locale));
          }
          setError(undefined);
          await save.run(body);
        }}
        className="space-y-5 rounded-[var(--radius-card)] border border-line bg-surface p-5"
      >
        <div className="flex items-center gap-4">
          <Avatar user={me} size={64} />
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label={t.settings.uploadPhoto}
            tabIndex={-1}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void avatar.run(f);
            }}
          />
          <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={avatar.isPending}>
            <Camera className="size-4" /> {avatar.isPending ? t.settings.uploading : t.settings.changePhoto}
          </Button>
        </div>
        <Field label={t.settings.displayName} error={error}>
          <input className={inputCls} value={form.displayName} maxLength={50} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </Field>
        <Field label={t.settings.username} hint={t.settings.usernameHint}>
          <input className={cx(inputCls, "bg-sand text-muted")} value={`@${me.username}`} disabled />
        </Field>
        <Field label={t.settings.email}>
          <input className={cx(inputCls, "bg-sand text-muted")} value={me.email} disabled />
        </Field>
        <Field label={t.settings.bio} hint={t.settings.bioCount(form.bio.length, 160)}>
          <textarea className={cx(inputCls, "h-20 py-2.5")} maxLength={160} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
        </Field>
        <Field label={t.settings.homeBase}>
          <input className={inputCls} value={form.homeBase} maxLength={80} onChange={(e) => setForm({ ...form, homeBase: e.target.value })} />
        </Field>
        <Button type="submit" disabled={save.isPending}>
          {t.settings.saveProfile}
        </Button>
      </form>

      <PlaceNamesCard />

      <SuggestionsCard consent={me.analyticsConsent} />

      <PasswordCard hasPassword={me.hasPassword} providers={me.providers} />

      <section className="space-y-2">
        {me.isAdmin && (
          <Button variant="secondary" className="w-full justify-start" href="/admin">
            <ShieldCheck className="size-4" /> {t.settings.admin}
          </Button>
        )}
        <Button
          variant="secondary"
          className="w-full justify-start"
          onClick={async () => {
            await logout();
            router.push("/welcome");
          }}
        >
          <LogOut className="size-4" /> {t.common.logOut}
        </Button>
        <Button variant="danger" className="w-full justify-start" onClick={() => setDeleting(true)}>
          <Trash2 className="size-4" /> {t.settings.deleteAccount}
        </Button>
      </section>

      <Sheet open={deleting} onClose={() => setDeleting(false)} title={t.settings.deleteSheet.title}>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.delete("/users/me", me.hasPassword ? { password } : { username: password });
              await logout();
              router.push("/welcome");
            } catch (err) {
              setDeleteError(err instanceof ApiError ? err.message : t.common.errors.generic);
            }
          }}
        >
          <p className="text-sm text-ink-2">
            {t.settings.deleteSheet.body}
          </p>
          {me.hasPassword ? (
            <Field label={t.settings.deleteSheet.confirmPassword} error={deleteError}>
              <input className={inputCls} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          ) : (
            <Field label={t.settings.deleteSheet.confirmUsername(me.username)} error={deleteError}>
              <input className={inputCls} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          <Button type="submit" className="w-full !bg-danger" disabled={!password}>
            {t.settings.deleteSheet.submit}
          </Button>
        </form>
      </Sheet>
    </div>
  );
}

function PasswordCard({ hasPassword, providers }: { hasPassword: boolean; providers: string[] }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string>();
  const { locale, m: t } = useI18n();
  const change = useAction((body: object) => api.post("/auth/password", body), {
    invalidate: [keys.me],
    success: hasPassword ? t.settings.password.changed : t.settings.password.setDone,
    silentErrors: true,
  });
  return (
    <form
      noValidate
      className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = passwordSchema.safeParse(next);
        if (!parsed.success) {
          const msg = parsed.error.issues[0]?.message;
          return setError(msg && localizeMessage(msg, locale));
        }
        setError(undefined);
        try {
          await change.mutateAsync(hasPassword ? { currentPassword: current, newPassword: next } : { newPassword: next });
          setCurrent("");
          setNext("");
        } catch (err) {
          setError(err instanceof ApiError ? err.message : t.common.errors.generic);
        }
      }}
    >
      <div>
        <h2 className="font-semibold">{hasPassword ? t.settings.password.change : t.settings.password.set}</h2>
        <p className="text-sm text-muted">
          {providers.includes("google") ? `${t.settings.password.googleConnected} ` : ""}
          {hasPassword ? t.settings.password.changeBody : t.settings.password.setBody}
        </p>
      </div>
      {hasPassword && (
        <Field label={t.settings.password.current}>
          <input className={inputCls} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
      )}
      <Field label={t.settings.password.new} hint={t.settings.password.hint} error={error}>
        <input className={inputCls} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Button type="submit" variant="secondary" disabled={!next || change.isPending}>
        {hasPassword ? t.settings.password.change : t.settings.password.setButton}
      </Button>
    </form>
  );
}

/** Appearance and interface language (both apply instantly; the language is also saved to the account). */
function PreferencesCard() {
  const t = useT().settings;
  return (
    <section className="space-y-5 rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <div className="space-y-3">
        <div>
          <h2 className="font-display text-xl font-semibold">{t.appearance.title}</h2>
          <p className="text-sm text-muted">{t.appearance.hint}</p>
        </div>
        <ThemeSwitch />
      </div>
      <div className="space-y-3">
        <div>
          <h2 className="font-display text-xl font-semibold">{t.language.title}</h2>
          <p className="text-sm text-muted">{t.language.hint}</p>
        </div>
        <LanguageSwitch />
      </div>
    </section>
  );
}

/** Which language place names appear in (stored on this device). */
function PlaceNamesCard() {
  const qc = useQueryClient();
  const t = useT().settings.placeNames;
  const [choice, setChoice] = useState<PlaceNameChoice>(() => getPlaceNameChoice());
  return (
    <section className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <h2 className="font-display text-xl font-semibold">{t.title}</h2>
      <Field label={t.label} hint={t.hint}>
        <select
          className={inputCls}
          value={choice}
          onChange={(e) => {
            const v = e.target.value as PlaceNameChoice;
            setChoice(v);
            setPlaceNameChoice(v);
            void qc.invalidateQueries(); // every list with places refetches in the new language
          }}
        >
          {PLACE_NAME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t.options[o.labelKey]}
            </option>
          ))}
        </select>
      </Field>
    </section>
  );
}

/** Opt-in: may this person's trip activity (the plan's event log) be used to improve suggestions? */
function SuggestionsCard({ consent }: { consent: boolean }) {
  const t = useT().settings.suggestions;
  const save = useAction((on: boolean) => api.patch<Me>("/users/me", { analyticsConsent: on }), { invalidate: [keys.me], success: (me) => (me.analyticsConsent ? t.on : t.off) });
  return (
    <section className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <h2 className="font-display text-xl font-semibold">{t.title}</h2>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--color-primary)]" checked={consent} disabled={save.isPending} onChange={(e) => save.run(e.target.checked)} />
        <span>
          <span className="block font-medium">{t.label}</span>
          <span className="mt-0.5 block text-sm text-muted">{t.hint}</span>
        </span>
      </label>
    </section>
  );
}
