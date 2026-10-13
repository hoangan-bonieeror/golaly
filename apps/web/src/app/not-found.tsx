import { Compass } from "lucide-react";
import { Button } from "@/components/ui";
import { getMessages } from "@/i18n/server";

export default async function NotFound() {
  const t = (await getMessages()).common.errors;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-primary-50 text-primary">
        <Compass className="size-8" />
      </span>
      <h1 className="font-display text-3xl font-semibold">{t.notFoundTitle}</h1>
      <p className="text-muted">{t.notFoundBody}</p>
      <Button href="/home">{t.backHome}</Button>
    </main>
  );
}
