"use client";

import { emailSchema, type CreatedInvitation, type TripRole } from "@triply/shared";
import { Check, Copy, Link2, Mail } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { keys, useAction } from "@/lib/api/queries";
import { Button, Field, Sheet, Tabs, cx, inputCls } from "../ui";

type InvRole = Exclude<TripRole, "OWNER">;

type Props = { open: boolean; onClose: () => void; tripId: string };

/** Mounted only while open, so every opening starts with a clean form. */
export function InviteSheet(props: Props) {
  return props.open ? <InviteSheetBody {...props} /> : null;
}

function InviteSheetBody({ open, onClose, tripId }: Props) {
  const t = useT();
  const tv = t.trips.invite;
  const [mode, setMode] = useState<"email" | "link">("email");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvRole>("EDITOR");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const invite = useAction((body: { email?: string; role: InvRole }) => api.post<CreatedInvitation>(`/trips/${tripId}/invitations`, body), { invalidate: [keys.trip(tripId)] });

  const sendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return setError(tv.badEmail);
    const inv = await invite.run({ email: parsed.data, role });
    if (!inv) return;
    setMode("link");
    setLink(inv.url);
  };

  const makeLink = async () => {
    const inv = await invite.run({ role });
    if (inv) setLink(inv.url);
  };

  return (
    <Sheet open={open} onClose={onClose} title={tv.title}>
      <Tabs
        id="invite-tabs"
        label={tv.inviteBy}
        value={mode}
        onChange={(m) => {
          setMode(m);
          setLink(null);
        }}
        tabs={[
          { value: "email", label: (<><Mail className="size-4" /> {tv.email}</>) },
          { value: "link", label: (<><Link2 className="size-4" /> {tv.link}</>) },
        ]}
        className="mb-5"
      />

      <RolePicker role={role} setRole={setRole} />

      {mode === "email" && !link ? (
        <form onSubmit={sendEmail} className="mt-5 space-y-4" noValidate>
          <Field label={tv.emailLabel} error={error} hint={tv.emailHint}>
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={tv.emailPlaceholder} />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={!email || invite.isPending}>
            {tv.send}
          </Button>
        </form>
      ) : (
        <div className="mt-5 space-y-3">
          {link ? (
            <>
              <div className="flex items-center gap-2 rounded-xl border border-line bg-sand p-2 pl-3">
                <code className="min-w-0 flex-1 truncate text-xs" data-testid="invite-link">
                  {link}
                </code>
                <Button
                  size="sm"
                  variant={copied ? "secondary" : "primary"}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(link);
                    } catch {}
                    setCopied(true);
                  }}
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? t.common.copied : tv.copy}
                </Button>
              </div>
              <p className="text-xs text-muted">
                {mode === "email"
                  ? tv.sentNote(email)
                  : tv.linkNote(t.labels.role[role])}
              </p>
            </>
          ) : (
            <Button size="lg" className="w-full" onClick={makeLink} disabled={invite.isPending}>
              {tv.createLink}
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}

function RolePicker({ role, setRole }: { role: InvRole; setRole: (r: InvRole) => void }) {
  const t = useT();
  const opts: { value: InvRole; title: string; body: string }[] = [
    { value: "EDITOR", title: t.labels.role.EDITOR, body: t.trips.invite.editorBody },
    { value: "VIEWER", title: t.labels.role.VIEWER, body: t.trips.invite.viewerBody },
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label={t.trips.invite.role}>
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={role === o.value}
          onClick={() => setRole(o.value)}
          className={cx("rounded-2xl border p-3 text-left", role === o.value ? "border-primary bg-primary-50" : "border-line hover:border-ink-2")}
        >
          <div className={cx("text-sm font-semibold", role === o.value && "text-primary")}>{o.title}</div>
          <div className="mt-0.5 text-xs text-muted">{o.body}</div>
        </button>
      ))}
    </div>
  );
}
