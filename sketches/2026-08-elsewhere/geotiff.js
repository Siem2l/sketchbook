// A GeoTIFF reader that reads exactly the one thing PDOK's AHN coverage service
// emits: single-band float32, deflate, floating-point predictor, striped.
//
// There is no dependency here because the platform already has the hard part.
// DecompressionStream('deflate') is the inflate; the rest is tag reading.
//
// The two steps that go wrong go wrong quietly, and both are in the predictor.
// libtiff's floating-point predictor accumulates bytes with stride 1 — not the
// row width, which is the intuitive and wrong reading — and then de-interleaves
// four byte planes in REVERSE order. Get either wrong and you still get finite
// numbers that look like data: the first attempt at this produced a maximum of
// 3.4e38 and a centre cell of exactly 0.00.

const TAG = {
  WIDTH: 256, HEIGHT: 257, BITS: 258, COMPRESSION: 259, STRIP_OFFSETS: 273,
  SAMPLES: 277, ROWS_PER_STRIP: 278, STRIP_BYTE_COUNTS: 279, PREDICTOR: 317,
  SAMPLE_FORMAT: 339, GDAL_NODATA: 42113,
};
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4 };

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodeFloatTiff(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  const le = u8[0] === 0x49 && u8[1] === 0x49;
  if (!le && !(u8[0] === 0x4d && u8[1] === 0x4d)) throw new Error('not a TIFF');
  if (dv.getUint16(2, le) !== 42) throw new Error('not a classic TIFF');

  const ifd = dv.getUint32(4, le);
  const entries = dv.getUint16(ifd, le);
  const tags = new Map();
  for (let i = 0; i < entries; i++) {
    const e = ifd + 2 + i * 12;
    tags.set(dv.getUint16(e, le), {
      type: dv.getUint16(e + 2, le),
      n: dv.getUint32(e + 4, le),
      at: e + 8,
    });
  }

  const values = (tag) => {
    const t = tags.get(tag);
    if (!t) return null;
    const stride = TYPE_SIZE[t.type] ?? 1;
    // Values totalling four bytes or fewer are inlined in the entry itself.
    const base = t.n * stride <= 4 ? t.at : dv.getUint32(t.at, le);
    const out = new Array(t.n);
    for (let i = 0; i < t.n; i++) {
      const o = base + i * stride;
      out[i] = t.type === 3 ? dv.getUint16(o, le)
        : t.type === 4 ? dv.getUint32(o, le)
        : dv.getUint8(o);
    }
    return out;
  };
  const one = (tag, dflt) => values(tag)?.[0] ?? dflt;

  const width = one(TAG.WIDTH);
  const height = one(TAG.HEIGHT);
  const bits = one(TAG.BITS, 32);
  const samples = one(TAG.SAMPLES, 1);
  const format = one(TAG.SAMPLE_FORMAT, 1);
  const compression = one(TAG.COMPRESSION, 1);
  const predictor = one(TAG.PREDICTOR, 1);
  if (samples !== 1) throw new Error(`expected one band, got ${samples}`);
  if (bits !== 32 || format !== 3) throw new Error(`expected float32, got ${bits}-bit format ${format}`);
  if (compression !== 1 && compression !== 8) throw new Error(`unsupported compression ${compression}`);
  if (predictor !== 1 && predictor !== 3) throw new Error(`unsupported predictor ${predictor}`);

  let nodata = NaN;
  const nd = tags.get(TAG.GDAL_NODATA);
  if (nd) {
    const base = nd.n <= 4 ? nd.at : dv.getUint32(nd.at, le);
    nodata = Number(new TextDecoder().decode(u8.subarray(base, base + nd.n)).replace(/\0+$/, ''));
  }

  const offsets = values(TAG.STRIP_OFFSETS);
  const counts = values(TAG.STRIP_BYTE_COUNTS);
  const rowsPerStrip = one(TAG.ROWS_PER_STRIP, height);
  const rowBytes = width * 4;
  const data = new Float32Array(width * height);
  const planeBytes = new Uint8Array(rowBytes);
  const planeView = new DataView(planeBytes.buffer);

  // Every strip at once rather than one after another. Each inflate is a whole
  // stream pipeline that yields to the event loop, and a 480-row raster has 120
  // of them; sequentially, against a busy main thread, that is a minute.
  const strips = compression === 8
    ? await Promise.all(offsets.map((o, i) => inflate(u8.subarray(o, o + counts[i]))))
    : offsets.map((o, i) => u8.subarray(o, o + counts[i]));

  let row = 0;
  for (let s = 0; s < offsets.length && row < height; s++) {
    const strip = strips[s];
    const rows = Math.min(rowsPerStrip, height - row);
    for (let r = 0; r < rows; r++, row++) {
      const line = strip.subarray(r * rowBytes, (r + 1) * rowBytes);
      if (predictor === 3) {
        planeBytes.set(line);
        for (let i = 1; i < planeBytes.length; i++) {
          planeBytes[i] = (planeBytes[i] + planeBytes[i - 1]) & 0xff;
        }
        // Byte planes back into float order. The plane holding a sample's most
        // significant byte is the last one, hence 3 - b.
        const out = new Uint8Array(rowBytes);
        for (let c = 0; c < width; c++) {
          for (let b = 0; b < 4; b++) out[c * 4 + b] = planeBytes[(3 - b) * width + c];
        }
        const ov = new DataView(out.buffer);
        for (let c = 0; c < width; c++) data[row * width + c] = ov.getFloat32(c * 4, le);
      } else {
        planeView.buffer && planeBytes.set(line);
        for (let c = 0; c < width; c++) data[row * width + c] = planeView.getFloat32(c * 4, le);
      }
    }
  }
  return { width, height, data, nodata };
}
