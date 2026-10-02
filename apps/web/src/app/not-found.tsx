import { Compass } from "lucide-react";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-lagoon-50 text-lagoon">
        <Compass className="size-8" />
      </span>
      <h1 className="font-display text-3xl font-semibold">Looks like you wandered off the map</h1>
      <p className="text-muted">That page doesn&apos;t exist.</p>
      <Button href="/home">Back home</Button>
    </main>
  );
}
