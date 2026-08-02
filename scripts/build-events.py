#!/usr/bin/env python3
"""Join the event spine to whatever the body was wearing at the time.

    python3 scripts/build-events.py > sketches/2026-07-festival-season/../../public/data/events.json

`data/events-source.json` is the spine: every event, named from Google Calendar and Gmail.
It is deliberately NOT derived from step counts. The original sketch found its events by
detecting step spikes ≥ 18k, which silently drops anything that doesn't involve walking far —
club nights, concerts, indoor festivals. Reading the calendar directly turns up roughly forty
events in 2023–2025 that method never saw, plus six inside its own window.

Body data is an attribute joined onto each event, and it has two states:

    garmin    2025-05-22 onward — steps, RHR, HRV, sleep, body battery
    none      before that       — the event happened; nothing usable measured it

There used to be a third, `samsung`: walk/run distance and sparse heart rate scraped from the
Galaxy export for 2022-12 → 2024-08. It was dropped. Daily step totals are stored per device
and don't survive a phone migration, so what was left was walking distance from whichever app
happened to be open — present for some events, absent for others, and never comparable with a
Garmin step count. Charting it invited exactly the comparison it could not support. The events
from that period are kept as what they honestly are: a ledger of nights that happened.

The Samsung export is still read for one thing — `devices`, the record of which watch or phone
was reporting when, which is what explains the empty columns before May 2025.

The Garmin-era day series still lives inline in the sketch (it predates this script and carries
fields — body battery, sleep stages — that export-garmin.py does not emit). This script marks
those events `measured: "garmin"` by date and leaves their metrics to the sketch.
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GARMIN_START = "2025-05-22"  # first day GarminDB has a resting_hr row


def samsung_days(export: str | None) -> dict:
    """Shell out to export-samsung.py so the parsing lives in exactly one place."""
    cmd = [sys.executable, os.path.join(ROOT, "scripts", "export-samsung.py")]
    if export:
        cmd.append(export)
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def main() -> None:
    export = sys.argv[1] if len(sys.argv) > 1 else None
    spine = json.load(open(os.path.join(ROOT, "data", "events-source.json")))
    sam = samsung_days(export)

    events = []
    for e in spine["events"]:
        rec = {k: e[k] for k in ("d", "nd", "n", "t", "c", "ev") if k in e}
        if e.get("note"):
            rec["note"] = e["note"]

        rec["measured"] = "garmin" if e["d"] >= GARMIN_START else "none"
        events.append(rec)

    # The Samsung day series is deliberately not emitted. It was 60% of the
    # payload and its only consumers were the distance charts, which are gone.
    json.dump(
        {
            "garminStart": GARMIN_START,
            "events": events,
            "devices": sam["devices"],
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
