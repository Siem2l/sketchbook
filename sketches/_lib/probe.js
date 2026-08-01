// The one external seam a sketch has: a read-only view of exactly what the
// interface already shows. Nothing here can drive the sketch — a test clicks
// and types like a person, and reads state like a viewer.

export function probe(name, fields, layer) {
  if (typeof window === 'undefined') return;
  window[`__${name}`] = {
    ...fields,
    // Where a named control actually is, so a test never hardcodes a pixel and
    // breaks the moment the panel gains a row.
    buttonAt: (label) => {
      const b = layer.find(label);
      return b ? { x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) } : null;
    },
  };
}
