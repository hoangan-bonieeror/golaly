"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LogoMark } from "@/components/layout/Logo";
import { useMe } from "@/lib/api/queries";

/** Splash (spec §8). */
export default function Splash() {
  const router = useRouter();
  const me = useMe();

  // Go as soon as we know who's here — no artificial delay.
  useEffect(() => {
    if (!me.isLoading) router.replace(me.data ? "/home" : "/welcome");
  }, [me.isLoading, me.data, router]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-primary px-6 text-center text-white">
      <div className="animate-rise flex flex-col items-center">
        <LogoMark className="size-16" />
        <h1 className="mt-5 font-display text-5xl font-bold tracking-tight">TRIPLY</h1>
        <p className="mt-4 space-y-0.5 font-display text-lg leading-relaxed text-white/85">
          <span className="block">Plan together.</span>
          <span className="block">Discover together.</span>
          <span className="block text-[#f6c99a]">Travel together.</span>
        </p>
      </div>
    </main>
  );
}
