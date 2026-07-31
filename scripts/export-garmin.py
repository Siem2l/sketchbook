#!/usr/bin/env python3
"""Regenerate public/data/garmin-body.json from GarminDB.

The "a year in a body" sketch reads {health: [{day, rhr, sleep, stress}]}.
Those map onto GarminDB's garmin.db: daily_summary (rhr, stress_avg) joined
with sleep (total_sleep). GarminDB lives on the homelab at
/mnt/storage/garmin/DBs and is owned by the garmindb user, so run this there:

    ssh nixos 'sudo -n python3 - < scripts/export-garmin.py' > public/data/garmin-body.json

Days with no real physiological signal (rhr, sleep and stress all absent) are
dropped, which also filters GarminDB's placeholder sleep=0 rows.
"""
import sqlite3, json, sys

DB = "/mnt/storage/garmin/DBs/garmin.db"


def day_of(ts: object) -> str:
    return str(ts)[:10]


def hours(hms: object) -> float | None:
    if not hms:
        return None
    h, m, s = str(hms).split(".")[0].split(":")
    v = int(h) + int(m) / 60 + int(s) / 3600
    return round(v, 2) if v > 0 else None


def main() -> None:
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    sleep = {day_of(r["day"]): hours(r["total_sleep"])
             for r in db.execute("select day, total_sleep from sleep")}
    health = []
    for r in db.execute("select day, rhr, stress_avg from daily_summary order by day"):
        d, rhr, stress, slp = day_of(r["day"]), r["rhr"], r["stress_avg"], sleep.get(day_of(r["day"]))
        if rhr is None and stress is None and slp is None:
            continue
        health.append({"day": d, "rhr": rhr, "sleep": slp, "stress": stress})
    json.dump({"health": health}, sys.stdout)


if __name__ == "__main__":
    main()
