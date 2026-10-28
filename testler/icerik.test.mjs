// Eklentiyi görünmez Chrome'a gerçekten yükleyip sahte WhatsApp sayfasında (testler/sahte-whatsapp.html) sınar.
// Sayfa https://web.whatsapp.com/ adresinde CDP'nin Fetch alanıyla sunulur; her ad çözümlemesi kapalıdır, gerçek siteye
// ya da internete hiçbir istek gitmez. Karşılaştırma için aynı sayfa eklentinin çalışmadığı https://example.com/sahte
// adresinde de sunulur.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromeBaslat, chromeYolu, sekmeAc, ifadeBekle, degerlendir } from '../araclar/cdp.mjs';
import { KOK, eklentiyiKopyala } from '../araclar/paketle.mjs';

const BEKLENEN_KIMLIK = 'fidmonnmoifajebnnahmghaipgfhjifa'; // manifest'teki key'den türer
const MANIFEST = JSON.parse(fs.readFileSync(path.join(KOK, 'manifest.json'), 'utf8'));
// Ad dil dosyasından gelir. Sınama Chrome'u Türkçe açılır (araclar/cdp.mjs), eklentinin Türkçe adını görür.
const TR_ILETILER = JSON.parse(fs.readFileSync(path.join(KOK, '_locales', 'tr', 'messages.json'), 'utf8'));
const EKLENTI_ADI = MANIFEST.name.replace(/^__MSG_(\w+)__$/, (_, ad) => TR_ILETILER[ad].message);
const SAHTE_SAYFA = fs.readFileSync(path.join(KOK, 'testler', 'sahte-whatsapp.html'));
const BASKA_SAYFA = Buffer.from('<!doctype html><html><body><div id="app"></div></body></html>');
const WHATSAPP = 'https://web.whatsapp.com/';
const EKLENTISIZ = 'https://example.com/sahte';
// Chrome yoksa tarayıcı testleri yerelde atlanır. GitHub'da (CI) atlanmaz, düşer: Yoksa eklenti tarayıcıda hiç sınanmadan
// yayımlanabilirdi.
const ATLA = chromeYolu() || process.env.CI ? false : 'Chrome bulunamadı';
const bekle = ms => new Promise(r => setTimeout(r, ms));

let c = null;
let kimlik = null;
let sayfa = null;
let eklentiKlasoru = null;
const eklentiDunyalari = new Map(); // frameId → eklentinin yalıtılmış JavaScript dünyası (eklentide kod olmadığı için hiç açılmamalı)

