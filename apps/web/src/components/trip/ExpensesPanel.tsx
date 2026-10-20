"use client";

import { EXPENSE_CATEGORIES, currencyDigits, parseAmount, splitEqually, type ExpenseCategory, type ExpenseView, type ExpensesView, type TripDetail, type UserSummary } from "@golaly/shared";
import { ArrowRight, BedDouble, Check, ChevronLeft, Plus, Receipt, ShoppingBag, Ticket, TramFront, Undo2, UtensilsCrossed } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useFormat, useI18n } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { keys, useAction, useExpenses, useMe } from "@/lib/api/queries";
import { COMMON_CURRENCIES, amountInput, currencyName, formatMoney } from "@/lib/money";
import { firstName, markable } from "@/lib/plan";
import { Avatar, Button, Chip, EmptyState, ErrorState, Field, Skeleton, cx, inputCls } from "../ui";

export const CATEGORY_ICON: Record<ExpenseCategory, React.ElementType> = {
  FOOD: UtensilsCrossed,
  LODGING: BedDouble,
  TRANSPORT: TramFront,
  ACTIVITY: Ticket,
  SHOPPING: ShoppingBag,
  OTHER: Receipt,
};

/** What the panel shows: the overview, or the form for a new / existing expense (optionally tied to a stop). */
export type ExpenseMode = { kind: "list" } | { kind: "form"; expense?: ExpenseView; itemId?: string };

/**
 * Shared expenses (roadmap phase 3), members only: the total against the budget, who is owed and who
 * owes, the fewest repayments to settle up ("Mark paid" records one), and every expense. Amounts are
 * whole minor units in the trip's one currency; the API does the arithmetic and returns the whole view.
 */
