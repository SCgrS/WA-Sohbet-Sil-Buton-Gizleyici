// README görsellerini üretir: node araclar/gorsel-uret.mjs
//   belgeler/gorseller/sorun.png   Eklenti yokken: Mesaja sağ tık → "Sil", biraz yanına sağ tık → aynı yerde "Sohbeti sil".
//   belgeler/gorseller/cozum.png   Aynı iki sağ tık eklentiyle.
// Eklenti görünmez Chrome'a yüklenir. araclar/tanitim.html sayfası eklentili görünüm için https://web.whatsapp.com/,
// eklentisiz görünüm için https://example.com/ adresinde sunulur (eklenti yalnızca WhatsApp adresinde çalışır). Gerçek
// siteye gidilmez, ad çözümlemesi kapalıdır. Gizlemeyi eklentinin kendisi yapar. Görsellerde gerçek ad ya da mesaj yoktur.
// İngilizce WhatsApp arayüzüyle aynı görseller: node araclar/gorsel-uret.mjs --dil en <çıktı klasörü>
// (mağazanın İngilizce sayfası için, README görsellerine dokunmaz).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromeBaslat, sekmeAc, ifadeBekle, degerlendir } from './cdp.mjs';
import { KOK, eklentiyiKopyala } from './paketle.mjs';

const ARGUMANLAR = process.argv.slice(2);
const DIL = ARGUMANLAR[0] === '--dil' ? ARGUMANLAR[1] : 'tr';
if (!['tr', 'en'].includes(DIL)) throw new Error(`bilinmeyen dil: ${DIL}`);
if (DIL !== 'tr' && !ARGUMANLAR[2]) throw new Error('kullanım: node araclar/gorsel-uret.mjs --dil en <çıktı klasörü>');
const CIKTI = DIL === 'tr' ? path.join(KOK, 'belgeler', 'gorseller') : path.resolve(ARGUMANLAR[2]);
// Seçenek adları araclar/tanitim.html'deki menülerle aynı.
const ETIKET = {
  tr: { sil: 'Sil', temizle: 'Sohbeti temizle', sohbetiSil: 'Sohbeti sil' },
  en: { sil: 'Delete', temizle: 'Clear chat', sohbetiSil: 'Delete chat' }
}[DIL];
const TANITIM = fs.readFileSync(path.join(KOK, 'araclar', 'tanitim.html'));
const OLCEK = 2;
const YESIL = '#1f9d55';
const KIRMIZI = '#e5484d';
const bekle = ms => new Promise(r => setTimeout(r, ms));

// Seçici sayfada çalışan kodun metnine yazılmaz, işleve değer olarak verilir.
async function goruntu(g, secici) {
  const { result: belge } = await g('Runtime.evaluate', { expression: 'document' });
  const yanit = await g('Runtime.callFunctionOn', {
    objectId: belge.objectId,
    functionDeclaration: `function (secici) { const r = this.querySelector(secici).getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 }; }`,
    arguments: [{ value: secici }],
    returnByValue: true
  });
  if (yanit.exceptionDetails) throw new Error(`${secici}: ` + (yanit.exceptionDetails.exception?.description || yanit.exceptionDetails.text));
  const kutu = yanit.result.value;
  const { data } = await g('Page.captureScreenshot', { format: 'png', clip: kutu, captureBeyondViewport: true });
  return Buffer.from(data, 'base64');
}

// Sahneler: tanitim.html'deki window.tanitim ile kurulur. Sağ tık noktası kendi gönderdiğimiz bir mesajda (silinen
// çoğunlukla kendi mesajımızdır): "mesaj" balonun hemen solunda, "yan" biraz daha solda, balonun dışında. Menüler
// gerçek WhatsApp Web'deki gibi farenin olduğu yerden aşağı açılır.
const SAHNELER = {
  mesajaSagTik: { kur: `(() => { const t = tanitim; t.kisiSohbeti(); const b = t.kutu('#hedef-mesaj');
      const x = b.x - 16, y = b.y + b.h * 0.5; t.menuAc('mesaj', x, y); t.imlec(x, y); return true; })()`,
    isaret: [[[ETIKET.sil], YESIL]] },
  yaninaSagTik: { kur: `(() => { const t = tanitim; t.kisiSohbeti(); const b = t.kutu('#hedef-mesaj');
      const x = b.x - 70, y = b.y + b.h * 0.5; t.menuAc('sohbetKisi', x, y); t.imlec(x, y); return true; })()`,
    isaret: [[[ETIKET.temizle, ETIKET.sohbetiSil], KIRMIZI]] }
};

