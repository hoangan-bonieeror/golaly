"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LogoMark } from "@/components/layout/Logo";
import { useStore } from "@/lib/store/store";

/** Splash (spec §8). */
export default function Splash() {
  const router = useRouter();
  const { me, ready } = useStore();

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => router.replace(me ? "/home" : "/welcome"), 1400);
    return () => clearTimeout(t);
  }, [ready, me, router]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-lagoon px-6 text-center text-white">
      <div className="animate-rise flex flex-col items-center">
        <LogoMark className="size-16" />
        <h1 className="mt-5 font-display text-5xl font-bold tracking-tight">TRIPLY</h1>
        <p className="mt-4 space-y-0.5 font-display text-lg leading-relaxed text-white/85">
          <span className="block">Plan together.</span>
          <span className="block">Discover together.</span>
          <span className="block text-[#ffc7b8]">Travel together.</span>
        </p>
      </div>
    </main>
  );
}
