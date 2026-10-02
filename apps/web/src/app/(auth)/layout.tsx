import Link from "next/link";
import { Cover } from "@/components/trip/Cover";
import { Logo } from "@/components/layout/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="relative hidden lg:block">
        <Cover palette={["#0e6e6a", "#f2a65a"]} seed="auth-hero" rounded={false} className="absolute inset-0">
          <div className="flex h-full flex-col justify-between p-12 text-white">
            <Link href="/">
              <Logo light />
            </Link>
            <div className="max-w-md">
              <p className="font-display text-4xl font-semibold leading-tight">
                Real trips from real travelers — ready for you to make your own.
              </p>
              <p className="mt-4 text-white/85">Discover a route, remix it in one tap, and plan it with friends.</p>
            </div>
          </div>
        </Cover>
      </aside>
      <main className="flex flex-col px-6 py-8 md:px-12">
        <Link href="/" className="mb-10 lg:hidden">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">{children}</div>
      </main>
    </div>
  );
}