async function birlestir(c, hucreler, sutun) {
  const b = await sekmeAc(c, 'about:blank');
  await b.g('Page.enable');
  await b.g('Emulation.setDeviceMetricsOverride', { width: 1180, height: 1800, deviceScaleFactor: OLCEK, mobile: false });
  await b.g('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const frameId = (await b.g('Page.getFrameTree')).frameTree.frame.id;
  const resim = buf => `data:image/png;base64,${buf.toString('base64')}`;
  const hucre = h => `<figure style="margin:0;width:520px;text-align:center"><img src="${resim(h.resim)}" style="width:520px;display:block">
    <figcaption style="margin-top:14px;line-height:1.45">${h.yazi}</figcaption></figure>`;
  await b.g('Page.setDocumentContent', {
    frameId,
    html: `<!doctype html><html><body style="margin:0;background:transparent;font:500 19px 'Segoe UI',system-ui,sans-serif;color:#8b949e">
      <div id="birlesik" style="display:inline-grid;grid-template-columns:repeat(${sutun},520px);gap:34px 44px;padding:10px">
        ${hucreler.map(hucre).join('')}</div></body></html>`
  });
  await ifadeBekle(b.g, '[...document.images].every(i => i.complete && i.naturalWidth)');
  const png = await goruntu(b.g, '#birlesik');
  await c.gonder('Target.closeTarget', { targetId: b.targetId });
  return png;
}

async function uret() {
  fs.mkdirSync(CIKTI, { recursive: true });
  const klasor = eklentiyiKopyala(fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sil-gorsel-')));
  const c = await chromeBaslat({ ekler: ['--host-resolver-rules=MAP * ~NOTFOUND'] });
  try {
    await c.gonder('Extensions.loadUnpacked', { path: klasor });
    const s = await sekmeAc(c, 'about:blank');
    await s.g('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    c.dinle(m => {
      if (m.method !== 'Fetch.requestPaused' || m.sessionId !== s.sessionId) return;
      const u = new URL(m.params.request.url);
      (['web.whatsapp.com', 'example.com'].includes(u.hostname) && u.pathname === '/'
        ? s.g('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: TANITIM.toString('base64') })
        : s.g('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' })).catch(() => {});
    });
    await s.g('Emulation.setDeviceMetricsOverride', { width: 560, height: 840, deviceScaleFactor: OLCEK, mobile: false });
    await s.g('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });

    const sahne = async (ad, eklentili) => {
      await s.g('Page.navigate', { url: (eklentili ? 'https://web.whatsapp.com/' : 'https://example.com/') + (DIL === 'tr' ? '' : `?dil=${DIL}`) });
      await s.g('Page.bringToFront');
      await ifadeBekle(s.g, "document.readyState === 'complete' && typeof window.tanitim === 'object'");
      await bekle(150);
      await degerlendir(s.g, SAHNELER[ad].kur);
      await bekle(100);
      const gizli = await degerlendir(s.g, "[...document.querySelectorAll('[role=menuitem]')].filter(b => !b.checkVisibility()).length");
      if (!eklentili && gizli) throw new Error(`${ad}: eklentisiz görünümde bir şey gizlendi`);
      if (eklentili && ad !== 'mesajaSagTik' && !gizli) throw new Error(`${ad}: eklenti gizlemedi`);
      if (eklentili && ad === 'mesajaSagTik' && gizli) throw new Error(`${ad}: mesaj menüsünde bir şey gizlendi`);
      if (!eklentili) {
        for (const [etiketler, renk] of SAHNELER[ad].isaret) {
          if (!await degerlendir(s.g, `tanitim.isaretle(${JSON.stringify(etiketler)}, ${JSON.stringify(renk)})`)) throw new Error(`${ad}: işaretlenecek seçenek yok`);
        }
      } else if (ad === 'mesajaSagTik') {
        await degerlendir(s.g, `tanitim.isaretle(${JSON.stringify([ETIKET.sil])}, ${JSON.stringify(YESIL)})`);
      }
      return goruntu(s.g, '#app');
    };

    const yesil = t => `<b style="color:${YESIL}">${t}</b>`;
    const kirmizi = t => `<b style="color:${KIRMIZI}">${t}</b>`;
    const yaz = (ad, hucreler, sutun) => birlestir(c, hucreler, sutun).then(png => {
      fs.writeFileSync(path.join(CIKTI, ad), png);
      console.log(path.relative(KOK, path.join(CIKTI, ad)));
    });
    const YAZILAR = {
      tr: [`Mesajınıza sağ tık: Mesaj menüsü,<br>en altta ${yesil('“Sil”')} yalnızca bu mesajı siler`,
        `Fare biraz kayınca: Sohbet menüsü,<br>en altta ${kirmizi('“Sohbeti sil”')} bütün sohbeti siler`,
        `Eklenti açık, mesajınıza sağ tık:<br>${yesil('“Sil”')} yerinde`,
        'Eklenti açık, fare biraz kayınca:<br>Sohbeti silen ve temizleyen seçenek yok'],
      en: [`Right-click your message: Message menu,<br>${yesil('“Delete”')} at the bottom deletes only this message`,
        `The mouse slips a little: Chat menu,<br>${kirmizi('“Delete chat”')} at the bottom deletes the whole chat`,
        `Extension on, right-click your message:<br>${yesil('“Delete”')} is still there`,
        'Extension on, the mouse slips a little:<br>No option that deletes or clears the chat']
    }[DIL];

    await yaz('sorun.png', [
      { resim: await sahne('mesajaSagTik', false), yazi: YAZILAR[0] },
      { resim: await sahne('yaninaSagTik', false), yazi: YAZILAR[1] }
    ], 2);
    await yaz('cozum.png', [
      { resim: await sahne('mesajaSagTik', true), yazi: YAZILAR[2] },
      { resim: await sahne('yaninaSagTik', true), yazi: YAZILAR[3] }
    ], 2);
  } finally {
    c.kapat();
    fs.rmSync(klasor, { recursive: true, force: true });
  }
}

if (process.argv[1] && process.argv[1].endsWith('gorsel-uret.mjs')) await uret();
