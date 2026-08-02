#!/usr/bin/env python3
"""Regenerate the festival-season day series from GarminDB.

    ssh nixos 'sudo -n python3 - < scripts/export-garmin-days.py' > /tmp/days.json

The "the season" sketch carries its Garmin day series inline rather than fetching
it, and until now that series was hand-pasted — so it froze on whatever day it was
last updated and every event past that date rendered as a night with zero steps.
This emits exactly the shape the sketch expects, so it can be refreshed.

Field mapping, verified against 2026-07-12 (the 66,097-step day) where every
value reproduces the hand-pasted one exactly:

    st   steps            daily_summary.steps
    rhr  resting HR       daily_summary.rhr, falling back to resting_hr
    sr   stress           daily_summary.stress_avg
    bl   body battery low daily_summary.bb_min
    bh   body battery max daily_summary.bb_max
    km   distance         daily_summary.distance          -> 1 decimal
    fl   floors climbed   daily_summary.floors_up         -> rounded
    hv   overnight HRV    hrv.last_night_avg
    hlo  baseline low     hrv.baseline_low
    hhi  baseline high    hrv.baseline_upper
    sl   asleep           sleep.total_sleep               -> minutes
    dp   deep             sleep.deep_sleep                -> minutes
    li   light            sleep.light_sleep               -> minutes
    rm   REM              sleep.rem_sleep                 -> minutes
    aw   awake            sleep.awake                     -> minutes
    sc   sleep score      sleep.score

`day` is stored as a full timestamp, so every lookup goes through date(day).
A field with no value is omitted rather than zeroed: the sketch distinguishes
"nothing was recorded" from "recorded as zero", and collapsing the two would
invent measurements. A day with nothing at all stays as {}.
"""
import datetime
import json
import sqlite3
import sys

DB = "/mnt/storage/garmin/DBs/garmin.db"
START = "2025-05-15"  # where the sketch's series begins

# Emission order, matching the existing inline literal so a refresh diffs cleanly.
ORDER = ["st", "rhr", "sr", "bl", "bh", "km", "fl", "hv", "hlo", "hhi",
         "sl", "dp", "li", "rm", "aw", "sc"]


def minutes(hms: object) -> int | None:
    """'03:56:00.000000' -> 236. Zero-length sleep is absence, not a measurement."""
    if not hms:
        return None
    h, m, s = str(hms).split(".")[0].split(":")
    v = int(h) * 60 + int(m) + round(int(s) / 60)
    return v or None


def main() -> None:
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    days: dict[str, dict] = {}

    def put(day: str, key: str, value) -> None:
        if value is None:
            return
        days.setdefault(day, {})[key] = value

    for r in db.execute("select date(day) d, steps, rhr, stress_avg, bb_min, bb_max, "
                        "distance, floors_up from daily_summary where date(day) >= ?", (START,)):
        put(r["d"], "st", r["steps"])
        put(r["d"], "rhr", int(r["rhr"]) if r["rhr"] is not None else None)
        put(r["d"], "sr", r["stress_avg"])
        put(r["d"], "bl", r["bb_min"])
        put(r["d"], "bh", r["bb_max"])
        put(r["d"], "km", round(r["distance"], 1) if r["distance"] is not None else None)
        put(r["d"], "fl", round(r["floors_up"]) if r["floors_up"] is not None else None)

    # daily_summary.rhr is sparse on some days where resting_hr still has a row.
    for r in db.execute("select date(day) d, resting_heart_rate from resting_hr where date(day) >= ?", (START,)):
        if r["resting_heart_rate"] is not None and "rhr" not in days.get(r["d"], {}):
            put(r["d"], "rhr", int(r["resting_heart_rate"]))

    for r in db.execute("select date(day) d, last_night_avg, baseline_low, baseline_upper "
                        "from hrv where date(day) >= ?", (START,)):
        put(r["d"], "hv", r["last_night_avg"])
        put(r["d"], "hlo", r["baseline_low"])
        put(r["d"], "hhi", r["baseline_upper"])

    for r in db.execute("select date(day) d, total_sleep, deep_sleep, light_sleep, rem_sleep, "
                        "awake, score from sleep where date(day) >= ?", (START,)):
        put(r["d"], "sl", minutes(r["total_sleep"]))
        put(r["d"], "dp", minutes(r["deep_sleep"]))
        put(r["d"], "li", minutes(r["light_sleep"]))
        put(r["d"], "rm", minutes(r["rem_sleep"]))
        put(r["d"], "aw", minutes(r["awake"]))
        put(r["d"], "sc", r["score"])

    # Every calendar day from START to the last one with anything on it, so gaps
    # stay visible as {} instead of disappearing from the series.
    last = max(days) if days else START
    d0, d1 = datetime.date.fromisoformat(START), datetime.date.fromisoformat(last)
    out = {}
    while d0 <= d1:
        k = d0.isoformat()
        raw = days.get(k, {})
        out[k] = {f: raw[f] for f in ORDER if f in raw}
        d0 += datetime.timedelta(days=1)

    json.dump(out, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
