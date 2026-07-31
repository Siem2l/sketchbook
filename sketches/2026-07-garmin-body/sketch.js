// A Year in a Body — four insight views over daily Garmin metrics
// (resting HR, sleep, stress). The 386 day-marks are shared across views:
// switching view morphs each mark to its new position, so dots visibly flow
// from the year-ring into a timeline into a scatter. Hovering (or tapping)
// reads a single day into the corner panel with its exact numbers; idle, the
// panel shows the year's summary for the current view. Data is health-only
// (no GPS/location), fetched from the same-origin exporter endpoint.
import p5 from 'p5';

const PAPER = '#faf8f2', INK = '#18181b', INK2 = '#54524c', INK3 = '#8a877e',
      HAIR = '#d9d4c6', ACCENT = '#b5451d';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DUR = 620; // transition ms
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const VIEWS = [
  { key: 'overview', label: 'overview', title: 'the year, as a body clock',
    sub: 'each day a mark around the year · further from centre = lower resting heart rate' },
  { key: 'sleep', label: 'sleep', title: 'how you slept',
    sub: 'nightly hours asleep across the year · shaded band = deep + REM' },
  { key: 'rhr', label: 'resting hr', title: 'resting heart rate',
    sub: 'daily resting HR with a 14-day trend · lower trends with fitness' },
  { key: 'stress', label: 'stress · balance', title: 'stress vs. sleep',
    sub: 'each day: sleep score (→) against average stress (↑) · line = fitted trend' },
];

fetch('/data/garmin-body.json')
  .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
  .then((d) => start(d.health || []))
  .catch((e) => {
    const l = document.getElementById('loading'); if (l) l.remove();
    const err = document.createElement('div'); err.id = 'err';
    err.textContent = 'could not load data: ' + e.message;
    document.body.appendChild(err);
  });

