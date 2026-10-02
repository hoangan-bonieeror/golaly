import type { Destination } from "@triply/shared";
import Link from "next/link";
import { cx } from "@/lib/utils";
import { Cover } from "./Cover";

export function DestinationTile({ dest, count, className }: { dest: Destination; count?: number; className?: string }) {
  return (
    <Link href={`/explore/${dest.slug}`} className={cx("group block", className)}>
      <Cover palette={dest.palette} seed={dest.id} className="aspect-[3/4] w-full transition-transform group-hover:scale-[1.02]">
        <div className="flex h-full flex-col justify-end p-3 text-white">
          <div className="font-display text-lg font-semibold leading-tight">{dest.name}</div>
          <div className="text-xs text-white/85">
            {dest.country}
            {count !== undefined && ` · ${count} ${count === 1 ? "trip" : "trips"}`}
          </div>
        </div>
      </Cover>
    </Link>
  );
}
