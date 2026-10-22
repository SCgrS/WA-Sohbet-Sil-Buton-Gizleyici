// simgeler/*.png dosyalarını SVG'den görünmez Chrome ile üretir: node araclar/simge-uret.mjs
// Yeşil zemin üzerinde beyaz çöp kutusu ve önünde sarı kalkan. 16 ve 32 px'te çizgiler sadeleşir (ince ayrıntı okunmuyor).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeBaslat, sekmeAc } from './cdp.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const YESIL = '#1e7f5c';
const KOYU = '#145c42';
const SARI = '#f5b400';

export const BUYUK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="100%" height="100%">
  <rect x="4" y="4" width="120" height="120" rx="28" fill="${YESIL}"/>
  <path d="M50 30v-6a5 5 0 0 1 5-5h16a5 5 0 0 1 5 5v6" fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>
  <rect x="24" y="29" width="76" height="11" rx="5.5" fill="#fff"/>
  <path d="M31 46h62l-5.5 58a8 8 0 0 1-8 7.3H44.5a8 8 0 0 1-8-7.3z" fill="#fff"/>
  <path d="M50 58v40M62 58v40M74 58v32" stroke="${YESIL}" stroke-width="5.5" stroke-linecap="round"/>
  <path d="M93 60l23 8.5v18c0 15.5-10 26.5-23 32-13-5.5-23-16.5-23-32v-18z" fill="${SARI}" stroke="${YESIL}" stroke-width="6" stroke-linejoin="round"/>
  <path d="M83 88.5l7 7 13.5-14" fill="none" stroke="${KOYU}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const KUCUK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="100%" height="100%">
  <rect x="0" y="0" width="16" height="16" rx="3.5" fill="${YESIL}"/>
  <rect x="2.4" y="3" width="9.2" height="1.8" rx=".9" fill="#fff"/>
  <path d="M5.4 3V2.2h3.2V3" fill="none" stroke="#fff" stroke-width="1.1"/>
  <path d="M3.2 5.6h7.6l-.7 7.4a1 1 0 0 1-1 .9H4.9a1 1 0 0 1-1-.9z" fill="#fff"/>
  <path d="M11.6 7.2l3.4 1.3v2.4c0 2.2-1.5 3.8-3.4 4.6-1.9-.8-3.4-2.4-3.4-4.6V8.5z" fill="${SARI}" stroke="${YESIL}" stroke-width="1.1" stroke-linejoin="round"/>
</svg>`;

async function uret() {
  const c = await chromeBaslat();
  try {
    const s = await sekmeAc(c, 'about:blank');
    await s.g('Page.enable');
    await s.g('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    fs.mkdirSync(path.join(KOK, 'simgeler'), { recursive: true });
    for (const boy of [16, 32, 48, 128]) {
      const ad = `${boy}.png`;
      await s.g('Emulation.setDeviceMetricsOverride', { width: boy, height: boy, deviceScaleFactor: 1, mobile: false });
      const frameId = (await s.g('Page.getFrameTree')).frameTree.frame.id;
      const svg = boy >= 48 ? BUYUK_SVG : KUCUK_SVG;
      await s.g('Page.setDocumentContent', {
        frameId,
        html: `<!doctype html><html><body style="margin:0;background:transparent"><div style="width:${boy}px;height:${boy}px">${svg}</div></body></html>`
      });
      await new Promise(r => setTimeout(r, 200));
      const { data } = await s.g('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: boy, height: boy, scale: 1 } });
      fs.writeFileSync(path.join(KOK, 'simgeler', ad), Buffer.from(data, 'base64'));
      console.log(`simgeler/${ad}`);
    }
    fs.writeFileSync(path.join(KOK, 'araclar', 'simge.svg'), BUYUK_SVG + '\n');
  } finally {
    c.kapat();
  }
}

if (process.argv[1] && process.argv[1].endsWith('simge-uret.mjs')) await uret();
