#!/usr/bin/env python3
"""Cut the point cloud behind the `hendriklaan` sketch out of AHN5.

The source is one 1x1 km COPC tile — AHN5_C_138000_455000, 228 MB, the square
holding Wilhelminapark and Rijnsweerd — but none of it is downloaded. COPC is a
Cloud Optimized Point Cloud: the octree index sits in the file header, so PDAL
can ask for a bounding box over HTTP range requests and pull only the nodes
that intersect it. A 240 m window around Prins Hendriklaan 17 costs ~11 s and a
few MB instead of 228, which is why this script is short enough to just run
again rather than something whose output needs to be archived.

Requires pdal. There isn't one on this box, so it goes through nix:

    python3 scripts/extract-hendriklaan.py

Writes public/data/hendriklaan.bin (interleaved, 8 bytes/point) and
public/data/hendriklaan.json (the header the sketch reads first).

Licence: AHN5 is CC BY 4.0 — Actueel Hoogtebestand Nederland. AHN4 covers the
same square under CC0, but AHN5 (2023-2024) is two years newer and the trees on
this street have grown; currency wins over the more permissive licence here.
"""
import csv
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data"

# https://basisdata.nl/hwh-portal/download/ — the portal's own tile index
# (AHN5_KM_PC.json) resolves this tile to exactly this object.
TILE = "AHN5_C_138000_455000"
SRC = f"https://fsn1.your-objectstorage.com/hwh-ahn/AHN5_KM/01_LAZ/{TILE}.COPC.LAZ"

# Prins Hendriklaan 17, 3583EB Utrecht, from the PDOK locatieserver:
# api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=Prins+Hendriklaan+17+Utrecht
ADDRESS = "Prins Hendriklaan 17, 3583EB Utrecht"
CX, CY = 138275.467, 455380.628      # EPSG:28992 (Amersfoort / RD New)
HALF = 120.0                          # a 240 m square, the block plus its trees

# Poisson thinning radius. 0.5 m leaves 352k points, 0.7 m leaves 202k; at 8
# bytes each that is 1.6 MB over the wire, which is the most a sketch should
# ask for. Below ~0.9 m the roof ridges and the tree trunks both survive.
RADIUS = 0.7

# Classes 7 (noise) and 18 (high noise) are the survey's own rejects — birds,
# rain, aircraft — and they sit at absurd heights that would set the vertical
# scale of the whole scene on their own.
DROP = "Classification![7:7],Classification![18:18]"


def pdal(args, cwd):
    """Run pdal, preferring one on PATH and falling back to nix."""
    if shutil.which("pdal"):
        cmd = ["pdal", *args]
    elif shutil.which("nix"):
        cmd = ["nix", "shell", "nixpkgs#pdal", "--command", "pdal", *args]
    else:
        sys.exit("need pdal (or nix, to fetch one)")
    subprocess.run(cmd, cwd=cwd, check=True)


def main():
    tmp = Path(tempfile.mkdtemp(prefix="hendriklaan-"))
    minx, maxx = CX - HALF, CX + HALF
    miny, maxy = CY - HALF, CY + HALF

    # One pipeline: windowed read over HTTP, drop the noise classes, thin to an
    # even spacing, write CSV. filters.sample is a 3D Poisson-disk pass, so it
    # thins the canopy and the road by the same rule rather than by a stride,
    # which would have decimated the sparse returns hardest.
    pipeline = [
        {"type": "readers.copc", "filename": SRC,
         "bounds": f"([{minx},{maxx}],[{miny},{maxy}])"},
        {"type": "filters.range", "limits": DROP},
        {"type": "filters.sample", "radius": RADIUS},
        {"type": "writers.text", "filename": "points.csv",
         "order": "X,Y,Z,Intensity,Classification",
         "keep_unspecified": "false"},
    ]
    (tmp / "pipeline.json").write_text(json.dumps(pipeline, indent=2))
    print(f"reading {HALF * 2:.0f} m window from {TILE} over HTTP…")
    pdal(["pipeline", "pipeline.json"], cwd=tmp)

    xs, ys, zs, ii, cc = [], [], [], [], []
    with open(tmp / "points.csv") as f:
        for row in csv.DictReader(f):
            xs.append(float(row["X"]))
            ys.append(float(row["Y"]))
            zs.append(float(row["Z"]))
            ii.append(int(float(row["Intensity"])))
            cc.append(int(float(row["Classification"])))
    n = len(xs)
    print(f"{n} points")

    zmin, zmax = min(zs), max(zs)
    # Quantise each axis over its own extent into uint16. 240 m / 65535 is 3.7
    # mm horizontally and the Z range is narrower still; the survey's own
    # accuracy is ~5 cm, so nothing measurable is lost and the file halves.
    sx = (maxx - minx) / 65535.0
    sy = (maxy - miny) / 65535.0
    sz = (zmax - zmin) / 65535.0

    # Intensity is heavily skewed — the mean sits at 1216 against a max of
    # 65535 — so a linear byte would render almost everything black. Log first.
    lmax = math.log1p(65535.0)

    order = list(range(n))
    # Deterministic shuffle. PDAL emits the window in octree order, so drawing
    # the first N points of the file unshuffled would fill one corner; shuffled,
    # a partial draw is an even sparse survey of the whole block, which is what
    # the sketch's build-up reveal leans on.
    rng = 0x9E3779B9
    for i in range(n - 1, 0, -1):
        rng = (rng * 1664525 + 1013904223) & 0xFFFFFFFF
        j = rng % (i + 1)
        order[i], order[j] = order[j], order[i]

    buf = bytearray(n * 8)
    pack = struct.pack_into
    for k, i in enumerate(order):
        pack("<HHHBB", buf, k * 8,
             min(65535, int((xs[i] - minx) / sx)),
             min(65535, int((ys[i] - miny) / sy)),
             min(65535, int((zs[i] - zmin) / sz)) if sz else 0,
             cc[i],
             min(255, int(255 * math.log1p(ii[i]) / lmax)))

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "hendriklaan.bin").write_bytes(buf)

    hist = {}
    for c in cc:
        hist[str(c)] = hist.get(str(c), 0) + 1

    header = {
        "source": SRC,
        "tile": TILE,
        "dataset": "AHN5 (2023-2024)",
        "licence": "CC BY 4.0 — Actueel Hoogtebestand Nederland",
        "crs": "EPSG:7415 (Amersfoort / RD New + NAP height)",
        "address": ADDRESS,
        "centre": [CX, CY],
        "bounds": [minx, miny, zmin, maxx, maxy, zmax],
        "count": n,
        "radius": RADIUS,
        "stride": 8,
        "layout": "uint16 x, uint16 y, uint16 z, uint8 classification, uint8 intensity (log)",
        "scale": [sx, sy, sz],
        "origin": [minx, miny, zmin],
        "classes": hist,
    }
    (OUT / "hendriklaan.json").write_text(json.dumps(header, indent=2) + "\n")

    size = (OUT / "hendriklaan.bin").stat().st_size
    print(f"public/data/hendriklaan.bin  {size / 1e6:.2f} MB")
    print(f"public/data/hendriklaan.json {json.dumps(hist)}")
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