before(async () => {
  if (ATLA) return;
  // Yalnız pakete giren dosyalar yüklenir (eksik dosya da böylece yakalanır).
  eklentiKlasoru = eklentiyiKopyala(fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sil-eklenti-')));
  c = await chromeBaslat({ ekler: ['--host-resolver-rules=MAP * ~NOTFOUND'] });
  // Chrome eklentinin çalışma hatalarını yalnızca geliştirici modu açıkken toplar; aşağıdaki "hata yok" denetimleri için.
  const yonetim = await sekmeAc(c, 'chrome://extensions/');
  await ifadeBekle(yonetim.g, "document.readyState === 'complete' && !!(window.chrome && chrome.developerPrivate)");
  await degerlendir(yonetim.g, 'chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }).then(() => true)');
  await c.gonder('Target.closeTarget', { targetId: yonetim.targetId });
  ({ id: kimlik } = await c.gonder('Extensions.loadUnpacked', { path: eklentiKlasoru }));
  sayfa = await sekmeAc(c, 'about:blank');
  for (const y of ['Page.enable', 'Runtime.enable']) await sayfa.g(y);
  await sayfa.g('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await sayfa.g('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  c.dinle(m => {
    if (m.sessionId !== sayfa.sessionId) return;
    if (m.method === 'Runtime.executionContextCreated') {
      const b = m.params.context;
      if (b.auxData && b.auxData.type === 'isolated' && (b.name === EKLENTI_ADI || String(b.origin).includes(kimlik))) eklentiDunyalari.set(b.auxData.frameId, b.id);
    }
    if (m.method === 'Runtime.executionContextsCleared') eklentiDunyalari.clear();
    if (m.method === 'Fetch.requestPaused') {
      const u = new URL(m.params.request.url);
      const govde = u.hostname === 'web.whatsapp.com' && u.pathname === '/' ? SAHTE_SAYFA
        : u.hostname === 'example.com' && u.pathname === '/sahte' ? SAHTE_SAYFA
          : u.hostname === 'example.com' && u.pathname === '/' ? BASKA_SAYFA : null;
      if (govde) {
        sayfa.g('Fetch.fulfillRequest', {
          requestId: m.params.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' },
            // WhatsApp Web'in CSP'sindeki stil kuralı (2026-10'da ölçüldü); betik kuralı sahte sayfanın satır içi betiği için.
            { name: 'Content-Security-Policy', value: "default-src 'self' blob:; script-src 'self' 'unsafe-inline'; style-src data: blob: 'self' 'unsafe-inline'" }],
          body: govde.toString('base64')
        }).catch(() => {});
      } else {
        sayfa.g('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      }
    }
  });
  await sayfaAc();
});

after(() => {
  if (c) c.kapat();
  if (eklentiKlasoru) fs.rmSync(eklentiKlasoru, { recursive: true, force: true });
});

async function sayfaAc(sorgu = '', adres = WHATSAPP) {
  eklentiDunyalari.clear();
  await sayfa.g('Page.navigate', { url: adres + sorgu });
  await ifadeBekle(sayfa.g, "document.readyState === 'complete' && typeof window.sahte === 'object'");
  await sayfa.g('Page.bringToFront');
}

const turSec = tur => degerlendir(sayfa.g, `window.sahte.sohbetTuru = ${JSON.stringify(tur)}`);

async function noktaBul(secici) {
  return degerlendir(sayfa.g, `(() => {
    const e = document.querySelector(${JSON.stringify(secici)});
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
}

async function tikla(secici, { sag = false } = {}) {
  const { x, y } = await noktaBul(secici);
  const button = sag ? 'right' : 'left';
  await sayfa.g('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sayfa.g('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: sag ? 2 : 1, clickCount: 1 });
  await sayfa.g('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 });
}

// Açık menüde görünen satırlar: seçeneğin yazısı ya da ayırıcı için "|".
const GORUNEN = `(() => {
  const m = [...document.querySelectorAll('#katman [role=menu]')].find(x => x.querySelector('[role=menuitem]'));
  if (!m) return null;
  return [...m.querySelectorAll('[role=menuitem], .ayirici')].filter(e => e.checkVisibility())
    .map(e => e.matches('.ayirici') ? '|' : [...e.querySelectorAll('span')].filter(s => !s.querySelector('svg')).map(s => s.textContent).join(''));
})()`;

const ACMA_YOLLARI = {
  'sohbet': () => tikla('#sohbet-menu'), // üç nokta düğmesi
  'sohbet-sag': () => tikla('.mesajlar', { sag: true }), // sohbet alanında boş yere sağ tık
  'mesaj-sag': () => tikla('.mesajlar [data-id=m1] span', { sag: true }),
  'mesaj-satiri-sag': () => tikla('.mesajlar [role=row]', { sag: true }), // satırın ortası, balonun dışı
  'liste-sag-kisi': () => tikla('#pane-side [data-testid=list-item-0] [role=gridcell]', { sag: true }),
  'liste-sag-grup': () => tikla('#pane-side [data-testid=list-item-1] [role=gridcell]', { sag: true }),
  'liste-sag-cikilmis': () => tikla('#pane-side [data-testid=list-item-2] [role=gridcell]', { sag: true }),
  'liste-ok-kisi': () => tikla('#pane-side [data-testid=list-item-0] [data-testid=context-btn]'),
  'liste-ok-grup': () => tikla('#pane-side [data-testid=list-item-1] [data-testid=context-btn]'),
  'liste-ok-cikilmis': () => tikla('#pane-side [data-testid=list-item-2] [data-testid=context-btn]'),
  'mesaj': () => tikla('[data-testid=icon-down-context]'),
  'yan': () => tikla('#yan-menu')
};

async function menuAc(yol, { sonraBekle = 20 } = {}) {
  await degerlendir(sayfa.g, 'menuleriKapat(), true');
  const once = await degerlendir(sayfa.g, 'window.sahte.acilanlar');
  await ACMA_YOLLARI[yol]();
  await ifadeBekle(sayfa.g, `window.sahte.acilanlar > ${once}`, 5000);
  await bekle(sonraBekle);
  return degerlendir(sayfa.g, GORUNEN);
}

const gizliSayisi = () => degerlendir(sayfa.g, "[...document.querySelectorAll('#katman [role=menuitem]')].filter(b => !b.checkVisibility()).length");

// chrome://extensions'ın gösterdiği bilgiler: ad, açıklama, kurulum uyarıları, manifest ve çalışma hataları, izinler, site
// erişimi.
async function eklentiBilgisi() {
  const yonetim = await sekmeAc(c, 'chrome://extensions/');
  await ifadeBekle(yonetim.g, "document.readyState === 'complete' && !!(window.chrome && chrome.developerPrivate)");
  const bilgi = await degerlendir(yonetim.g, `chrome.developerPrivate.getExtensionInfo(${JSON.stringify(kimlik)}).then(b => ({
    ad: b.name, aciklama: b.description, uyarilar: b.installWarnings, manifestHatalari: b.manifestErrors.map(h => h.message), calismaHatalari: b.runtimeErrors.map(h => h.message),
    izinler: b.permissions.simplePermissions.map(p => p.message), siteErisimi: b.permissions.runtimeHostPermissions
  }))`);
  await c.gonder('Target.closeTarget', { targetId: yonetim.targetId });
  await sayfa.g('Page.bringToFront');
  return bilgi;
}

async function eklentiyiAyarla(acik) {
  const yonetim = await sekmeAc(c, 'chrome://extensions/');
  await ifadeBekle(yonetim.g, "document.readyState === 'complete' && !!(window.chrome && chrome.management)");
  await degerlendir(yonetim.g, `chrome.management.setEnabled(${JSON.stringify(kimlik)}, ${acik}).then(() => true)`);
  await c.gonder('Target.closeTarget', { targetId: yonetim.targetId });
  await bekle(300);
  await sayfa.g('Page.bringToFront');
}

const TR = {
  sohbetKisi: ['Kişi bilgisi', 'Ara', 'Mesaj seç', 'Bildirimleri sessize al', 'Süreli mesajlar', "Favoriler'e ekle", 'Listeye ekle', 'Sohbeti kapat', '|', 'Arama bağlantısı gönder', 'Yeni grup araması', '|', 'Şikayet et', 'Engelle', 'Sohbeti temizle', 'Sohbeti sil'],
  sohbetGrup: ['Üye ekle', 'Grup bilgisi', 'Ara', 'Mesaj seç', 'Bildirimleri sessize al', 'Süreli mesajlar', "Favoriler'e ekle", 'Listeye ekle', 'Sohbeti kapat', '|', 'Sohbeti temizle', 'Gruptan çık'],
  sohbetCikilmis: ['Grup bilgisi', 'Ara', 'Mesaj seç', "Favoriler'e ekle", 'Listeye ekle', 'Sohbeti kapat', '|', 'Sohbeti temizle', 'Grubu sil'],
  listeKisi: ['Sohbeti arşivle', 'Bildirimleri sessize al', 'Sohbeti sabitle', 'Okunmadı olarak işaretle', "Favoriler'e ekle", 'Listeye ekle', '|', 'Engelle', 'Sohbeti temizle', 'Sohbeti sil'],
  listeGrup: ['Sohbeti arşivle', 'Bildirimleri sessize al', 'Sohbetin Sabitlemesini Kaldır', 'Okunmadı olarak işaretle', "Favoriler'e ekle", 'Listeye ekle', '|', 'Sohbeti temizle', 'Gruptan çık'],
  listeCikilmis: ['Sohbeti arşivle', 'Sohbeti sabitle', 'Okunmadı olarak işaretle', "Favoriler'e ekle", 'Listeye ekle', '|', 'Sohbeti temizle', 'Grubu sil'],
  mesaj: ['Mesaj bilgisi', 'Cevapla', 'Kopyala', 'İfade bırak', 'İndir', 'İlet', 'Sabitle', "Meta AI'a soru sorun", 'Yıldız ekle', '|', 'Sil']
};
const cikar = (liste, ...atilacak) => liste.filter(x => !atilacak.includes(x));
// Sohbet alanında sağ tıkla açılan sohbet menüsü eklentiyle böyle görünür. "Grubu sil" ve "Gruptan çık" yerinde kalır.
const SAG_TIK = {
  kisi: cikar(TR.sohbetKisi, 'Sohbeti temizle', 'Sohbeti sil'),
  grup: cikar(TR.sohbetGrup, 'Sohbeti temizle'),
  cikilmis: cikar(TR.sohbetCikilmis, 'Sohbeti temizle')
};
const UC_NOKTA = { kisi: TR.sohbetKisi, grup: TR.sohbetGrup, cikilmis: TR.sohbetCikilmis };
const LISTE = { kisi: TR.listeKisi, grup: TR.listeGrup, cikilmis: TR.listeCikilmis };

test('eklenti yüklenir: beklenen kimlik, izin, uyarı ve hata yok, sayfada eklentiye ait kod çalışmaz', { skip: ATLA }, async () => {
  assert.equal(kimlik, BEKLENEN_KIMLIK);
  const bilgi = await eklentiBilgisi();
  assert.equal(bilgi.ad, 'WhatsApp Web için Sohbeti Sil Gizleyici');
  assert.equal(bilgi.aciklama, TR_ILETILER.extDescription.message);
  assert.deepEqual(bilgi.uyarilar, []);
  assert.deepEqual(bilgi.manifestHatalari, []);
  assert.deepEqual(bilgi.calismaHatalari, []);
  // Ayrıntılar sayfasında "Bu uzantı herhangi bir özel izin gerektirmiyor" yazar; site erişimi yalnızca WhatsApp Web.
  assert.deepEqual(bilgi.izinler, []);
  assert.equal(bilgi.siteErisimi.hasAllHosts, false);
  assert.deepEqual(bilgi.siteErisimi.hosts.map(h => h.host), ['https://web.whatsapp.com/*']);

  await sayfa.g('Page.navigate', { url: 'https://example.com/' });
  await ifadeBekle(sayfa.g, "document.readyState === 'complete' && !!document.getElementById('app')");
  await bekle(200);
  assert.equal(eklentiDunyalari.size, 0, 'başka sitede eklentinin JavaScript dünyası açılmamalı');
  await sayfaAc();
  await bekle(200);
  // Eklentide kod yoktur: Chrome WhatsApp sayfasına yalnızca stil dosyasını ekler, eklentiye bir JavaScript dünyası açmaz.
  // Eklentinin bellekteki yükü de bu yüzden yalnızca stil kurallarıdır.
  assert.equal(eklentiDunyalari.size, 0, 'WhatsApp sayfasında eklentinin JavaScript dünyası açılmamalı');
  assert.equal(await gizliSayisi(), 0);
  await turSec('kisi');
  assert.deepEqual(await menuAc('sohbet-sag'), SAG_TIK.kisi, 'WhatsApp sayfasında kurallar uygulanmalı');
});

test('sohbet alanında sağ tıkla açılan sohbet menüsünde "Sohbeti sil" ve "Sohbeti temizle" gizli, "Grubu sil" yerinde', { skip: ATLA }, async () => {
  for (const tur of ['kisi', 'grup', 'cikilmis']) {
    await turSec(tur);
    assert.deepEqual(await menuAc('sohbet-sag'), SAG_TIK[tur], tur);
    assert.deepEqual(await menuAc('mesaj-satiri-sag'), SAG_TIK[tur], tur);
  }
});

test('üç nokta menüsünde, sohbet listesinde, mesaj menüsünde ve yan menüde hiçbir şey gizlenmez', { skip: ATLA }, async () => {
  for (const tur of ['kisi', 'grup', 'cikilmis']) {
    await turSec(tur);
    assert.deepEqual(await menuAc('sohbet'), UC_NOKTA[tur], `üç nokta: ${tur}`);
    assert.equal(await gizliSayisi(), 0);
    assert.deepEqual(await menuAc(`liste-sag-${tur}`), LISTE[tur], `liste sağ tık: ${tur}`);
    assert.equal(await gizliSayisi(), 0);
    assert.deepEqual(await menuAc(`liste-ok-${tur}`), LISTE[tur], `liste ok: ${tur}`);
    assert.equal(await gizliSayisi(), 0);
  }
  // Mesajın üstüne sağ tık ya da mesajın oku: Mesaj menüsü, "Sil" en altta yerinde.
  assert.deepEqual(await menuAc('mesaj-sag'), TR.mesaj);
  assert.equal(await gizliSayisi(), 0);
  assert.deepEqual(await menuAc('mesaj'), TR.mesaj);
  assert.equal(await gizliSayisi(), 0);
  assert.equal((await menuAc('yan')).length, 6);
  assert.equal(await gizliSayisi(), 0);
});

test('aynı sohbet menüsü üç noktayla açılınca seçenekler görünür, sağ tıkla açılınca gizlenir', { skip: ATLA }, async () => {
  await turSec('kisi');
  assert.deepEqual(await menuAc('sohbet'), UC_NOKTA.kisi);
  assert.deepEqual(await menuAc('sohbet-sag'), SAG_TIK.kisi);
  assert.deepEqual(await menuAc('sohbet'), UC_NOKTA.kisi);
  assert.deepEqual(await menuAc('sohbet-sag'), SAG_TIK.kisi);
  // Kural üç nokta düğmesinin o anki durumuna bakar: Düğme menü açıkken kapalı işaretlenirse seçenekler hemen gizlenir,
  // yeniden açık işaretlenince geri gelir. Sayfayı yenilemek gerekmez.
  assert.deepEqual(await menuAc('sohbet'), UC_NOKTA.kisi);
  await degerlendir(sayfa.g, "document.getElementById('sohbet-menu').setAttribute('aria-expanded', 'false'), true");
  assert.deepEqual(await degerlendir(sayfa.g, GORUNEN), SAG_TIK.kisi);
  await degerlendir(sayfa.g, "document.getElementById('sohbet-menu').setAttribute('aria-expanded', 'true'), true");
  assert.deepEqual(await degerlendir(sayfa.g, GORUNEN), UC_NOKTA.kisi);
  // Soldaki yan menünün düğmesi açıkken (sohbetin üst çubuğunda değil) sağ tık menüsünde yine gizlenir.
  // Menünün açılması beklenir (yavaş makinede sabit bir bekleme yetmez). Düğme, test düşse de eski hâline döner, yoksa
  // sonraki testler de etkilenir.
  await degerlendir(sayfa.g, "menuleriKapat(), document.getElementById('yan-menu').setAttribute('aria-expanded', 'true'), true");
  try {
    const once = await degerlendir(sayfa.g, 'window.sahte.acilanlar');
    await ACMA_YOLLARI['sohbet-sag']();
    await ifadeBekle(sayfa.g, `window.sahte.acilanlar > ${once}`, 5000);
    assert.deepEqual(await degerlendir(sayfa.g, GORUNEN), SAG_TIK.kisi);
  } finally {
    await degerlendir(sayfa.g, "menuleriKapat(), document.getElementById('yan-menu').setAttribute('aria-expanded', 'false'), true");
  }
});

test('sohbet menüsü içindeki "Mesaj seç" ya da "Sohbeti kapat"tan tanınır; ikisi de yoksa hiçbir şey gizlenmez', { skip: ATLA }, async () => {
  const durumlar = [
    [['Mesaj seç', 'Sohbeti temizle', 'Sohbeti sil'], ['Mesaj seç']],
    [['Sohbeti kapat', 'Sohbeti temizle', 'Sohbeti sil'], ['Sohbeti kapat']],
    [['Select messages', 'Clear chat', 'Delete chat'], ['Select messages']],
    [['Close chat', 'Clear chat', 'Delete chat'], ['Close chat']],
    // Sohbet listesinin menüsüne benzeyen, tanıtan seçeneği olmayan menü olduğu gibi kalır.
    [['Sohbeti arşivle', 'Engelle', 'Sohbeti temizle', 'Sohbeti sil'], ['Sohbeti arşivle', 'Engelle', 'Sohbeti temizle', 'Sohbeti sil']],
    // Yalnızca birebir aynı yazı tanıtır.
    [['Mesaj seçin', 'mesaj seç', 'Sohbeti  kapat', 'Sohbeti sil'], ['Mesaj seçin', 'mesaj seç', 'Sohbeti  kapat', 'Sohbeti sil']]
  ];
  for (const [liste, beklenen] of durumlar) {
    await degerlendir(sayfa.g, `window.sahte.ozelMenu = ${JSON.stringify(liste)}`);
    assert.deepEqual(await menuAc('sohbet-sag'), beklenen, JSON.stringify(liste));
  }
});

test('birebir eşleşme: yalnızca etiketi listedeki yazıyla tam aynı olan seçenek gizlenir', { skip: ATLA }, async () => {
  await degerlendir(sayfa.g, `window.sahte.ozelMenu = ['Mesaj seç']; window.sahte.ekOgeler = ['Sohbeti sil', 'Sohbeti  temizle', 'sohbeti sil', 'SOHBETİ SİL', 'Sohbeti silme', 'Sohbeti sil ve çık', 'Sil', 'Delete', 'Sohbetleri sil', 'Clear chats', 'Grubu sil', 'Delete group']`);
  // Çift boşluklu 'Sohbeti  temizle' listedeki yazıyla aynı değildir, gizlenmez.
  assert.deepEqual(await menuAc('sohbet-sag'), ['Mesaj seç', '|', 'Sohbeti  temizle', 'sohbeti sil', 'SOHBETİ SİL', 'Sohbeti silme', 'Sohbeti sil ve çık', 'Sil', 'Delete', 'Sohbetleri sil', 'Clear chats', 'Grubu sil', 'Delete group']);
});

test('ayırıcılar: boş satır, baştaki/sondaki ya da art arda çizgi kalmaz', { skip: ATLA }, async () => {
  const M = 'Mesaj seç';
  const durumlar = [
    [[M, '|', 'Sohbeti sil', 'Sohbeti temizle', '|', 'B'], [M, '|', 'B']],
    [['Sohbeti sil', '|', M], [M]],
    [[M, '|', 'Sohbeti temizle'], [M]],
    [[M, '|', 'Sohbeti sil', '|', 'Sohbeti temizle', '|', 'B'], [M, '|', 'B']],
    // Menü, aralarında çizgi olan gizlenen seçeneklerle bitiyor.
    [[M, '|', 'Sohbeti temizle', '|', 'Sohbeti sil'], [M]],
    [[M, '|', 'A', '|', 'Sohbeti sil', '|', 'Sohbeti temizle'], [M, '|', 'A']],
    // Yan yana dört gizlenen seçenek (listedeki bütün yazılar).
    [[M, '|', 'Sohbeti sil', 'Sohbeti temizle', 'Delete chat', 'Clear chat', '|', 'B'], [M, '|', 'B']],
    [['Sohbeti sil', 'Sohbeti temizle', 'Delete chat', 'Clear chat', '|', M], [M]],
    [[M, '|', '|', 'B'], [M, '|', '|', 'B']] // Gizlenen öğe yoksa WhatsApp'ın düzenine dokunulmaz.
  ];
  for (const [liste, beklenen] of durumlar) {
    await degerlendir(sayfa.g, `window.sahte.ozelMenu = ${JSON.stringify(liste)}`);
    assert.deepEqual(await menuAc('sohbet-sag'), beklenen, JSON.stringify(liste));
  }
  // Üç nokta menüsünde ve tanıtan seçeneği olmayan menüde ayırıcılara da dokunulmaz.
  await degerlendir(sayfa.g, `window.sahte.ozelMenu = ${JSON.stringify([M, '|', 'Sohbeti sil', 'Sohbeti temizle', '|', 'B'])}`);
  assert.deepEqual(await menuAc('sohbet'), [M, '|', 'Sohbeti sil', 'Sohbeti temizle', '|', 'B']);
  await degerlendir(sayfa.g, `window.sahte.ozelMenu = ${JSON.stringify(['A', '|', 'Sohbeti sil', 'Sohbeti temizle'])}`);
  assert.deepEqual(await menuAc('sohbet-sag'), ['A', '|', 'Sohbeti sil', 'Sohbeti temizle']);
});

test('menü yüksekliği gizlenen satırlar kadar azalır', { skip: ATLA }, async () => {
  await turSec('kisi');
  const yukseklik = () => degerlendir(sayfa.g, "document.querySelector('#katman .menu-kutu').getBoundingClientRect().height");
  await menuAc('sohbet');
  const ucNokta = await yukseklik();
  await menuAc('sohbet-sag');
  const sagTik = await yukseklik();
  assert.equal(Math.round(ucNokta - sagTik), 72);
});

test('sonradan gelen etiket ve sonradan eklenen seçenek de gizlenir; etiketi olmayan seçenek gizlenmez', { skip: ATLA }, async () => {
  // Her adımda sonradan gelen etiketin ya da öğenin gerçekten geldiği beklenir, sonra görünenlere bakılır.
  const sayisi = etiket => `document.querySelectorAll('#katman [aria-label=${JSON.stringify(etiket)}]').length`;
  await degerlendir(sayfa.g, "window.sahte.sohbetTuru = 'kisi'; window.sahte.gecikmeliEtiket = true");
  await menuAc('sohbet-sag');
  await ifadeBekle(sayfa.g, `${sayisi('Sohbeti sil')} === 1 && ${sayisi('Sohbeti temizle')} === 1`, 5000);
  assert.deepEqual(await degerlendir(sayfa.g, GORUNEN), SAG_TIK.kisi);
  await degerlendir(sayfa.g, "window.sahte.sonradanOge = 'Sohbeti sil'");
  await menuAc('sohbet-sag');
  await ifadeBekle(sayfa.g, `${sayisi('Sohbeti sil')} === 2`, 5000);
  assert.equal(await gizliSayisi(), 3);
  assert.deepEqual(await degerlendir(sayfa.g, GORUNEN), SAG_TIK.kisi);
  await degerlendir(sayfa.g, "window.sahte.sonradanOge = 'Kopyala'");
  await menuAc('sohbet-sag');
  await ifadeBekle(sayfa.g, `${sayisi('Kopyala')} === 1`, 5000);
  assert.deepEqual(await degerlendir(sayfa.g, GORUNEN), [...SAG_TIK.kisi, 'Kopyala']);
  // Bilinen sınır: eklenti yalnızca düğmenin etiketine (aria-label) bakar; WhatsApp etiketi kaldırırsa seçenek görünür.
  await degerlendir(sayfa.g, 'window.sahte.etiketsiz = true');
  assert.deepEqual(await menuAc('sohbet-sag'), TR.sohbetKisi);
});

test('gizlenen seçenek görünmez ve odak alamaz, eklenti sayfaya hiçbir öğe eklemez ve sayfanın kodu kurallarını göremez', { skip: ATLA }, async () => {
  await turSec('kisi');
  await menuAc('sohbet-sag');
  const durum = `(() => {
    const m = document.querySelector('#katman [role=menu]');
    const sil = [...m.querySelectorAll('[role=menuitem]')].find(b => b.getAttribute('aria-label') === 'Sohbeti sil');
    const engelle = [...m.querySelectorAll('[role=menuitem]')].find(b => b.getAttribute('aria-label') === 'Engelle');
    sil.focus();
    const odakGitti = document.activeElement === sil;
    return { var: sil.isConnected, display: getComputedStyle(sil).display, yukseklik: sil.getBoundingClientRect().height, odakGitti,
      engelleGorunur: engelle.checkVisibility(),
      // Sayfanın gördüğü stil dosyaları: Yalnızca sahte sayfanın kendi <style> öğesi. Chrome'un eklediği stil dosyası
      // document.styleSheets'te ve DOM'da görünmez.
      stilDosyalari: document.styleSheets.length, stilOgeleri: document.querySelectorAll('style, link').length };
  })()`;
  assert.deepEqual(await degerlendir(sayfa.g, durum),
    { var: true, display: 'none', yukseklik: 0, odakGitti: false, engelleGorunur: true, stilDosyalari: 1, stilOgeleri: 1 });
  // Sayfada hiçbir şey değişmez: Belge, aynı menünün eklentinin çalışmadığı adresteki hâliyle birebir aynıdır.
  const eklentili = await degerlendir(sayfa.g, 'document.documentElement.outerHTML');
  await sayfaAc('', EKLENTISIZ);
  await turSec('kisi');
  assert.deepEqual(await menuAc('sohbet-sag'), TR.sohbetKisi, 'eklentinin çalışmadığı adreste hiçbir şey gizlenmemeli');
  assert.deepEqual(await degerlendir(sayfa.g, durum),
    { var: true, display: 'block', yukseklik: 36, odakGitti: true, engelleGorunur: true, stilDosyalari: 1, stilOgeleri: 1 });
  assert.equal(await degerlendir(sayfa.g, 'document.documentElement.outerHTML'), eklentili);
  await sayfaAc();
});

test('İngilizce arayüz: Sağ tık menüsünde "Delete chat" ve "Clear chat" gizli, üç noktada ve listede görünür, "Delete group" yerinde', { skip: ATLA }, async () => {
  await sayfaAc('?dil=en');
  await turSec('kisi');
  const sagTik = await menuAc('sohbet-sag');
  assert.deepEqual(sagTik.slice(-3), ['|', 'Report', 'Block']);
  assert.ok(!sagTik.includes('Delete chat') && !sagTik.includes('Clear chat'));
  assert.deepEqual((await menuAc('sohbet')).slice(-2), ['Clear chat', 'Delete chat']);
  assert.deepEqual((await menuAc('liste-sag-kisi')).slice(-2), ['Clear chat', 'Delete chat']);
  await turSec('grup');
  assert.deepEqual((await menuAc('sohbet-sag')).slice(-2), ['|', 'Exit group']);
  await turSec('cikilmis');
  assert.deepEqual((await menuAc('sohbet-sag')).slice(-3), ['Close chat', '|', 'Delete group']);
  assert.deepEqual((await menuAc('sohbet')).slice(-2), ['Clear chat', 'Delete group']);
  assert.deepEqual((await menuAc('mesaj')).slice(-2), ['|', 'Delete']);
  await sayfaAc();
});

// Chrome'un izinden (trace) bir işin stil hesaplarında yeniden hesaplanan öğe sayısını okur. Sayı bilgisayarın hızına bağlı
// değildir. Yalnızca sınama sekmesinin karesindeki stil hesapları sayılır.
async function yenidenHesaplanan(ifade) {
  const kare = (await sayfa.g('Page.getFrameTree')).frameTree.frame.id;
  const olaylar = [];
  let bitti;
  const tamam = new Promise(z => { bitti = z; });
  const dinleyici = m => {
    if (m.method === 'Tracing.dataCollected') olaylar.push(...m.params.value);
    if (m.method === 'Tracing.tracingComplete') bitti();
  };
  c.dinle(dinleyici);
  try {
    await c.gonder('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'], excludedCategories: ['*'] } });
    await degerlendir(sayfa.g, ifade);
    await c.gonder('Tracing.end');
    await tamam;
  } finally {
    c.birak(dinleyici);
  }
  return olaylar.filter(o => o.name === 'UpdateLayoutTree' && o.args?.beginData?.frame === kare)
    .reduce((t, o) => t + (o.args?.elementCount ?? o.args?.endData?.elementCount ?? 0), 0);
}

test('başarım: Sayfaya mesaj eklemek, sohbet menüsü açılıp kapandıktan sonra da bütün sayfayı yeniden hesaplatmaz', { skip: ATLA }, async () => {
  // Kuralların yazımı bozulursa (ör. kökte :has'in konusu bütün div'ler olursa ya da ayırıcı kuralları menü dışındaki boş
  // div'lerin komşularına bakarsa) Chrome sayfaya her öğe eklenince bütün sayfayı yeniden hesaplar. WhatsApp boyutunda bir
  // sayfada bu, değişiklik başına onlarca milisaniyedir (2026-10'da ölçüldü). Test aynı işi eklentinin çalışmadığı adresteki
  // aynı sayfayla karşılaştırır.
  const KALABALIK = `(() => {
    const liste = document.querySelector('.mesajlar');
    liste.prepend(document.createElement('div')); // listenin başında boş, rolsüz bir dolgu öğesi
    for (let i = 0; i < 300; i++) {
      const s = document.createElement('div');
      s.setAttribute('role', 'row');
      s.innerHTML = '<div class="balon"><span>Mesaj</span><div></div><div role="button" aria-label="Mesaj seçeneklerini aç">▾</div></div>';
      liste.append(s);
    }
    return true;
  })()`;
  // Sanal listedeki gibi listenin ortasına satır eklenir ve listeden satır çıkar.
  const EKLE = `(() => {
    const liste = document.querySelector('.mesajlar');
    for (let i = 0; i < 5; i++) {
      const s = document.createElement('div');
      s.setAttribute('role', 'row');
      s.innerHTML = '<div class="balon"><span>Yeni mesaj</span><div role="button" aria-label="Mesaj seçeneklerini aç">▾</div></div>';
      liste.insertBefore(s, liste.children[2]);
      liste.lastElementChild.remove();
      getComputedStyle(s).display;
    }
    return true;
  })()`;
  const olc = async adres => {
    await sayfaAc('', adres);
    await turSec('kisi');
    await degerlendir(sayfa.g, KALABALIK);
    await degerlendir(sayfa.g, 'getComputedStyle(document.body).display, true');
    const menudenOnce = await yenidenHesaplanan(EKLE);
    // Sohbet alanında sağ tıkla açılan sohbet menüsünü aç ve kapat. Menüyü tanıyan kurallar bu sırada ilk kez sayfaya bakar.
    await degerlendir(sayfa.g, "document.querySelector('.mesajlar').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })), true");
    await ifadeBekle(sayfa.g, "!!document.querySelector('#katman [role=menuitem]')", 5000);
    await degerlendir(sayfa.g, "getComputedStyle(document.querySelector('#katman [role=menuitem]')).display, menuleriKapat(), getComputedStyle(document.body).display, true");
    const menudenSonra = await yenidenHesaplanan(EKLE);
    const ogeSayisi = await degerlendir(sayfa.g, "document.querySelectorAll('*').length");
    return { menudenOnce, menudenSonra, ogeSayisi };
  };
  const eklentisiz = await olc(EKLENTISIZ);
  const eklentili = await olc(WHATSAPP);
  const fark = `eklentili ${JSON.stringify(eklentili)}, eklentisiz ${JSON.stringify(eklentisiz)}`;
  assert.ok(eklentisiz.ogeSayisi > 1500, fark);
  // Ölçüm gerçekten yapıldı mı: Chrome izin biçimini değiştirirse sayılar 0 kalır ve test bir şey kanıtlamadan geçerdi.
  assert.ok(eklentisiz.menudenOnce > 0 && eklentisiz.menudenSonra > 0, `izde stil hesabı görülmedi: ${fark}`);
  // Eklentiyle ek iş en çok kökün kendisidir (ekleme başına bir öğe).
  assert.ok(eklentili.menudenOnce <= eklentisiz.menudenOnce + 5, fark);
  assert.ok(eklentili.menudenSonra <= eklentisiz.menudenSonra + 5, fark);
  await sayfaAc();
});

test('sınama boyunca eklentide çalışma hatası çıkmadı', { skip: ATLA }, async () => {
  // Önceki testlerin bütün menü ve sayfa yenileme işlemlerinden sonra chrome://extensions'ın hata listesi boştur.
  assert.deepEqual((await eklentiBilgisi()).calismaHatalari, []);
});

test("chrome://extensions'tan kapatınca açık sekmede gizleme yenilenene dek sürer, yenileyince menü olağan hâline döner", { skip: ATLA }, async () => {
  await sayfaAc();
  await turSec('kisi');
  await eklentiyiAyarla(false);
  // Chrome açık sekmeye eklediği stil dosyasını sekmeden kaldırmaz. Seçenekler sekme yenilenene dek gizli kalır.
  assert.deepEqual(await menuAc('sohbet-sag'), SAG_TIK.kisi);
  // Kapalıyken sekme yenilenince eklenti çalışmaz, menü WhatsApp'ın kendi hâliyle görünür (README'deki kapatma yolu).
  await sayfaAc();
  await bekle(100);
  await turSec('kisi');
  assert.deepEqual(await menuAc('sohbet-sag'), TR.sohbetKisi);
  // Yeniden açınca Chrome açık sekmeye stil dosyasını koymaz. Sekme yenilenince yine gizler.
  await eklentiyiAyarla(true);
  assert.deepEqual(await menuAc('sohbet-sag'), TR.sohbetKisi);
  await sayfaAc();
  await bekle(100);
  await turSec('kisi');
  assert.deepEqual(await menuAc('sohbet-sag'), SAG_TIK.kisi);
});

test('eklenti kaldırılınca açık sekmede gizleme yenilenene dek sürer, yenileyince seçenekler geri gelir', { skip: ATLA }, async t => {
  await sayfaAc();
  await turSec('kisi');
  assert.deepEqual(await menuAc('sohbet-sag'), SAG_TIK.kisi);
  try {
    await c.gonder('Extensions.uninstall', { id: kimlik });
  } catch (hata) {
    if (/wasn't found|not found/i.test(hata.message)) { t.skip('Bu Chrome sürümünde Extensions.uninstall yok'); return; }
    throw hata;
  }
  await bekle(300);
  assert.deepEqual(await menuAc('sohbet-sag'), SAG_TIK.kisi);
  await sayfaAc();
  await bekle(100);
  await turSec('kisi');
  assert.deepEqual(await menuAc('sohbet-sag'), TR.sohbetKisi);
});
