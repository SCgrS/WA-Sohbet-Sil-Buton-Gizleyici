import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { KOK, paketle, zipOku, zipYaz, denetle, EKLENTI_OGELERI, eklentiDosyalari } from '../araclar/paketle.mjs';
import { GIZLENECEK_SECENEKLER, SOHBET_MENUSU_SECENEKLERI, STIL_DOSYASI, stilUret } from '../araclar/stil-uret.mjs';

test('kök düzeni: eklenti dosyaları listede, "_" ile başlayan ad yok', () => {
  const kok = fs.readdirSync(KOK);
  assert.ok(kok.includes('manifest.json'));
  assert.deepEqual(kok.filter(a => a.startsWith('_')), []);
  // Köke konan her eklenti dosyası (js/html/css) pakette de olmalı.
  const eklentiTuru = kok.filter(a => /\.(js|html|css)$/.test(a));
  assert.deepEqual(eklentiTuru.filter(a => !EKLENTI_OGELERI.includes(a)), [], 'EKLENTI_OGELERI listesine eklenmemiş dosya');
  for (const o of EKLENTI_OGELERI) assert.ok(fs.existsSync(path.join(KOK, o)), o);
  for (const boy of [16, 32, 48, 128]) assert.ok(eklentiDosyalari().includes(`simgeler/${boy}.png`), `${boy}.png`);
});

