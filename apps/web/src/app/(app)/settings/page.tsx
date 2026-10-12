"use client";

import { passwordSchema, updateProfileSchema, type MediaView, type Me } from "@triply/shared";
import { Camera, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Avatar, Button, Field, PageLoader, Sheet, cx, inputCls } from "@/components/ui";
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ displayName: me.displayName, bio: me.bio, homeBase: me.homeBase ?? "" });
  const [error, setError] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [deleteError, setDeleteError] = useState<string>();

  const save = useAction((body: object) => api.patch<Me>("/users/me", body), { invalidate: [keys.me, ["profile"]], success: "Profile saved" });
  const avatar = useAction(
    async (file: File) => {
      const m = await api.upload<MediaView>("/media", file);
      return api.patch<Me>("/users/me", { avatarMediaId: m.id });
    },
    { invalidate: [keys.me, ["profile"], ["feed"]], success: "Photo updated" },
  );

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <h1 className="font-display text-3xl font-semibold md:text-4xl">Settings</h1>

      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const body = { ...form, homeBase: form.homeBase.trim() };
          const parsed = updateProfileSchema.safeParse(body);
          if (!parsed.success) return setError(parsed.error.issues[0]?.message);
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
            aria-label="Upload a profile photo"
            tabIndex={-1}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void avatar.run(f);
            }}
          />
          <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={avatar.isPending}>
            <Camera className="size-4" /> {avatar.isPending ? "Uploading…" : "Change photo"}
          </Button>
        </div>
        <Field label="Display name" error={error}>
          <input className={inputCls} value={form.displayName} maxLength={50} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </Field>
        <Field label="Username" hint="Usernames can't be changed in the MVP.">
          <input className={cx(inputCls, "bg-sand text-muted")} value={`@${me.username}`} disabled />
        </Field>
        <Field label="Email">
          <input className={cx(inputCls, "bg-sand text-muted")} value={me.email} disabled />
        </Field>
        <Field label="Bio" hint={`${form.bio.length}/160`}>
          <textarea className={cx(inputCls, "h-20 py-2.5")} maxLength={160} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
        </Field>
        <Field label="Home base">
          <input className={inputCls} value={form.homeBase} maxLength={80} onChange={(e) => setForm({ ...form, homeBase: e.target.value })} />
        </Field>
        <Button type="submit" disabled={save.isPending}>
          Save profile
        </Button>
      </form>

      <PlaceNamesCard />

      <PasswordCard hasPassword={me.hasPassword} providers={me.providers} />

      <section className="space-y-2">
        {me.isAdmin && (
          <Button variant="secondary" className="w-full justify-start" href="/admin">
            <ShieldCheck className="size-4" /> Admin: catalog and moderation
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
          <LogOut className="size-4" /> Log out
        </Button>
        <Button variant="danger" className="w-full justify-start" onClick={() => setDeleting(true)}>
          <Trash2 className="size-4" /> Delete account
        </Button>
      </section>

      <Sheet open={deleting} onClose={() => setDeleting(false)} title="Delete your account?">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.delete("/users/me", me.hasPassword ? { password } : { username: password });
              await logout();
              router.push("/welcome");
            } catch (err) {
              setDeleteError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
            }
          }}
        >
          <p className="text-sm text-ink-2">
            This logs you out everywhere, removes you from shared trips and deletes your trips, posts and comments. Trips others remixed from yours stay with them.
          </p>
          {me.hasPassword ? (
            <Field label="Confirm with your password" error={deleteError}>
              <input className={inputCls} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          ) : (
            <Field label={`Type your username (${me.username}) to confirm`} error={deleteError}>
              <input className={inputCls} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          <Button type="submit" className="w-full !bg-danger" disabled={!password}>
            Delete my account
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
  const change = useAction((body: object) => api.post("/auth/password", body), {
    invalidate: [keys.me],
    success: hasPassword ? "Password changed — other devices were signed out" : "Password set",
    silentErrors: true,
  });
  return (
    <form
      noValidate
      className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = passwordSchema.safeParse(next);
        if (!parsed.success) return setError(parsed.error.issues[0]?.message);
        setError(undefined);
        try {
          await change.mutateAsync(hasPassword ? { currentPassword: current, newPassword: next } : { newPassword: next });
          setCurrent("");
          setNext("");
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
        }
      }}
    >
      <div>
        <h2 className="font-semibold">{hasPassword ? "Change password" : "Set a password"}</h2>
        <p className="text-sm text-muted">
          {providers.includes("google") ? "Google sign-in is connected. " : ""}
          {hasPassword ? "Changing it signs you out on other devices." : "Add a password so you can also log in with your email."}
        </p>
      </div>
      {hasPassword && (
        <Field label="Current password">
          <input className={inputCls} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
      )}
      <Field label="New password" hint="At least 8 characters." error={error}>
        <input className={inputCls} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Button type="submit" variant="secondary" disabled={!next || change.isPending}>
        {hasPassword ? "Change password" : "Set password"}
      </Button>
    </form>
  );
}

/** Which language place names appear in (stored on this device). */
function PlaceNamesCard() {
  const qc = useQueryClient();
  const [choice, setChoice] = useState<PlaceNameChoice>(() => getPlaceNameChoice());
  return (
    <section className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <h2 className="font-display text-xl font-semibold">Place names</h2>
      <Field label="Show place names in" hint="When a place has no name in that language, its local name is shown. Saved on this device.">
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
              {o.label}
            </option>
          ))}
        </select>
      </Field>
    </section>
  );
}
