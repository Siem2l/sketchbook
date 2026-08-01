#!/usr/bin/env python3
"""Join the event spine to whatever the body was wearing at the time.

    python3 scripts/build-events.py > sketches/2026-07-festival-season/../../public/data/events.json

`data/events-source.json` is the spine: every event, named from Google Calendar and Gmail.
It is deliberately NOT derived from step counts. The original sketch found its events by
detecting step spikes ≥ 18k, which silently drops anything that doesn't involve walking far —
club nights, concerts, indoor festivals. Reading the calendar directly turns up roughly forty
events in 2023–2025 that method never saw, plus six inside its own window.

Body data is an attribute joined onto each event, and it has three states:

    garmin    2025-05-22 onward — steps, RHR, HRV, sleep, body battery
    samsung   2022-12 → 2024-08 — walk/run distance, sparse HR, 85 nights of sleep
    none      2024-08 → 2025-05 — Samsung has stopped, Garmin hasn't started

That third state is not a gap to interpolate across. Ten events live in it with no measurement
of any kind, and the sketch renders them as named-but-unmeasured.

The Garmin-era day series still lives inline in the sketch (it predates this script and carries
fields — body battery, sleep stages — that export-garmin.py does not emit). This script marks
those events `measured: "garmin"` by date and leaves their metrics to the sketch.
"""
import datetime, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GARMIN_START = "2025-05-22"  # first day GarminDB has a resting_hr row


def samsung_days(export: str | None) -> dict:
    """Shell out to export-samsung.py so the parsing lives in exactly one place."""
    cmd = [sys.executable, os.path.join(ROOT, "scripts", "export-samsung.py")]
    if export:
        cmd.append(export)
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def span(start: str, n: int) -> list[str]:
    d0 = datetime.date.fromisoformat(start)
    return [(d0 + datetime.timedelta(days=i)).isoformat() for i in range(n)]


def main() -> None:
    export = sys.argv[1] if len(sys.argv) > 1 else None
    spine = json.load(open(os.path.join(ROOT, "data", "events-source.json")))
    sam = samsung_days(export)
    days = sam["days"]

    events = []
    for e in spine["events"]:
        dates = span(e["d"], e.get("nd", 1))
        rec = {k: e[k] for k in ("d", "nd", "n", "t", "c", "ev") if k in e}
        if e.get("note"):
            rec["note"] = e["note"]

        if e["d"] >= GARMIN_START:
            rec["measured"] = "garmin"
        else:
            hit = [days[d] for d in dates if d in days]
            if hit:
                rec["measured"] = "samsung"
                rec["km"] = round(sum(h["km"] for h in hit), 1)
                rec["peakKm"] = round(max(h["km"] for h in hit), 1)
                rec["sessions"] = sum(h["n"] for h in hit)
                rec["hr"] = sum(h["hr"] for h in hit)
                nights = [h["sleep"]["min"] for h in hit if "sleep" in h]
                if nights:
                    rec["sleepMin"] = min(nights)
                # Clock span of the first and last movement across the whole block.
                firsts = [h["first"] for h in hit if h["first"]]
                lasts = [h["last"] for h in hit if h["last"]]
                if firsts and lasts:
                    rec["clock"] = f"{min(firsts)}→{max(lasts)}"
            else:
                rec["measured"] = "none"
        events.append(rec)

    # Days over 10 km that the spine has no name for — kept visible rather than dropped.
    named = {d for e in spine["events"] for d in span(e["d"], e.get("nd", 1))}
    orphans = [
        {"d": d, "km": v["km"], "hr": v["hr"]}
        for d, v in sorted(days.items())
        if v["km"] >= 10 and d not in named
    ]

    json.dump(
        {
            "garminStart": GARMIN_START,
            "events": events,
            "orphans": orphans,
            "devices": sam["devices"],
            "samsungDays": days,
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
