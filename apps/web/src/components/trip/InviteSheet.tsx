"use client";

import { ROLE_LABEL, emailSchema, type CreatedInvitation, type TripRole } from "@triply/shared";
import { Check, Copy, Link2, Mail } from "lucide-react";
import { useState } from "react";
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
    if (!parsed.success) return setError("That email doesn't look right.");
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
    <Sheet open={open} onClose={onClose} title="Invite to trip">
      <Tabs
        id="invite-tabs"
        label="Invite by"
        value={mode}
        onChange={(m) => {
          setMode(m);
          setLink(null);
        }}
        tabs={[
          { value: "email", label: (<><Mail className="size-4" /> Email</>) },
          { value: "link", label: (<><Link2 className="size-4" /> Invite link</>) },
        ]}
        className="mb-5"
      />

      <RolePicker role={role} setRole={setRole} />

      {mode === "email" && !link ? (
        <form onSubmit={sendEmail} className="mt-5 space-y-4" noValidate>
          <Field label="Email address" error={error} hint="They'll get an email, plus an in-app notification if they already use TRIPLY.">
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="friend@example.com" />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={!email || invite.isPending}>
            Send invite
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
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="text-xs text-muted">
                {mode === "email"
                  ? `Invite sent. This link only works for ${email}. It expires in 7 days.`
                  : `Anyone with this link can join as ${ROLE_LABEL[role].toLowerCase()}. It expires in 7 days and you can revoke it anytime in Members.`}
              </p>
            </>
          ) : (
            <Button size="lg" className="w-full" onClick={makeLink} disabled={invite.isPending}>
              Create invite link
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}

function RolePicker({ role, setRole }: { role: InvRole; setRole: (r: InvRole) => void }) {
  const opts: { value: InvRole; title: string; body: string }[] = [
    { value: "EDITOR", title: "Editor", body: "Can add, edit, reorder and remove itinerary items." },
    { value: "VIEWER", title: "Viewer", body: "Can see the trip but not change it." },
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Role">
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
