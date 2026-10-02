"use client";

import { ROLE_LABEL, type TripRole, type UUID } from "@triply/shared";
import { Check, Copy, Link2, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store/store";
import { Button, Field, Sheet, Tabs, cx, inputCls } from "../ui";

type InvRole = Exclude<TripRole, "OWNER">;

export function InviteSheet({ open, onClose, tripId }: { open: boolean; onClose: () => void; tripId: UUID }) {
  const { actions, toast } = useStore();
  const [mode, setMode] = useState<"email" | "link">("email");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvRole>("EDITOR");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail("");
      setLink(null);
      setCopied(false);
    }
  }, [open]);

  const sendEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const inv = actions.createInvitation(tripId, { email, role });
    if (!inv) return;
    toast(`Invite sent to ${inv.email}`);
    onClose();
  };

  const makeLink = () => {
    const inv = actions.createInvitation(tripId, { role });
    if (inv) setLink(`${window.location.origin}/invite/${inv.token}`);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Invite to trip">
      <Tabs
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

      {mode === "email" ? (
        <form onSubmit={sendEmail} className="mt-5 space-y-4">
          <Field label="Email address" hint="Tip: in the demo, try minh@, sarah@ or nam@triply.dev — they get an in-app notification.">
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="friend@example.com" />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={!email}>
            Send invite
          </Button>
        </form>
      ) : (
        <div className="mt-5 space-y-3">
          {link ? (
            <>
              <div className="flex items-center gap-2 rounded-xl border border-line bg-sand p-2 pl-3">
                <code className="min-w-0 flex-1 truncate text-xs">{link}</code>
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
                Anyone with this link can join as {ROLE_LABEL[role].toLowerCase()}. It expires in 7 days and you can revoke it anytime in Members.
              </p>
            </>
          ) : (
            <Button size="lg" className="w-full" onClick={makeLink}>
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
          role="radio"
          aria-checked={role === o.value}
          onClick={() => setRole(o.value)}
          className={cx("rounded-2xl border p-3 text-left", role === o.value ? "border-lagoon bg-lagoon-50" : "border-line hover:border-ink-2")}
        >
          <div className={cx("text-sm font-semibold", role === o.value && "text-lagoon")}>{o.title}</div>
          <div className="mt-0.5 text-xs text-muted">{o.body}</div>
        </button>
      ))}
    </div>
  );
}
