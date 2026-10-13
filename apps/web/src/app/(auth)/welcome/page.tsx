import { Compass, GitFork, Users } from "lucide-react";
import { Button } from "@/components/ui";
import { getMessages } from "@/i18n/server";

export default async function Welcome() {
  const t = await getMessages();
  return (
    <div className="animate-rise">
      <h1 className="font-display text-4xl font-semibold leading-tight">
        {t.common.tagline.plan}
        <br />
        {t.common.tagline.discover}
        <br />
        <span className="text-accent-700">{t.common.tagline.travel}</span>
      </h1>
      <ul className="mt-8 space-y-4 text-[15px] text-ink-2">
        {[
          { icon: Compass, text: t.auth.welcome.discover },
          { icon: GitFork, text: t.auth.welcome.remix },
          { icon: Users, text: t.auth.welcome.invite },
        ].map(({ icon: Icon, text }) => (
          <li key={text} className="flex gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary">
              <Icon className="size-5" />
            </span>
            <span className="pt-1.5">{text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-10 grid gap-3">
        <Button href="/register" size="lg">
          {t.auth.welcome.getStarted}
        </Button>
        <Button href="/login" size="lg" variant="secondary">
          {t.common.logIn}
        </Button>
      </div>
    </div>
  );
}
