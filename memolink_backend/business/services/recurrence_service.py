from __future__ import annotations

import calendar as _calendar
from datetime import date, timedelta
from typing import Optional

# Standard preset recurrence support only (no full RFC5545): DAILY/WEEKLY/MONTHLY/YEARLY
# with INTERVAL, BYDAY (weekly only), COUNT, UNTIL — matching the calendar UI's "Repeats"
# dropdown. Rules are stored/exchanged as plain RRULE strings (without the "RRULE:" prefix)
# so they pass through to/from Google Calendar's `recurrence` field with no translation.

WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]

_HARD_LIMIT = 2000  # safety valve against unbounded loops for rules with neither COUNT nor UNTIL


def build_rrule(
    freq: str,
    interval: int = 1,
    by_day: Optional[list[str]] = None,
    until: Optional[str] = None,
    count: Optional[int] = None,
) -> Optional[str]:
    """freq: "none"|"daily"|"weekly"|"monthly"|"yearly". until: "YYYY-MM-DD"."""
    if not freq or freq == "none":
        return None
    parts = [f"FREQ={freq.upper()}"]
    if interval and interval != 1:
        parts.append(f"INTERVAL={interval}")
    if by_day:
        parts.append(f"BYDAY={','.join(by_day)}")
    if until:
        parts.append(f"UNTIL={until.replace('-', '')}")
    elif count:
        parts.append(f"COUNT={count}")
    return ";".join(parts)


def parse_rrule(rule: Optional[str]) -> dict:
    out: dict = {"freq": "none", "interval": 1, "by_day": None, "until": None, "count": None}
    if not rule:
        return out
    for part in rule.split(";"):
        if "=" not in part:
            continue
        key, _, val = part.partition("=")
        key = key.upper()
        if key == "FREQ":
            out["freq"] = val.lower()
        elif key == "INTERVAL":
            try:
                out["interval"] = int(val)
            except ValueError:
                pass
        elif key == "BYDAY":
            out["by_day"] = [c for c in val.split(",") if c in WEEKDAY_CODES]
        elif key == "UNTIL":
            digits = "".join(ch for ch in val if ch.isdigit())[:8]
            if len(digits) == 8:
                out["until"] = f"{digits[0:4]}-{digits[4:6]}-{digits[6:8]}"
        elif key == "COUNT":
            try:
                out["count"] = int(val)
            except ValueError:
                pass
    return out


def expand_occurrences(
    rule: Optional[str],
    start_date: date,
    range_start: date,
    range_end: date,
) -> list[date]:
    """Return the list of occurrence dates for `rule` (anchored at start_date) that
    fall within [range_start, range_end]. A None/empty rule yields a single occurrence
    on start_date if it falls in range."""
    if range_end < range_start:
        return []
    if not rule:
        return [start_date] if range_start <= start_date <= range_end else []

    parsed = parse_rrule(rule)
    freq = parsed["freq"]
    interval = max(1, parsed["interval"] or 1)
    by_day = parsed["by_day"]
    until = date.fromisoformat(parsed["until"]) if parsed["until"] else None
    count = parsed["count"]

    occurrences: list[date] = []

    if freq == "daily":
        n = 0
        i = 0
        while True:
            d = start_date + timedelta(days=i * interval)
            if d > range_end or (until and d > until) or (count is not None and n >= count):
                break
            n += 1
            if d >= range_start:
                occurrences.append(d)
            i += 1
            if i > _HARD_LIMIT:
                break

    elif freq == "weekly":
        codes = by_day or [WEEKDAY_CODES[start_date.weekday()]]
        day_nums = sorted({WEEKDAY_CODES.index(c) for c in codes if c in WEEKDAY_CODES})
        week0_start = start_date - timedelta(days=start_date.weekday())
        n = 0
        week_idx = 0
        while True:
            cur_week_start = week0_start + timedelta(weeks=week_idx * interval)
            if cur_week_start > range_end:
                break
            stop = False
            for dn in day_nums:
                d = cur_week_start + timedelta(days=dn)
                if d < start_date:
                    continue
                if until and d > until:
                    stop = True
                    break
                if count is not None and n >= count:
                    stop = True
                    break
                n += 1
                if range_start <= d <= range_end:
                    occurrences.append(d)
            if stop:
                break
            week_idx += 1
            if week_idx > _HARD_LIMIT:
                break

    elif freq == "monthly":
        n = 0
        i = 0
        while True:
            total_month = start_date.month - 1 + i * interval
            year = start_date.year + total_month // 12
            month = total_month % 12 + 1
            day = min(start_date.day, _calendar.monthrange(year, month)[1])
            d = date(year, month, day)
            if d > range_end or (until and d > until) or (count is not None and n >= count):
                break
            n += 1
            if d >= range_start:
                occurrences.append(d)
            i += 1
            if i > _HARD_LIMIT:
                break

    elif freq == "yearly":
        n = 0
        i = 0
        while True:
            year = start_date.year + i * interval
            try:
                d = date(year, start_date.month, start_date.day)
            except ValueError:
                d = date(year, start_date.month, 28)  # Feb 29 anchor on non-leap years
            if d > range_end or (until and d > until) or (count is not None and n >= count):
                break
            n += 1
            if d >= range_start:
                occurrences.append(d)
            i += 1
            if i > _HARD_LIMIT:
                break

    else:
        if range_start <= start_date <= range_end:
            occurrences.append(start_date)

    return occurrences
