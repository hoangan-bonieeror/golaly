"use client";

import { INTERESTS, TRAVELER_TYPES, type Interest, type TravelerType } from "@golaly/shared";
import { Baby, Camera, Heart, Landmark, Mountain, ShoppingBag, Sparkles, Sun, Tent, User, Users, UtensilsCrossed, Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, cx } from "@/components/ui";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { keys, useAction } from "@/lib/api/queries";

const typeIcon: Record<TravelerType, React.ElementType> = { SOLO: User, COUPLE: Heart, FRIENDS: Users, FAMILY: Baby, ALL: Sparkles };
const interestIcon: Record<Interest, React.ElementType> = {
  FOOD: UtensilsCrossed, NATURE: Mountain, BEACH: Sun, CITY: Building2, CULTURE: Landmark, ADVENTURE: Tent, SHOPPING: ShoppingBag, PHOTOGRAPHY: Camera,
};

export default function Onboarding() {
  const save = useAction((body: object) => api.patch("/users/me", body), { invalidate: [keys.me] });
  const router = useRouter();
  const t = useT();
  const [step, setStep] = useState(0);
  const [type, setType] = useState<TravelerType>();
  const [interests, setInterests] = useState<Interest[]>([]);

  const finish = async () => {
    if (await save.run({ travelerType: type ?? null, interests })) router.push("/home");
  };

  return (
    <div className="animate-rise" key={step}>
      <div className="mb-6 flex gap-1.5" aria-label={t.auth.onboarding.step(step + 1, 2)}>
        {[0, 1].map((i) => (
          <span key={i} className={cx("h-1.5 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-line")} />
        ))}
      </div>

      {step === 0 ? (
        <>
          <h1 className="font-display text-3xl font-semibold">{t.auth.onboarding.typeTitle}</h1>
          <p className="mt-1 text-sm text-muted">{t.auth.onboarding.typeBody}</p>
          <div className="mt-6 grid gap-2.5">
            {TRAVELER_TYPES.map(({ value }) => {
              const Icon = typeIcon[value];
              return (
                <button
                  key={value}
                  onClick={() => setType(value)}
                  aria-pressed={type === value}
                  className={cx(
                    "flex items-center gap-3 rounded-2xl border p-4 text-left font-medium transition-colors",
                    type === value ? "border-primary bg-primary-50 text-primary" : "border-line bg-surface hover:border-ink-2",
                  )}
                >
                  <Icon className="size-5" /> {t.labels.travelerType[value]}
                </button>
              );
            })}
          </div>
          <Button size="lg" className="mt-8 w-full" disabled={!type} onClick={() => setStep(1)}>
            {t.common.continue}
          </Button>
        </>
      ) : (
        <>
          <h1 className="font-display text-3xl font-semibold">{t.auth.onboarding.interestsTitle}</h1>
          <p className="mt-1 text-sm text-muted">{t.auth.onboarding.interestsBody}</p>
          <div className="mt-6 grid grid-cols-2 gap-2.5">
            {INTERESTS.map(({ value }) => {
              const Icon = interestIcon[value];
              const on = interests.includes(value);
              return (
                <button
                  key={value}
                  aria-pressed={on}
                  onClick={() => setInterests(on ? interests.filter((x) => x !== value) : [...interests, value])}
                  className={cx(
                    "flex flex-col items-start gap-3 rounded-2xl border p-4 text-left text-sm font-semibold transition-colors",
                    on ? "border-accent bg-accent-50 text-accent-700" : "border-line bg-surface hover:border-ink-2",
                  )}
                >
                  <Icon className="size-6" /> {t.labels.interest[value]}
                </button>
              );
            })}
          </div>
          <div className="mt-8 flex gap-3">
            <Button variant="secondary" size="lg" onClick={() => setStep(0)}>
              {t.common.back}
            </Button>
            <Button size="lg" className="flex-1" onClick={finish}>
              {interests.length ? t.auth.onboarding.start : t.auth.onboarding.skip}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