function start(raw) {
  // normalise + sort
  const H = raw
    .filter((r) => r && r.day)
    .map((r) => ({
      day: r.day, t: Date.parse(r.day),
      month: new Date(r.day + 'T00:00:00').getMonth(),
      rhr: num(r.rhr), score: num(r.sleep_score), sleep: num(r.sleep),
      deep: num(r.deep), rem: num(r.rem), stress: num(r.stress),
    }))
    .sort((a, b) => a.t - b.t);
  const N = H.length;
  if (!N) { const l = document.getElementById('loading'); if (l) l.textContent = 'no data'; return; }

  const l = document.getElementById('loading'); if (l) l.remove();

  // data ranges (padded)
  const rhrs = H.map((d) => d.rhr).filter(isNum);
  const rhrMin = Math.min(...rhrs) - 2, rhrMax = Math.max(...rhrs) + 2;
  const sleepMax = Math.max(9, Math.ceil(Math.max(...H.map((d) => d.sleep || 0))));
  const stressMax = Math.max(30, Math.ceil(Math.max(...H.map((d) => d.stress || 0)) / 10) * 10);
  const trend = movingAvg(H.map((d) => d.rhr), 14);
  const reg = regression(H.filter((d) => isNum(d.score) && isNum(d.stress)).map((d) => [d.score, d.stress]));

  // summary scalars (for the idle readout + centre label)
  const rhrV = rhrs, sleepV = H.map((d) => d.sleep).filter(isNum),
        scoreV = H.map((d) => d.score).filter(isNum), stressV = H.map((d) => d.stress).filter(isNum);
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  const medR = Math.round(median(rhrV));
  const rhrLo = Math.min(...rhrV), rhrHi = Math.max(...rhrV);

  // month tick indices (first day of each visible month)
  const monthTicks = [];
  let lastKey = '';
  H.forEach((d, i) => { const k = d.day.slice(0, 7); if (k !== lastKey) { monthTicks.push({ i, m: d.month }); lastKey = k; } });

  new p5((p) => {
    let W, H2, geo, cur = 0, prev = 0, t0 = -1e9;
    let hx = -1, hy = -1;      // cursor in canvas space (-1 = off-canvas)
    let roKey = '';            // last readout key, to avoid redundant DOM writes

    const layout = () => {
      W = p.width; H2 = p.height;
      const padL = 60, padR = 30, padT = 100, padB = 52;
      const plotW = W - padL - padR, plotH = H2 - padT - padB;
      geo = {
        padL, padR, padT, padB, plotW, plotH,
        x0: padL, y0: padT, y1: padT + plotH,
        cx: W / 2, cy: padT + plotH / 2,
        Rmax: Math.min(plotW, plotH) / 2 * 0.94,
      };
    };

    p.setup = () => {
      p.createCanvas(window.innerWidth, window.innerHeight);
      p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
      layout();
      buildNav();
      setSub();
      readoutSummary();
      // pointer tracking drives hover; redraw on move so it works while idle
      const cv = p.canvas;
      const at = (e) => { const r = cv.getBoundingClientRect(); hx = e.clientX - r.left; hy = e.clientY - r.top; if (!p.isLooping()) p.redraw(); };
      cv.addEventListener('pointermove', at);
      cv.addEventListener('pointerdown', at);
      cv.addEventListener('pointerleave', () => { hx = -1; hy = -1; if (!p.isLooping()) p.redraw(); });
    };
    p.windowResized = () => { p.resizeCanvas(window.innerWidth, window.innerHeight); layout(); p.redraw(); };

    // ── mark position for a day i under a given view
    function pos(view, i) {
      const d = H[i], g = geo;
      const tx = (idx) => g.x0 + (idx / (N - 1)) * g.plotW;
      const yv = (v, lo, hi) => g.y1 - ((v - lo) / (hi - lo)) * g.plotH;
      switch (view) {
        case 0: { // overview: radial, radius ~ inverse rhr
          const ang = -Math.PI / 2 + (i / N) * Math.PI * 2;
          const rr = isNum(d.rhr)
            ? map(d.rhr, rhrMin, rhrMax, g.Rmax * 0.95, g.Rmax * 0.4)
            : g.Rmax * 0.68;
          return { x: g.cx + Math.cos(ang) * rr, y: g.cy + Math.sin(ang) * rr, vis: 1,
                   col: stressCol(d.stress) };
        }
        case 1: // sleep timeline
          return { x: tx(i), y: yv(d.sleep, 0, sleepMax), vis: isNum(d.sleep) ? 1 : 0, col: INK };
        case 2: // resting hr timeline
          return { x: tx(i), y: yv(d.rhr, rhrMin, rhrMax), vis: isNum(d.rhr) ? 1 : 0, col: INK };
        case 3: // stress vs sleep scatter
          return { x: g.x0 + (clamp(d.score, 0, 100) / 100) * g.plotW,
                   y: yv(d.stress, 0, stressMax),
                   vis: isNum(d.score) && isNum(d.stress) ? 1 : 0, col: INK };
      }
    }

    // ── per-view chrome (axes / fills / trend), drawn at alpha a
    function chrome(view, a) {
      if (a <= 0.01) return;
      const g = geo;
      p.push();
      const A = (hex, mul = 1) => p.color(...rgb(hex), 255 * a * mul);
      p.textFont('ui-monospace, monospace');

      if (view === 0) {
        // concentric guide rings + radial bpm scale
        p.noFill(); p.stroke(A(HAIR)); p.strokeWeight(1);
        for (const f of [0.4, 0.6, 0.8, 0.95]) p.circle(g.cx, g.cy, g.Rmax * 2 * f);
        p.noStroke(); p.fill(A(INK3)); p.textAlign(p.CENTER, p.CENTER); p.textSize(9);
        for (const f of [0.4, 0.6, 0.8, 0.95]) {
          p.text(Math.round(map(f, 0.95, 0.4, rhrMin, rhrMax)) + '', g.cx, g.cy - g.Rmax * f);
        }
        // month spokes + labels
        p.stroke(A(HAIR, 0.8));
        monthTicks.forEach((mt) => {
          const ang = -Math.PI / 2 + (mt.i / N) * Math.PI * 2;
          p.stroke(A(HAIR, 0.8));
          p.line(g.cx + Math.cos(ang) * g.Rmax * 0.38, g.cy + Math.sin(ang) * g.Rmax * 0.38,
                 g.cx + Math.cos(ang) * g.Rmax, g.cy + Math.sin(ang) * g.Rmax);
          p.noStroke(); p.fill(A(INK3)); p.textAlign(p.CENTER, p.CENTER); p.textSize(10);
          p.text(MONTHS[mt.m], g.cx + Math.cos(ang) * (g.Rmax + 14), g.cy + Math.sin(ang) * (g.Rmax + 14));
        });
        // ring line connecting the marks (the year's rhr profile)
        p.noFill(); p.stroke(A(INK, 0.5)); p.strokeWeight(1);
        p.beginShape();
        for (let i = 0; i < N; i++) { const q = pos(0, i); p.vertex(q.x, q.y); }
        p.endShape(p.CLOSE);
        // centre summary readout
        p.noStroke(); p.fill(A(INK3)); p.textAlign(p.CENTER, p.CENTER); p.textSize(9);
        p.text('MEDIAN RESTING', g.cx, g.cy - 17);
        p.fill(A(INK)); p.textSize(27); p.text(medR + '', g.cx, g.cy + 4);
        p.fill(A(INK2)); p.textSize(9); p.text('bpm', g.cx, g.cy + 22);
      } else if (view === 1) {
        yGrid(A, 0, sleepMax, 'h', (v) => v, 5);
        xMonths(A);
        fillArea(0.10, INK, (i) => pos(1, i));
        fillArea(0.16, ACCENT, (i) => {
          const d = H[i]; const g2 = geo;
          const v = (isNum(d.deep) ? d.deep : 0) + (isNum(d.rem) ? d.rem : 0);
          return { x: g2.x0 + (i / (N - 1)) * g2.plotW, y: g2.y1 - (v / sleepMax) * g2.plotH,
                   vis: isNum(d.sleep) ? 1 : 0 };
        });
        p.noFill(); p.stroke(A(INK, 0.55)); p.strokeWeight(1.2);
        line2(A, (i) => pos(1, i));
        const avg = mean(sleepV);
        const yA = geo.y1 - (avg / sleepMax) * geo.plotH;
        p.stroke(A(INK3)); p.strokeWeight(1); dash(geo.x0, yA, geo.x0 + geo.plotW, yA);
        p.noStroke(); p.fill(A(INK2)); p.textAlign(p.LEFT, p.BOTTOM); p.textSize(10);
        p.text('avg ' + avg.toFixed(1) + 'h', geo.x0 + 4, yA - 3);
        callout(A, argExt(H, 'sleep', 1), (i) => pos(1, i), 'best', -1);
        callout(A, argExt(H, 'sleep', -1), (i) => pos(1, i), 'worst', 1);
      } else if (view === 2) {
        yGrid(A, rhrMin, rhrMax, ' bpm', (v) => Math.round(v), 5);
        xMonths(A);
        p.noFill(); p.stroke(A(ACCENT, 0.9)); p.strokeWeight(1.6);
        p.beginShape();
        for (let i = 0; i < N; i++) if (isNum(trend[i])) {
          p.vertex(geo.x0 + (i / (N - 1)) * geo.plotW, geo.y1 - ((trend[i] - rhrMin) / (rhrMax - rhrMin)) * geo.plotH);
        }
        p.endShape();
        callout(A, argExt(H, 'rhr', -1), (i) => pos(2, i), 'lowest', 1);
        callout(A, argExt(H, 'rhr', 1), (i) => pos(2, i), 'highest', -1);
      } else if (view === 3) {
        // axes + numbered ticks
        p.stroke(A(HAIR)); p.strokeWeight(1);
        p.line(geo.x0, geo.y1, geo.x0 + geo.plotW, geo.y1);
        p.line(geo.x0, geo.y0, geo.x0, geo.y1);
        p.textSize(9);
        p.textAlign(p.CENTER, p.TOP);
        for (const s of [0, 25, 50, 75, 100]) {
          const x = geo.x0 + (s / 100) * geo.plotW;
          p.stroke(A(HAIR, 0.45)); p.strokeWeight(1); p.line(x, geo.y0, x, geo.y1);
          p.noStroke(); p.fill(A(INK3)); p.text(s + '', x, geo.y1 + 5);
        }
        p.textAlign(p.RIGHT, p.CENTER);
        for (let k = 0; k <= 4; k++) {
          const v = (k / 4) * stressMax, y = geo.y1 - (k / 4) * geo.plotH;
          p.noStroke(); p.fill(A(INK3)); p.text(Math.round(v) + '', geo.x0 - 8, y);
        }
        p.noStroke(); p.fill(A(INK3)); p.textSize(10);
        p.textAlign(p.CENTER, p.TOP); p.text('sleep score →', geo.cx, geo.y1 + 20);
        p.push(); p.translate(geo.x0 - 42, geo.cy); p.rotate(-Math.PI / 2);
        p.textAlign(p.CENTER, p.BOTTOM); p.text('← stress', 0, 0); p.pop();
        if (reg) {
          p.stroke(A(ACCENT, 0.9)); p.strokeWeight(1.6);
          const yy = (s) => geo.y1 - ((reg.m * s + reg.b) / stressMax) * geo.plotH;
          p.line(geo.x0, clampY(yy(0)), geo.x0 + geo.plotW, clampY(yy(100)));
        }
      }
      p.pop();
    }

    // shared drawing helpers ------------------------------------------------
    let currentAlpha = 1;
    const line2 = (A, fn) => { p.beginShape(); for (let i = 0; i < N; i++) { const q = fn(i); if (q.vis) p.vertex(q.x, q.y); } p.endShape(); };
    const fillArea = (opacity, hex, fn) => {
      p.noStroke(); p.fill(p.color(...rgb(hex), 255 * opacity * currentAlpha));
      p.beginShape(); let started = false;
      for (let i = 0; i < N; i++) { const q = fn(i); if (q.vis) { p.vertex(q.x, q.y); started = true; } }
      if (started) { p.vertex(geo.x0 + geo.plotW, geo.y1); p.vertex(geo.x0, geo.y1); }
      p.endShape(p.CLOSE);
    };
    const yGrid = (A, lo, hi, unit, fmt, n) => {
      p.textAlign(p.RIGHT, p.CENTER); p.textSize(10);
      for (let k = 0; k <= n; k++) {
        const v = lo + (k / n) * (hi - lo);
        const y = geo.y1 - (k / n) * geo.plotH;
        p.stroke(A(HAIR, 0.7)); p.strokeWeight(1); p.line(geo.x0, y, geo.x0 + geo.plotW, y);
        p.noStroke(); p.fill(A(INK3)); p.text(fmt(v) + unit, geo.x0 - 8, y);
      }
    };
    const xMonths = (A) => {
      p.textAlign(p.CENTER, p.TOP); p.textSize(10); p.fill(A(INK3));
      monthTicks.forEach((mt) => {
        const x = geo.x0 + (mt.i / (N - 1)) * geo.plotW;
        p.stroke(A(HAIR, 0.5)); p.line(x, geo.y0, x, geo.y1);
        p.noStroke(); p.text(MONTHS[mt.m], x, geo.y1 + 6);
      });
    };
    const dash = (x1, y1, x2, y2) => { const seg = 6; const d = p.dist(x1, y1, x2, y2); const n = d / (seg * 2); for (let k = 0; k < n; k++) { const a = k / n, b = Math.min(1, (k + 0.5) / n); p.line(p.lerp(x1, x2, a), p.lerp(y1, y2, a), p.lerp(x1, x2, b), p.lerp(y1, y2, b)); } };
    const callout = (A, i, fn, label, dir) => {
      if (i < 0) return; const q = fn(i);
      p.noStroke(); p.fill(A(ACCENT)); p.circle(q.x, q.y, 5);
      p.fill(A(INK)); p.textSize(10); p.textAlign(p.CENTER, dir < 0 ? p.BOTTOM : p.TOP);
      p.text(label + ' · ' + H[i].day.slice(5), q.x, q.y + dir * 8);
    };
    const clampY = (y) => Math.max(geo.y0, Math.min(geo.y1, y));

    // ── hover: nearest visible mark in the current view, then highlight it
    function nearest(mx, my) {
      if (mx < 0) return -1;
      let bi = -1, bd = 22 * 22;
      for (let i = 0; i < N; i++) {
        const q = pos(cur, i); if (q.vis < 0.5) continue;
        const dx = q.x - mx, dy = q.y - my, dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; bi = i; }
      }
      return bi;
    }
    function highlightMark(i) {
      const q = pos(cur, i);
      p.push();
      if (cur === 0) { p.stroke(...rgb(INK3), 120); p.strokeWeight(1); p.line(geo.cx, geo.cy, q.x, q.y); }
      else if (cur === 3) { p.stroke(...rgb(HAIR)); p.strokeWeight(1); p.line(geo.x0, q.y, geo.x0 + geo.plotW, q.y); p.line(q.x, geo.y0, q.x, geo.y1); }
      else { p.stroke(...rgb(HAIR)); p.strokeWeight(1); p.line(q.x, geo.y0, q.x, geo.y1); }
      p.noFill(); p.stroke(...rgb(ACCENT)); p.strokeWeight(1.8); p.circle(q.x, q.y, 12);
      p.fill(...rgb(PAPER)); p.stroke(...rgb(ACCENT)); p.strokeWeight(1.4); p.circle(q.x, q.y, 5);
      p.pop();
    }

    // ── readout panel (always populated: a hovered day, else the year)
    const setHTML = (html) => { const el = document.getElementById('readout'); if (el) el.innerHTML = html; };
    function readoutDay(i) {
      const d = H[i];
      const wd = WEEKDAY[new Date(d.day + 'T00:00:00').getDay()];
      const rows = [
        metric('resting hr', isNum(d.rhr) ? d.rhr : '–', ' bpm'),
        metric('stress', isNum(d.stress) ? d.stress : '–', ' /100'),
        metric('sleep score', isNum(d.score) ? d.score : '–', ' /100'),
        metric('slept', isNum(d.sleep) ? d.sleep.toFixed(1) : '–', ' h'),
      ].join('');
      let bar = '';
      if (isNum(d.sleep) && d.sleep > 0) {
        const deep = clamp((d.deep || 0) / d.sleep, 0, 1) * 100;
        const rem = clamp((d.rem || 0) / d.sleep, 0, 1) * 100;
        const light = Math.max(0, 100 - deep - rem);
        bar = '<div class="sleepbar">'
          + '<i style="width:' + deep + '%;background:' + INK + '"></i>'
          + '<i style="width:' + rem + '%;background:' + INK3 + '"></i>'
          + '<i style="width:' + light + '%;background:' + HAIR + '"></i></div>'
          + '<p class="rnote">deep ' + (d.deep || 0).toFixed(1) + 'h · rem ' + (d.rem || 0).toFixed(1)
          + 'h · light ' + Math.max(0, d.sleep - (d.deep || 0) - (d.rem || 0)).toFixed(1) + 'h</p>';
      }
      setHTML('<p class="rday">' + wd + ', ' + d.day.slice(8, 10) + ' ' + MONTHS[d.month] + '</p>'
        + '<p class="rsub">' + d.day.slice(0, 4) + '</p>'
        + '<div class="metrics">' + rows + '</div>' + bar);
    }
    function readoutSummary() {
      let rows;
      if (cur === 1) {
        const bi = argExt(H, 'sleep', 1), wi = argExt(H, 'sleep', -1);
        rows = [metric('mean sleep', mean(sleepV).toFixed(1), ' h'), metric('mean score', Math.round(mean(scoreV)), ' /100'),
                metric('best', H[bi].sleep.toFixed(1), ' h'), metric('shortest', H[wi].sleep.toFixed(1), ' h')];
      } else if (cur === 2) {
        rows = [metric('median rhr', medR, ' bpm'), metric('lowest', rhrLo, ' bpm'),
                metric('highest', rhrHi, ' bpm'), metric('spread', (rhrHi - rhrLo), ' bpm')];
      } else if (cur === 3) {
        rows = [metric('mean stress', Math.round(mean(stressV)), ' /100'), metric('mean score', Math.round(mean(scoreV)), ' /100'),
                metric('calmest', Math.min(...stressV), ' /100'), metric('peak', Math.max(...stressV), ' /100')];
      } else {
        rows = [metric('median rhr', medR, ' bpm'), metric('rhr range', rhrLo + '–' + rhrHi, ''),
                metric('mean sleep', mean(sleepV).toFixed(1), ' h'), metric('mean stress', Math.round(mean(stressV)), ' /100')];
      }
      const note = cur === 3 && reg
        ? (reg.m < 0 ? 'trend: better sleep, lower stress' : 'trend: better sleep, higher stress')
        : VIEWS[cur].sub;
      setHTML('<p class="rday">the year</p>'
        + '<p class="rsub">' + H[0].day + ' → ' + H[N - 1].day + ' · ' + N + ' days</p>'
        + '<div class="metrics">' + rows.join('') + '</div>'
        + '<p class="rnote">' + note + '</p>');
    }

    // ── main loop
    p.draw = () => {
      const e = reduced ? 1 : easeInOut(clamp((p.millis() - t0) / DUR, 0, 1));
      p.background(PAPER);

      currentAlpha = 1 - clamp(e / 0.55, 0, 1);
      chrome(prev, currentAlpha);
      currentAlpha = clamp((e - 0.45) / 0.55, 0, 1);
      chrome(cur, currentAlpha);

      // marks morph
      p.noStroke();
      for (let i = 0; i < N; i++) {
        const a = pos(prev, i), b = pos(cur, i);
        const x = p.lerp(a.x, b.x, e), y = p.lerp(a.y, b.y, e);
        const vis = p.lerp(a.vis, b.vis, e);
        if (vis < 0.02) continue;
        const c = lerpCol(a.col || INK, b.col || INK, e);
        p.fill(p.color(c[0], c[1], c[2], 235 * vis));
        p.circle(x, y, cur === 0 || prev === 0 ? 3.2 : 2.6);
      }

      // hover, once the transition settles. Collapse prev→cur so every
      // subsequent redraw (driven by pointermove) is a stable single view
      // — otherwise cur!==prev after any switch and hover only ever ran on
      // the initial overview page.
      if (e >= 1) {
        prev = cur;
        const inside = hx >= 0 && hx <= W && hy >= 0 && hy <= H2;
        const hi = inside ? nearest(hx, hy) : -1;
        if (hi >= 0) { highlightMark(hi); setReadout('d' + hi, () => readoutDay(hi)); }
        else setReadout('sum' + cur, readoutSummary);
        p.noLoop();
      }
    };
    function setReadout(key, fn) { if (key === roKey) return; roKey = key; fn(); }

    // ── nav
    function buildNav() {
      const nav = document.getElementById('nav'); nav.innerHTML = '';
      VIEWS.forEach((v, idx) => {
        const b = document.createElement('button');
        b.textContent = v.label; b.setAttribute('aria-current', idx === cur);
        b.onclick = () => go(idx); nav.appendChild(b);
      });
    }
    function setSub() { const s = document.getElementById('sub'); if (s) s.textContent = VIEWS[cur].sub; }
    function go(idx) {
      if (idx === cur) return;
      prev = cur; cur = idx; t0 = p.millis();
      document.querySelectorAll('#nav button').forEach((b, k) => b.setAttribute('aria-current', k === cur));
      setSub(); roKey = 'sum' + cur; readoutSummary(); p.loop();
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') go((cur + 1) % VIEWS.length);
      if (e.key === 'ArrowLeft') go((cur - 1 + VIEWS.length) % VIEWS.length);
    });
  });
}