export function ExpensesPanel({ trip, mode, onMode }: { trip: TripDetail; mode: ExpenseMode; onMode: (m: ExpenseMode) => void }) {
  const q = useExpenses(trip.id);
  if (q.isLoading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return mode.kind === "form" ? (
    <ExpenseForm key={mode.expense?.id ?? mode.itemId ?? "new"} trip={trip} view={q.data} expense={mode.expense} itemId={mode.itemId} onDone={() => onMode({ kind: "list" })} />
  ) : (
    <Overview trip={trip} view={q.data} onMode={onMode} />
  );
}

function useSetView(tripId: string) {
  const qc = useQueryClient();
  return (v: ExpensesView) => qc.setQueryData(keys.expenses(tripId), v);
}

function Overview({ trip, view, onMode }: { trip: TripDetail; view: ExpensesView; onMode: (m: ExpenseMode) => void }) {
  const { m, locale } = useI18n();
  const f = useFormat();
  const t = m.after.expenses;
  const me = useMe().data;
  const setView = useSetView(trip.id);
  const money = (n: number, sign = false) => formatMoney(n, view.currency, locale, { sign });
  const name = (u: UserSummary) => (u.id === me?.id ? t.you : firstName(u));
  const settle = useAction((x: { fromId: string; toId: string; amount: number }) => api.post<ExpensesView>(`/trips/${trip.id}/settlements`, x), { success: t.paidSaved });
  const undo = useAction((id: string) => api.delete<ExpensesView>(`/settlements/${id}`), { success: t.undone });
  const currency = useAction((code: string) => api.patch(`/trips/${trip.id}`, { currency: code }), { invalidate: [keys.trip(trip.id), ["trips"]], success: t.currencySaved });

  const people = Math.max(1, trip.members.length);
  // The trip's budget is per person (Trip settings): the group's is that × the travelers.
  const perPersonMinor = view.budget ? view.budget * 10 ** view.digits : null;
  const budgetMinor = perPersonMinor !== null ? perPersonMinor * people : null;
  const used = budgetMinor ? Math.min(1, view.total / budgetMinor) : 0;
  const owner = trip.myRole === "OWNER";
  const codes = [...new Set([view.currency, ...COMMON_CURRENCIES])];

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-2">{t.intro}</p>

      {/* Total, budget and currency. */}
      <section aria-label={t.total} className="rounded-2xl bg-sand-2 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted">{t.total}</div>
            <div className="font-display text-3xl font-extrabold tabular-nums">{money(view.total)}</div>
            {view.total > 0 && <div className="mt-0.5 text-[13px] text-ink-2">{t.perPerson(money(Math.round(view.total / people)))}</div>}
          </div>
          {owner && !view.currencyLocked ? (
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-ink-2">{t.currency}</span>
              <select value={view.currency} onChange={(e) => currency.run(e.target.value)} disabled={currency.isPending} className={cx(inputCls, "h-10 w-auto pr-8")}>
                {codes.map((c) => (
                  <option key={c} value={c}>
                    {c} · {currencyName(c, locale)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="rounded-full bg-surface px-3 py-1 font-mono text-xs font-semibold text-ink-2" title={view.currencyLocked ? t.currencyLocked : undefined}>
              {view.currency}
            </span>
          )}
        </div>
        {owner && !view.currencyLocked && <p className="mt-2 text-xs text-muted">{t.currencyHint}</p>}
        {budgetMinor !== null && budgetMinor > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-[13px]">
              <span className="text-ink-2">
                {t.budget(money(budgetMinor))}
                {people > 1 && perPersonMinor !== null && <span className="text-muted"> · {t.budgetEach(money(perPersonMinor))}</span>}
              </span>
              <span className={cx("font-semibold", view.total > budgetMinor ? "text-danger" : "text-ink-2")}>
                {view.total > budgetMinor ? t.overBudget(money(view.total - budgetMinor)) : t.leftInBudget(money(budgetMinor - view.total))}
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)} aria-label={t.budget(money(budgetMinor))}>
              <div className={cx("h-full rounded-full", view.total > budgetMinor ? "bg-danger" : "bg-primary")} style={{ width: `${used * 100}%` }} />
            </div>
          </div>
        )}
        {view.byCategory.length > 1 && (
          <ul aria-label={t.byCategory} className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-ink-2">
            {view.byCategory.map((c) => {
              const Icon = CATEGORY_ICON[c.category];
              return (
                <li key={c.category} className="inline-flex items-center gap-1.5">
                  <Icon className="size-3.5 text-muted" aria-hidden /> {t.category[c.category]} <span className="font-mono tabular-nums text-ink">{money(c.amount)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Button className="w-full" size="lg" onClick={() => onMode({ kind: "form" })}>
        <Plus className="size-5" /> {t.add}
      </Button>

      {view.expenses.length === 0 ? (
        <EmptyState icon={<Receipt className="size-7" />} title={t.title} body={t.empty} />
      ) : (
        <>
          {/* Balances: + is owed money, − owes. */}
          <section aria-labelledby="exp-balances">
            <h3 id="exp-balances" className="mb-2 font-display text-lg font-bold">
              {t.balances}
            </h3>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {view.balances.map((b) => (
                <li key={b.user.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <Avatar user={b.user} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{b.user.id === me?.id ? `${b.user.displayName} (${t.you})` : b.user.displayName}</div>
                    <div className="text-xs text-muted">{t.paid(money(b.paid))}</div>
                  </div>
                  <span className={cx("shrink-0 text-right text-sm font-semibold tabular-nums", b.net > 0 ? "text-primary" : b.net < 0 ? "text-accent-700" : "text-muted")}>
                    {b.net > 0 ? t.isOwed(money(b.net)) : b.net < 0 ? t.owes(money(-b.net)) : t.even}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Settle up: the fewest transfers. */}
          <section aria-labelledby="exp-settle">
            <h3 id="exp-settle" className="font-display text-lg font-bold">
              {t.settle}
            </h3>
            <p className="mb-2 text-xs text-muted">{t.settleHint}</p>
            {view.transfers.length === 0 ? (
              <p className="flex items-center gap-2 rounded-2xl bg-primary-50 px-4 py-3 text-sm font-semibold text-primary">
                <Check className="size-4" aria-hidden /> {t.allSettled}
              </p>
            ) : (
              <ul className="space-y-2">
                {view.transfers.map((x) => (
                  <li key={`${x.from.id}-${x.to.id}`} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line px-3.5 py-2.5">
                    <span className="flex items-center gap-1.5">
                      <Avatar user={x.from} size={26} />
                      <ArrowRight className="size-3.5 text-muted" aria-hidden />
                      <Avatar user={x.to} size={26} />
                    </span>
                    <span className="min-w-0 flex-1 text-sm">
                      {t.pays(name(x.from), name(x.to))} <b className="tabular-nums">{money(x.amount)}</b>
                    </span>
                    {/* Only the payer, the payee or the owner can record it (the API checks too). */}
                    {me && [x.from.id, x.to.id, trip.owner.id].includes(me.id) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={settle.isPending}
                        aria-label={t.markPaidLabel(x.from.displayName, x.to.displayName, money(x.amount))}
                        onClick={async () => {
                          const v = await settle.run({ fromId: x.from.id, toId: x.to.id, amount: x.amount });
                          if (v) setView(v);
                        }}
                      >
                        <Check className="size-4" /> {t.markPaid}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {view.settlements.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-semibold text-ink-2">
                  {t.repayments} ({view.settlements.length})
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {view.settlements.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 text-ink-2">
                      <span className="min-w-0 flex-1">
                        {t.repaid(name(s.from), name(s.to))} <b className="tabular-nums text-ink">{money(s.amount)}</b> · <span className="text-muted">{f.timeAgo(s.createdAt)}</span>
                      </span>
                      {s.canDelete && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={undo.isPending}
                          onClick={async () => {
                            const v = await undo.run(s.id);
                            if (v) setView(v);
                          }}
                        >
                          <Undo2 className="size-3.5" /> {t.undo}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          {/* Every expense. */}
          <section aria-labelledby="exp-list">
            <h3 id="exp-list" className="mb-2 font-display text-lg font-bold">
              {t.list}
            </h3>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {view.expenses.map((e) => {
                const Icon = CATEGORY_ICON[e.category];
                const mine = e.shares.find((s) => s.user.id === me?.id);
                const body = (
                  <>
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sand-2 text-ink-2">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{e.description}</span>
                      <span className="block truncate text-xs text-muted">
                        {[t.paidBy(name(e.paidBy), e.spentOn ? f.day(e.spentOn, { day: "numeric", month: "short" }) : null), e.item?.title, t.splitAmong(e.shares.filter((s) => s.amount > 0).length)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold tabular-nums">{money(e.amount)}</span>
                      {mine && <span className="block text-[11px] text-muted">{t.yourShare(money(mine.amount))}</span>}
                    </span>
                  </>
                );
                return (
                  <li key={e.id}>
                    {e.canEdit ? (
                      <button type="button" onClick={() => onMode({ kind: "form", expense: e })} aria-label={`${t.edit}: ${e.description}`} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-sand-2/60">
                        {body}
                      </button>
                    ) : (
                      <div className="flex items-center gap-3 px-3.5 py-2.5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

/** Add or edit one expense: what, how much, who paid, and an equal or by-amount split. */
function ExpenseForm({ trip, view, expense, itemId, onDone }: { trip: TripDetail; view: ExpensesView; expense?: ExpenseView; itemId?: string; onDone: () => void }) {
  const { m, locale } = useI18n();
  const f = useFormat();
  const t = m.after.expenses;
  const tf = t.form;
  const me = useMe().data;
  const setView = useSetView(trip.id);
  const digits = currencyDigits(view.currency);
  const money = (n: number) => formatMoney(n, view.currency, locale);
  const items = trip.days.flatMap((d) => d.items.filter(markable).map((i) => ({ ...i, day: d })));
  const linked = items.find((i) => i.id === itemId);

  // Everyone on the trip, plus anyone already on this expense who has since left.
  const people: UserSummary[] = [...trip.members.map((x) => x.user)];
  for (const u of [expense?.paidBy, ...(expense?.shares.map((s) => s.user) ?? [])]) if (u && !people.some((p) => p.id === u.id)) people.push(u);

  const [description, setDescription] = useState(expense?.description ?? linked?.title ?? "");
  const [amountText, setAmountText] = useState(expense ? amountInput(expense.amount, view.currency) : "");
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? (linked?.type === "RESTAURANT" ? "FOOD" : linked?.type === "HOTEL" ? "LODGING" : linked?.type === "ACTIVITY" ? "ACTIVITY" : "OTHER"));
  const [paidById, setPaidById] = useState(expense?.paidBy.id ?? me?.id ?? people[0]?.id ?? "");
  const [spentOn, setSpentOn] = useState(expense?.spentOn ?? linked?.day.date ?? "");
  const [item, setItem] = useState(expense?.item?.id ?? itemId ?? "");
  const equalShares = expense ? expense.shares.length > 0 && new Set(expense.shares.map((s) => s.amount)).size <= 2 && Math.max(...expense.shares.map((s) => s.amount)) - Math.min(...expense.shares.map((s) => s.amount)) <= 1 : true;
  const [mode, setMode] = useState<"equal" | "custom">(equalShares ? "equal" : "custom");
  const [who, setWho] = useState<string[]>(expense ? expense.shares.map((s) => s.user.id) : people.map((p) => p.id));
  const [custom, setCustom] = useState<Record<string, string>>(() => Object.fromEntries((expense?.shares ?? []).map((s) => [s.user.id, amountInput(s.amount, view.currency)])));
  const [errors, setErrors] = useState<{ amount?: string; split?: string }>({});

  const amount = parseAmount(amountText, digits);
  const customMinor = Object.fromEntries(people.map((p) => [p.id, custom[p.id]?.trim() ? (parseAmount(custom[p.id], digits) ?? (/^\s*0+([.,]0*)?\s*$/.test(custom[p.id]) ? 0 : NaN)) : 0]));
  const customSum = Object.values(customMinor).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const preview = mode === "equal" && amount && who.length ? splitEqually(amount, who) : [];

  const save = useAction(
    (body: object) => (expense ? api.patch<ExpensesView>(`/expenses/${expense.id}`, body) : api.post<ExpensesView>(`/trips/${trip.id}/expenses`, body)),
    { success: expense ? tf.updated : tf.added },
  );
  const remove = useAction(() => api.delete<ExpensesView>(`/expenses/${expense!.id}`), { success: t.deleted });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!amount) errs.amount = tf.amountInvalid;
    if (mode === "equal" && who.length === 0) errs.split = tf.pickSomeone;
    if (mode === "custom" && (customSum !== amount || Object.values(customMinor).some((x) => !Number.isFinite(x)))) errs.split = tf.sumMismatch;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const split =
      mode === "equal"
        ? { mode, userIds: who }
        : { mode, shares: people.filter((p) => customMinor[p.id] > 0).map((p) => ({ userId: p.id, amount: customMinor[p.id] })) };
    const v = await save.run({ description: description.trim(), amount, category, paidById, spentOn: spentOn || null, itemId: item || null, split });
    if (v) {
      setView(v);
      onDone();
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <button type="button" onClick={onDone} className="-ml-1 inline-flex h-9 items-center gap-1 rounded-lg px-1 text-sm font-semibold text-ink-2 hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden /> {t.title}
      </button>
      <h3 className="font-display text-xl font-bold">{expense ? tf.editTitle : tf.newTitle}</h3>

      <Field label={tf.description}>
        <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={tf.descriptionPlaceholder} maxLength={140} required />
      </Field>
      <Field label={tf.amount(view.currency)} error={errors.amount}>
        <input className={cx(inputCls, "font-mono text-lg tabular-nums")} inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder={digits ? "0.00" : "0"} required />
      </Field>
      {amount ? <p className="-mt-3 text-xs text-muted">{money(amount)}</p> : null}

      <Field label={tf.category} group>
        <div className="flex flex-wrap gap-2">
          {EXPENSE_CATEGORIES.map((c) => {
            const Icon = CATEGORY_ICON[c];
            return (
              <Chip key={c} type="button" active={category === c} onClick={() => setCategory(c)} className="h-9 px-3">
                <Icon className="size-3.5" aria-hidden /> {t.category[c]}
              </Chip>
            );
          })}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tf.paidBy}>
          <select className={inputCls} value={paidById} onChange={(e) => setPaidById(e.target.value)}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
                {p.id === me?.id ? ` (${t.you})` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tf.date}>
          <select className={inputCls} value={spentOn} onChange={(e) => setSpentOn(e.target.value)}>
            <option value="">{tf.noDate}</option>
            {trip.days
              .filter((d) => d.date)
              .map((d) => (
                <option key={d.id} value={d.date!}>
                  {m.trips.day(d.dayNumber)} · {f.day(d.date!, { weekday: "short", day: "numeric", month: "short" })}
                </option>
              ))}
          </select>
        </Field>
      </div>
      {items.length > 0 && (
        <Field label={tf.item}>
          <select className={inputCls} value={item} onChange={(e) => setItem(e.target.value)}>
            <option value="">{tf.noItem}</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {m.trips.day(i.day.dayNumber)} · {i.title}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label={tf.split} group error={errors.split}>
        <div role="radiogroup" aria-label={tf.split} className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-sand-2 p-1">
          {(["equal", "custom"] as const).map((x) => (
            <button
              key={x}
              type="button"
              role="radio"
              aria-checked={mode === x}
              onClick={() => setMode(x)}
              className={cx("h-10 rounded-[9px] text-sm font-semibold", mode === x ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink")}
            >
              {x === "equal" ? tf.equal : tf.custom}
            </button>
          ))}
        </div>
        {mode === "equal" ? (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-ink-2">{tf.who}</span>
              <button type="button" onClick={() => setWho(people.map((p) => p.id))} className="h-8 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-primary-50">
                {tf.everyone}
              </button>
            </div>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {people.map((p) => {
                const on = who.includes(p.id);
                const share = preview.find((s) => s.userId === p.id);
                return (
                  <li key={p.id}>
                    <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2">
                      <input type="checkbox" checked={on} onChange={() => setWho((w) => (on ? w.filter((x) => x !== p.id) : [...w, p.id]))} className="size-4 accent-[var(--color-primary)]" />
                      <Avatar user={p} size={26} />
                      <span className="min-w-0 flex-1 truncate text-sm">{p.displayName}</span>
                      {share && <span className="font-mono text-xs tabular-nums text-ink-2">{money(share.amount)}</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {people.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                  <Avatar user={p} size={26} />
                  <span className="min-w-0 flex-1 truncate text-sm">{p.displayName}</span>
                  <input
                    aria-label={tf.shareOf(p.displayName)}
                    inputMode="decimal"
                    value={custom[p.id] ?? ""}
                    onChange={(e) => setCustom((c) => ({ ...c, [p.id]: e.target.value }))}
                    placeholder="0"
                    className={cx(inputCls, "h-10 w-32 text-right font-mono tabular-nums")}
                  />
                </li>
              ))}
            </ul>
            {amount ? (
              <p className={cx("mt-2 text-right text-xs font-semibold", customSum === amount ? "text-primary" : "text-accent-700")} aria-live="polite">
                {customSum === amount ? tf.balanced : customSum < amount ? tf.remaining(money(amount - customSum)) : tf.over(money(customSum - amount))}
              </p>
            ) : null}
          </div>
        )}
      </Field>

      <div className="flex gap-2 pt-1">
        {expense && (
          <Button
            type="button"
            variant="danger"
            size="lg"
            disabled={remove.isPending}
            onClick={async () => {
              const v = await remove.run(undefined);
              if (v) {
                setView(v);
                onDone();
              }
            }}
          >
            {t.delete}
          </Button>
        )}
        <Button type="submit" size="lg" className="flex-1" disabled={save.isPending}>
          {tf.save}
        </Button>
      </div>
    </form>
  );
}
