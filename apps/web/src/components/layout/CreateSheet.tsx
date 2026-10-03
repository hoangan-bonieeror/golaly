"use client";

import { Luggage, PenLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { Sheet } from "../ui";

export function CreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Create">
      <div className="grid gap-3">
        <button onClick={() => go("/trips/new")} className="flex items-center gap-4 rounded-2xl border border-line p-4 text-left hover:border-primary hover:bg-primary-50/50">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-white">
            <Luggage className="size-6" />
          </span>
          <span>
            <span className="block font-semibold">New trip</span>
            <span className="block text-sm text-muted">Plan days, add places, invite your crew.</span>
          </span>
        </button>
        <button onClick={() => go("/posts/new")} className="flex items-center gap-4 rounded-2xl border border-line p-4 text-left hover:border-accent hover:bg-accent-50/50">
          <span className="flex size-12 items-center justify-center rounded-xl bg-accent text-white">
            <PenLine className="size-6" />
          </span>
          <span>
            <span className="block font-semibold">New post</span>
            <span className="block text-sm text-muted">Turn a trip into a story others can reuse.</span>
          </span>
        </button>
      </div>
    </Sheet>
  );
}
