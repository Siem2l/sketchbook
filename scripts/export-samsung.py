#!/usr/bin/env python3
"""Regenerate the pre-Garmin half of the festival-season data from a Samsung Health export.

GarminDB only reaches back to 2025-05-22. Samsung Health covers 2022-12 → 2024-08 (Galaxy
Watch4 era) and 2026-01 → now (S24 FE), so it fills in the years before the Garmin watch:

    python3 scripts/export-samsung.py ~/Downloads/Samsung\\ Health > /tmp/samsung.json

The export is a manual one-off download — Samsung has no API to pull from — so this runs
locally against whatever directory the ZIP was unpacked into, unlike export-garmin.py which
SSHes to the homelab.

Two things about the export that will bite you:

  * Every CSV has a junk first line (the table name and a version); the real header is line 2.
  * Timestamps are local-naive strings ("2023-07-21 14:10:03.000") with the UTC offset in a
    separate `time_offset` column. Parsing them as UTC shifts days across midnight, which is
    exactly where the festival nights live. We bucket on the local date, as written.

Daily STEP totals exist only for the current phone (2026-01-31 onward) — the pedometer series
is device-local and did not survive the phone migrations. What does reach back is walking and
running sessions, so distance is the metric for the early years. Days carry their heart-rate
sample count and sleep row too, including when those are zero: the watch came off for the big
nights, and that absence is data.
"""
import csv, glob, json, os, sys, collections

WALK, RUN = "1001", "1002"
EX = "com.samsung.health.exercise."


def rows(root: str, table: str) -> list[dict]:
    """Read one export CSV. Line 1 is a junk header; the real one is line 2."""
    matches = glob.glob(os.path.join(root, f"{table}.*.csv"))
    if not matches:
        return []
    fh = open(matches[0], encoding="utf-8-sig")
    fh.readline()
    return list(csv.DictReader(fh))


def num(row: dict, key: str) -> float | None:
    v = (row.get(key) or "").strip()
    try:
        return float(v)
    except ValueError:
        return None


def find_export(arg: str | None) -> str:
    """Accept the download folder or the dated export dir inside it."""
    base = os.path.expanduser(arg or "~/Downloads/Samsung Health")
    if glob.glob(os.path.join(base, "com.samsung.shealth.exercise.*.csv")):
        return base
    inner = sorted(glob.glob(os.path.join(base, "samsunghealth_*")))
    if not inner:
        sys.exit(f"no Samsung Health export found under {base}")
    return inner[-1]


def main() -> None:
    root = find_export(sys.argv[1] if len(sys.argv) > 1 else None)

    days: dict[str, dict] = collections.defaultdict(
        lambda: {"km": 0.0, "min": 0.0, "n": 0, "first": None, "last": None}
    )
    for r in rows(root, "com.samsung.shealth.exercise"):
        if r.get(EX + "exercise_type") not in (WALK, RUN):
            continue
        start, end = r.get(EX + "start_time") or "", r.get(EX + "end_time") or ""
        if not start:
            continue
        d = days[start[:10]]
        d["km"] += (num(r, EX + "distance") or 0) / 1000
        d["min"] += (num(r, EX + "duration") or 0) / 60000
        d["n"] += 1
        # Clock times, not timestamps — a night that runs past midnight reads as "→ 00:07".
        if d["first"] is None or start[11:16] < d["first"]:
            d["first"] = start[11:16]
        if end and (d["last"] is None or end[11:16] > d["last"]):
            d["last"] = end[11:16]

    hr = collections.Counter(
        (r.get("com.samsung.health.heart_rate.start_time") or "")[:10]
        for r in rows(root, "com.samsung.shealth.tracker.heart_rate")
    )
    hr.pop("", None)

    sleep = {}
    for r in rows(root, "com.samsung.shealth.sleep"):
        start = r.get("com.samsung.health.sleep.start_time") or ""
        if not start:
            continue
        sleep[start[:10]] = {
            "min": int(num(r, "sleep_duration") or 0),
            "score": int(num(r, "sleep_score") or 0) or None,
            "start": start[11:16],
        }

    out = {}
    for day, d in sorted(days.items()):
        rec = {
            "km": round(d["km"], 2),
            "min": round(d["min"]),
            "n": d["n"],
            "first": d["first"],
            "last": d["last"],
            "hr": hr.get(day, 0),
        }
        if day in sleep:
            rec["sleep"] = sleep[day]
        out[day] = rec

    # When each device actually REPORTED, which is not when it was registered.
    # A device can sit in the profile table having produced nothing at all — the
    # Galaxy S8 is registered in 2018 and contributes zero rows, and that absence
    # is the whole point of the ladder.
    active: dict[str, list[str]] = {}
    for table, uuid_col, time_col in [
        ("com.samsung.shealth.exercise", EX + "deviceuuid", EX + "start_time"),
        ("com.samsung.shealth.tracker.heart_rate",
         "com.samsung.health.heart_rate.deviceuuid",
         "com.samsung.health.heart_rate.start_time"),
        ("com.samsung.shealth.sleep",
         "com.samsung.health.sleep.deviceuuid",
         "com.samsung.health.sleep.start_time"),
        ("com.samsung.shealth.step_daily_trend", "deviceuuid", "day_time"),
    ]:
        for r in rows(root, table):
            uuid, day = (r.get(uuid_col) or "").strip(), (r.get(time_col) or "")[:10]
            if not uuid or not day or not day[0].isdigit():
                continue
            span = active.setdefault(uuid, [day, day])
            span[0], span[1] = min(span[0], day), max(span[1], day)

    devices = []
    for r in rows(root, "com.samsung.health.device_profile"):
        model = (r.get("model") or "").strip()
        if model in ("Combined", "all_target", ""):
            continue
        uuid = (r.get("deviceuuid") or "").strip()
        devices.append(
            {
                "model": model,
                "name": (r.get("name") or "").strip(),
                "paired": (r.get("fixed_name") or "").strip(),
                "since": (r.get("create_time") or "")[:10],
                "uuid": uuid,
                "active": active.get(uuid),
            }
        )
    devices.sort(key=lambda d: d["since"])

    json.dump(
        {
            "source": os.path.basename(root),
            "metric": "walk+run distance — daily step totals do not exist before 2026",
            "days": out,
            "devices": devices,
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