test('paket: kökte manifest, eksiksiz dosyalar, araç ve test yok, hiçbir izin yok', () => {
  const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sil-paket-'));
  try {
    const r = paketle(path.join(klasor, 'p.zip'));
    const g = zipOku(fs.readFileSync(r.hedef));
    assert.deepEqual(denetle(g), []);
    assert.deepEqual([...g.keys()].sort(), eklentiDosyalari());
    for (const ad of g.keys()) assert.ok(!/^(testler|araclar|cikti|node_modules|\.github)\//.test(ad), ad);
    const m = JSON.parse(g.get('manifest.json'));
    assert.equal(m.manifest_version, 3);
    assert.equal(m.permissions, undefined);
    assert.equal(m.host_permissions, undefined);
    assert.equal(m.optional_permissions, undefined);
    assert.equal(m.background, undefined);
    assert.equal(m.action, undefined);
    assert.deepEqual([...g.keys()].sort(), ['icerik.css', 'manifest.json', 'simgeler/128.png', 'simgeler/16.png', 'simgeler/32.png', 'simgeler/48.png']);
    assert.equal(m.content_scripts.length, 1);
    assert.deepEqual(m.content_scripts[0].matches, ['https://web.whatsapp.com/*']);
    assert.deepEqual(m.content_scripts[0].css, ['icerik.css']);
    assert.equal(m.content_scripts[0].js, undefined);
    // Kurallar stil sorgusu (@container style) kullanır, Chrome 111'den eski sürümde kurulmasın.
    assert.equal(m.minimum_chrome_version, '111');
    assert.deepEqual(Object.keys(m.icons), ['16', '32', '48', '128']);
    assert.match(m.author, /x\.com\/CgrShn/);
    assert.match(m.description, /x\.com\/CgrShn/);
    assert.ok(m.description.length <= 132, 'Mağaza açıklama sınırı 132 karakter');
    // Her girdinin CRC'si Node'un kendi hesabıyla aynı (zipOku de denetler).
    if (zlib.crc32) {
      const z = fs.readFileSync(r.hedef);
      const kayitSayisi = z.readUInt16LE(z.length - 22 + 10);
      let p = z.readUInt32LE(z.length - 22 + 16);
      for (let i = 0; i < kayitSayisi; i++) {
        const ad = z.subarray(p + 46, p + 46 + z.readUInt16LE(p + 28)).toString('utf8');
        assert.equal(z.readUInt32LE(p + 16), zlib.crc32(g.get(ad)), ad);
        p += 46 + z.readUInt16LE(p + 28) + z.readUInt16LE(p + 30) + z.readUInt16LE(p + 32);
      }
    }
    // Aynı kaynaktan aynı zip.
    const r2 = paketle(path.join(klasor, 'p2.zip'));
    assert.ok(fs.readFileSync(r.hedef).equals(fs.readFileSync(r2.hedef)));
  } finally {
    fs.rmSync(klasor, { recursive: true, force: true });
  }
});

test("mağaza paketi: manifest'te key yok, gerisi aynı", () => {
  const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sil-paket-'));
  try {
    const olagan = zipOku(fs.readFileSync(paketle(path.join(klasor, 'p.zip')).hedef));
    const magaza = zipOku(fs.readFileSync(paketle(path.join(klasor, 'm.zip'), { magaza: true }).hedef));
    assert.deepEqual(denetle(magaza), []);
    assert.deepEqual([...magaza.keys()], [...olagan.keys()]);
    const mo = JSON.parse(olagan.get('manifest.json'));
    const mm = JSON.parse(magaza.get('manifest.json'));
    assert.ok(mo.key, 'olağan pakette key var (her bilgisayarda aynı kimlik)');
    assert.equal(mm.key, undefined);
    const { key, ...kalan } = mo;
    assert.deepEqual(mm, kalan);
  } finally {
    fs.rmSync(klasor, { recursive: true, force: true });
  }
});

test('paket denetimi eksik dosyayı ve yasak adları yakalar', () => {
  const manifest = Buffer.from(JSON.stringify({ manifest_version: 3, icons: { 16: 'simgeler/yok.png' }, content_scripts: [{ js: ['yok.js'] }] }));
  const g = zipOku(zipYaz([['manifest.json', manifest], ['_gizli.js', Buffer.from('')], ['a.mjs', Buffer.from('')]]));
  const s = denetle(g).join('\n');
  assert.match(s, /eksik dosya: yok\.js/);
  assert.match(s, /eksik dosya: simgeler\/yok\.png/);
  assert.match(s, /"_" ile başlayan ad/);
  assert.match(s, /pakete girmemeli: a\.mjs/);
  assert.deepEqual(denetle(zipOku(zipYaz([['alt/manifest.json', manifest]]))), ['kökte manifest.json yok']);
  // Kök dışına çıkan yollar reddedilir. Chrome'un kabul ettiği _locales klasörü reddedilmez.
  const tamam = Buffer.from(JSON.stringify({ manifest_version: 3 }));
  const yollar = denetle(zipOku(zipYaz([['manifest.json', tamam], ['../disari.js', Buffer.from('')], ['/mutlak.js', Buffer.from('')], ['_locales/tr/messages.json', Buffer.from('{}')]]))).join('\n');
  assert.match(yollar, /kök dışına çıkan yol: \.\.\/disari\.js/);
  assert.match(yollar, /kök dışına çıkan yol: \/mutlak\.js/);
  assert.doesNotMatch(yollar, /_locales/);
  // Yinelenen ad ve bozuk CRC zip okunurken yakalanır. zipOku merkez dizindeki CRC'ye bakar.
  assert.throws(() => zipOku(zipYaz([['manifest.json', tamam], ['a.js', Buffer.from('1')], ['a.js', Buffer.from('2')]])), /yinelenen ad: a\.js/);
  const bozuk = zipYaz([['manifest.json', tamam]]);
  bozuk[bozuk.readUInt32LE(bozuk.length - 22 + 16) + 16] ^= 0xff;
  assert.throws(() => zipOku(bozuk), /CRC tutmuyor: manifest\.json/);
});

test("icerik.css, araclar/stil-uret.mjs'teki listelerden üretilenle birebir aynı", () => {
  assert.equal(fs.readFileSync(STIL_DOSYASI, 'utf8'), stilUret(), 'icerik.css güncel değil: npm run stil çalıştırın');
});

test("gizlenecek metinler ve sohbet menüsünü tanıtan metinler araclar/stil-uret.mjs'te iki ayrı sabit dizide", () => {
  assert.deepEqual(GIZLENECEK_SECENEKLER, ['Sohbeti sil', 'Sohbeti temizle', 'Delete chat', 'Clear chat']);
  assert.ok(!GIZLENECEK_SECENEKLER.includes('Sil') && !GIZLENECEK_SECENEKLER.includes('Delete'), 'mesajın "Sil" seçeneği listede olmamalı');
  // Grup seçenekleri gizlenmez.
  for (const grup of ['Grubu sil', 'Delete group', 'Gruptan çık', 'Exit group']) assert.ok(!GIZLENECEK_SECENEKLER.includes(grup), grup);
  assert.deepEqual(SOHBET_MENUSU_SECENEKLERI, ['Mesaj seç', 'Sohbeti kapat', 'Select messages', 'Close chat']);
  // Her gizlenecek metin stil dosyasında birebir etiket olarak geçer.
  const stil = fs.readFileSync(STIL_DOSYASI, 'utf8');
  for (const yazi of [...GIZLENECEK_SECENEKLER, ...SOHBET_MENUSU_SECENEKLERI]) assert.ok(stil.includes(`[aria-label="${yazi}"]`), yazi);
});