// ── utils
function metric(k, v, u) { return '<div class="metric"><div class="k">' + k + '</div><div class="v">' + v + '<small>' + (u || '') + '</small></div></div>'; }
function num(v) { return v === null || v === undefined || v === '' ? null : +v; }
function isNum(v) { return typeof v === 'number' && !Number.isNaN(v); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function map(v, a, b, c, d) { return c + ((v - a) / (b - a)) * (d - c); }
function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function movingAvg(arr, w) {
  const out = arr.map(() => null);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(arr.length - 1, i + w); k++) if (isNum(arr[k])) { s += arr[k]; n++; }
    if (n) out[i] = s / n;
  }
  return out;
}
function regression(pts) {
  if (pts.length < 3) return null;
  const n = pts.length; let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxy += x * y; sxx += x * x; }
  const m = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { m, b: (sy - m * sx) / n };
}
function argExt(H, key, dir) {
  let bi = -1, bv = dir > 0 ? -Infinity : Infinity;
  H.forEach((d, i) => { const v = d[key]; if (isNum(v) && (dir > 0 ? v > bv : v < bv)) { bv = v; bi = i; } });
  return bi;
}
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function lerpCol(a, b, t) {
  const ca = typeof a === 'string' ? rgb(a) : a, cb = typeof b === 'string' ? rgb(b) : b;
  return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
}
function stressCol(s) {
  if (!isNum(s)) return rgb(INK3);
  const t = clamp(s / 60, 0, 1);
  return lerpCol(INK, ACCENT, t);
}
