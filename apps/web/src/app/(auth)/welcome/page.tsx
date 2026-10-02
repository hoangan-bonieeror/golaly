import { Compass, GitFork, Users } from "lucide-react";
import { Button } from "@/components/ui";

export default function Welcome() {
  return (
    <div className="animate-rise">
      <h1 className="font-display text-4xl font-semibold leading-tight">
        Plan together.
        <br />
        Discover together.
        <br />
        <span className="text-sunset">Travel together.</span>
      </h1>
      <ul className="mt-8 space-y-4 text-[15px] text-ink-2">
        {[
          { icon: Compass, text: "Find real itineraries from travelers who've been there." },
          { icon: GitFork, text: "Remix any public trip into your own editable plan." },
          { icon: Users, text: "Invite friends as editors or viewers — you stay in control." },
        ].map(({ icon: Icon, text }) => (
          <li key={text} className="flex gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-lagoon-50 text-lagoon">
              <Icon className="size-5" />
            </span>
            <span className="pt-1.5">{text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-10 grid gap-3">
        <Button href="/register" size="lg">
          Get started
        </Button>
        <Button href="/login" size="lg" variant="secondary">
          Log in
        </Button>
      </div>
    </div>
  );
}
