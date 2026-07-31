import { chromium } from 'playwright';
const slugs = ['2026-07-splinter','2026-07-inconstructions','2026-07-festival-season','2026-07-garmin-body','2026-07-message-noise'];
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:1200,height:900} });
for (const s of slugs){
  try{
    await p.goto(`https://sketches.siem2l.nl/sketches/${s}/`, {waitUntil:'networkidle', timeout:30000});
    await p.waitForTimeout(2500);
    await p.screenshot({ path:`public/sketches/${s}/thumb.png` });
    console.log('shot', s);
  }catch(e){ console.log('FAIL', s, e.message); }
}
await b.close();
