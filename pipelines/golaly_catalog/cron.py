"""A small 5-field cron (minute hour day-of-month month day-of-week), UTC — for sync_jobs.schedule.

Supports `*`, numbers, ranges `a-b`, steps `*/n` / `a-b/n`, lists `a,b`, month and weekday names, and the macros
@hourly @daily @weekly @monthly. As in cron, when both day fields are restricted a day matches if either does.
(The API validates schedules with the same grammar in packages/shared.)
"""

from __future__ import annotations

from datetime import datetime, timedelta

MACROS = {"@hourly": "0 * * * *", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@weekly": "0 0 * * 0", "@monthly": "0 0 1 * *"}
NAMES = {
    3: {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)},
    4: {d: i for i, d in enumerate(["sun", "mon", "tue", "wed", "thu", "fri", "sat"])},
}
RANGES = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 7)]


class CronError(ValueError):
    pass


def _value(text: str, field: int) -> int:
    t = text.lower()
    if t in NAMES.get(field, {}):
        return NAMES[field][t]
    if not t.isdigit():
        raise CronError(f"{text!r} is not a number")
    return int(t)


def _field(text: str, field: int) -> set[int]:
    lo, hi = RANGES[field]
    out: set[int] = set()
    for part in text.split(","):
        base, _, step_s = part.partition("/")
        step = int(step_s) if step_s else 1
        if step_s and (not step_s.isdigit() or step < 1):
            raise CronError(f"bad step in {part!r}")
        if base == "*":
            a, b = lo, hi
        elif "-" in base:
            a, b = (_value(x, field) for x in base.split("-", 1))
        else:
            a = _value(base, field)
            b = hi if step_s else a
        if not (lo <= a <= hi and lo <= b <= hi and a <= b):
            raise CronError(f"{part!r} is out of range {lo}-{hi}")
        out.update(range(a, b + 1, step))
    if field == 4 and 7 in out:  # 7 = Sunday too
        out = (out - {7}) | {0}
    return out


class Cron:
    def __init__(self, expr: str):
        text = MACROS.get(expr.strip().lower(), expr.strip())
        parts = text.split()
        if len(parts) != 5:
            raise CronError("a schedule has 5 fields: minute hour day-of-month month day-of-week")
        self.minutes, self.hours, self.days, self.months, self.weekdays = (_field(p, i) for i, p in enumerate(parts))
        self.any_day = parts[2] == "*"
        self.any_weekday = parts[4] == "*"

    def _day_ok(self, d: datetime) -> bool:
        dom = d.day in self.days
        dow = (d.isoweekday() % 7) in self.weekdays
        if self.any_day and self.any_weekday:
            return True
        if self.any_day:
            return dow
        if self.any_weekday:
            return dom
        return dom or dow

    def next_after(self, after: datetime) -> datetime:
        """The first matching minute strictly after `after` (naive UTC)."""
        t = after.replace(second=0, microsecond=0) + timedelta(minutes=1)
        limit = t + timedelta(days=366 * 5)
        while t < limit:
            if t.month not in self.months:
                t = (t.replace(day=1, hour=0, minute=0) + timedelta(days=32)).replace(day=1)
                continue
            if not self._day_ok(t):
                t = t.replace(hour=0, minute=0) + timedelta(days=1)
                continue
            if t.hour not in self.hours:
                t = t.replace(minute=0) + timedelta(hours=1)
                continue
            if t.minute not in self.minutes:
                t += timedelta(minutes=1)
                continue
            return t
        raise CronError("the schedule never matches")


def next_run(expr: str, after: datetime) -> datetime:
    return Cron(expr).next_after(after)
