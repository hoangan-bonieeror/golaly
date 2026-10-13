"use client";

import { Luggage, PenLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { Sheet } from "../ui";

export function CreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const t = useT();
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  return (
    <Sheet open={open} onClose={onClose} title={t.nav.create}>
      <div className="grid gap-3">
        <button onClick={() => go("/trips/new")} className="flex items-center gap-4 rounded-2xl border border-line p-4 text-left hover:border-primary hover:bg-primary-50/50">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-on-primary">
            <Luggage className="size-6" />
          </span>
          <span>
            <span className="block font-semibold">{t.nav.createSheet.trip}</span>
            <span className="block text-sm text-muted">{t.nav.createSheet.tripHint}</span>
          </span>
        </button>
        <button onClick={() => go("/posts/new")} className="flex items-center gap-4 rounded-2xl border border-line p-4 text-left hover:border-accent hover:bg-accent-50/50">
          <span className="flex size-12 items-center justify-center rounded-xl bg-accent-600 text-white">
            <PenLine className="size-6" />
          </span>
          <span>
            <span className="block font-semibold">{t.nav.createSheet.post}</span>
            <span className="block text-sm text-muted">{t.nav.createSheet.postHint}</span>
          </span>
        </button>
      </div>
    </Sheet>
  );
}
