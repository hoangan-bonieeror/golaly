import { EdgeOfMapArt } from "@/components/art/EmptyArt";
import { Button } from "@/components/ui";
import { getMessages } from "@/i18n/server";

export default async function NotFound() {
  const t = (await getMessages()).common.errors;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <EdgeOfMapArt className="h-36 w-52" />
      <h1 className="font-display text-3xl font-semibold">{t.notFoundTitle}</h1>
      <p className="text-muted">{t.notFoundBody}</p>
      <Button href="/home">{t.backHome}</Button>
    </main>
  );
}
