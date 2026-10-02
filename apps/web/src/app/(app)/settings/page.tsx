"use client";

import { LogOut, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, Button, Field, cx, inputCls } from "@/components/ui";
import { useMe, useStore } from "@/lib/store/store";

export default function SettingsPage() {
  const user = useMe();
  const { actions, toast, signOut, resetDemo } = useStore();
  const router = useRouter();
  const [form, setForm] = useState({ displayName: "", bio: "", homeBase: "" });

  useEffect(() => {
    if (user) setForm({ displayName: user.displayName, bio: user.bio, homeBase: user.homeBase ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!user)
    return (
      <div className="mx-auto max-w-md text-center">
        <p className="mb-4 text-muted">Log in to manage your account.</p>
        <Button href="/login">Log in</Button>
      </div>
    );

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <h1 className="font-display text-3xl font-semibold md:text-4xl">Settings</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (actions.updateProfile(form)) toast("Profile saved");
        }}
        className="space-y-5 rounded-[var(--radius-card)] border border-line bg-surface p-5"
      >
        <div className="flex items-center gap-4">
          <Avatar user={user} size={64} />
          <Button type="button" variant="secondary" size="sm" onClick={() => toast("Avatar upload arrives with media storage (Week 7)")}>
            Change photo
          </Button>
        </div>
        <Field label="Display name">
          <input className={inputCls} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </Field>
        <Field label="Username" hint="Usernames can't be changed in the MVP.">
          <input className={cx(inputCls, "bg-sand text-muted")} value={`@${user.username}`} disabled />
        </Field>
        <Field label="Bio" hint={`${form.bio.length}/160`}>
          <textarea className={cx(inputCls, "h-20 py-2.5")} maxLength={160} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
        </Field>
        <Field label="Home base">
          <input className={inputCls} value={form.homeBase} onChange={(e) => setForm({ ...form, homeBase: e.target.value })} />
        </Field>
        <Button type="submit">Save profile</Button>
      </form>

      <section className="space-y-2">
        <Button
          variant="secondary"
          className="w-full justify-start"
          onClick={() => {
            signOut();
            router.push("/welcome");
          }}
        >
          <LogOut className="size-4" /> Log out
        </Button>
        <Button variant="secondary" className="w-full justify-start" onClick={resetDemo}>
          <RotateCcw className="size-4" /> Reset prototype demo data
        </Button>
        <Button variant="danger" className="w-full justify-start" onClick={() => toast("Account deletion is handled by the API (soft delete + data export) — not in this prototype")}>
          <Trash2 className="size-4" /> Delete account
        </Button>
      </section>
    </div>
  );
}
