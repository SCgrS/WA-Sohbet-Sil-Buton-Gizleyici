// Kullanıcıya verilecek eklenti zip'ini üretir ve açıp denetler: node araclar/paketle.mjs [--magaza] [çıktı.zip]
// Kökte manifest.json durur (üst klasör yok). Yalnız eklenti dosyaları (EKLENTI_OGELERI) girer. Manifest'in adını verdiği
// her dosya (simgeler ve içerik dosyaları) ve kullandığı her dil iletisi (__MSG_ad__) zip'te olmalı. Kökteki _locales
// dışında "_" ile başlayan ad, ters bölülü, mutlak ya da ".." içeren yol ve yinelenen ad olmamalı. Aynı kaynaktan bayt bayt
// aynı zip çıkar (sabit tarih, yerel ayardan bağımsız sıralı dosyalar).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PAKET_ADI = 'WA-Sohbet-Sil-Buton-Gizleyici.zip';
// Eklentiye ait kök öğeler (klasörler bütünüyle). Köke yeni bir eklenti dosyası eklenince buraya da eklenir; test denetler.
// LICENSE da girer: AGPL-3.0 lisans metninin eklentiyle birlikte verilmesini istiyor. _locales eklentinin adını ve
// açıklamasını dillere göre verir.
export const EKLENTI_OGELERI = ['manifest.json', 'icerik.css', 'simgeler', '_locales', 'LICENSE'];

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
// Adlar kod birimi sırasıyla dizilir: localeCompare bilgisayarın yerel ayarına göre başka sıra verebilir.
const sirala = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const crc32 = b => {
  let c = -1;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

function dosyalar(klasor, on = '') {
  const sonuc = [];
  for (const g of fs.readdirSync(klasor, { withFileTypes: true }).sort((a, b) => sirala(a.name, b.name))) {
    const yol = on ? `${on}/${g.name}` : g.name;
    if (g.isDirectory()) sonuc.push(...dosyalar(path.join(klasor, g.name), yol));
    else sonuc.push(yol);
  }
  return sonuc;
}

// Eklentinin dosyaları ("/" ile ayrılmış göreli yollar, sıralı).
export function eklentiDosyalari() {
  return EKLENTI_OGELERI.flatMap(o => (fs.statSync(path.join(KOK, o)).isDirectory() ? dosyalar(path.join(KOK, o), o) : [o]))
    .sort(sirala);
}

// Eklentinin dosyalarını bir klasöre kopyalar (sınama, yalnız paketteki dosyalarla çalışsın diye kopyayı yükler).
export function eklentiyiKopyala(hedef) {
  for (const ad of eklentiDosyalari()) {
    const y = path.join(hedef, ...ad.split('/'));
    fs.mkdirSync(path.dirname(y), { recursive: true });
    fs.copyFileSync(path.join(KOK, ...ad.split('/')), y);
  }
  return hedef;
}

export function zipYaz(girdiler) {
  // Sabit tarih (2026-01-01 00:00): aynı kaynaktan aynı zip çıkar.
  const SAAT = 0;
  const TARIH = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const yerel = [];
  const merkez = [];
  let ofset = 0;
  for (const [ad, veri] of girdiler) {
    const adB = Buffer.from(ad, 'utf8');
    const sik = zlib.deflateRawSync(veri, { level: 9 });
    const crc = crc32(veri);
    const b = Buffer.alloc(30);
    b.writeUInt32LE(0x04034b50, 0); b.writeUInt16LE(20, 4); b.writeUInt16LE(0x0800, 6); b.writeUInt16LE(8, 8);
    b.writeUInt16LE(SAAT, 10); b.writeUInt16LE(TARIH, 12); b.writeUInt32LE(crc, 14); b.writeUInt32LE(sik.length, 18);
    b.writeUInt32LE(veri.length, 22); b.writeUInt16LE(adB.length, 26);
    yerel.push(b, adB, sik);
    const m = Buffer.alloc(46);
    m.writeUInt32LE(0x02014b50, 0); m.writeUInt16LE(20, 4); m.writeUInt16LE(20, 6); m.writeUInt16LE(0x0800, 8);
    m.writeUInt16LE(8, 10); m.writeUInt16LE(SAAT, 12); m.writeUInt16LE(TARIH, 14); m.writeUInt32LE(crc, 16);
    m.writeUInt32LE(sik.length, 20); m.writeUInt32LE(veri.length, 24); m.writeUInt16LE(adB.length, 28);
    m.writeUInt32LE(ofset, 42);
    merkez.push(m, adB);
    ofset += 30 + adB.length + sik.length;
  }
  const md = Buffer.concat(merkez);
  const son = Buffer.alloc(22);
  son.writeUInt32LE(0x06054b50, 0); son.writeUInt16LE(girdiler.length, 8); son.writeUInt16LE(girdiler.length, 10);
  son.writeUInt32LE(md.length, 12); son.writeUInt32LE(ofset, 16);
  return Buffer.concat([...yerel, md, son]);
}

export function zipOku(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip dizini yok');
  const girdiler = new Map();
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < buf.readUInt16LE(eocd + 10); k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('merkez dizin kaydı bozuk');
    const yontem = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const sik = buf.readUInt32LE(p + 20);
    const adUz = buf.readUInt16LE(p + 28);
    const ekUz = buf.readUInt16LE(p + 30);
    const notUz = buf.readUInt16LE(p + 32);
    const yerel = buf.readUInt32LE(p + 42);
    const ad = buf.subarray(p + 46, p + 46 + adUz).toString('utf8');
    if (buf.readUInt32LE(yerel) !== 0x04034b50) throw new Error(`yerel başlık bozuk: ${ad}`);
    if (girdiler.has(ad)) throw new Error(`yinelenen ad: ${ad}`);
    const bas = yerel + 30 + buf.readUInt16LE(yerel + 26) + buf.readUInt16LE(yerel + 28);
    const ham = buf.subarray(bas, bas + sik);
    const veri = yontem === 8 ? zlib.inflateRawSync(ham) : ham;
    if (crc32(veri) !== crc) throw new Error(`CRC tutmuyor: ${ad}`);
    girdiler.set(ad, veri);
    p += 46 + adUz + ekUz + notUz;
  }
  return girdiler;
}

// Zip'in Chrome'da yüklenebilir olduğunu denetler, sorunları dizi olarak döndürür.
export function denetle(girdiler) {
  const sorunlar = [];
  const var_ = ad => girdiler.has(ad);
  if (!var_('manifest.json')) return ['kökte manifest.json yok'];
  for (const ad of girdiler.keys()) {
    if (ad.includes('\\')) sorunlar.push(`ters bölülü yol: ${ad}`);
    if (ad.startsWith('/') || /^[a-z]:/i.test(ad) || ad.split('/').includes('..')) sorunlar.push(`kök dışına çıkan yol: ${ad}`);
    // Chrome "_" ile başlayan adları reddeder, yalnızca kökteki _locales klasörü ayrıktır.
    if (ad.split('/').some((p, i) => p.startsWith('_') && !(i === 0 && p === '_locales'))) sorunlar.push(`"_" ile başlayan ad: ${ad}`);
    if (/\.(pem|crx|mjs)$/i.test(ad)) sorunlar.push(`pakete girmemeli: ${ad}`);
  }
  const m = JSON.parse(girdiler.get('manifest.json').toString('utf8'));
  const gerekli = new Set([
    ...Object.values(m.icons || {}),
    ...(m.content_scripts || []).flatMap(c => [...(c.js || []), ...(c.css || [])])
  ].map(ad => path.posix.normalize(ad)));
  for (const ad of gerekli) if (!var_(ad)) sorunlar.push(`eksik dosya: ${ad}`);
  // Dil dosyaları: Chrome, _locales ya da __MSG_ iletisi varsa default_locale ister. Varsayılan dilin dosyasında manifest'in
  // kullandığı her ileti bulunmalı, öbür dillerde eksik ileti varsayılandan alınır.
  const diller = [...new Set([...girdiler.keys()].filter(ad => ad.startsWith('_locales/')).map(ad => ad.split('/')[1]))];
  const iletiAdlari = [...JSON.stringify(m).matchAll(/__MSG_(\w+)__/g)].map(e => e[1]);
  if ((diller.length || iletiAdlari.length) && !m.default_locale) sorunlar.push('default_locale yok');
  else if (m.default_locale && !diller.includes(m.default_locale)) sorunlar.push(`varsayılan dil dosyası yok: _locales/${m.default_locale}/messages.json`);
  for (const dil of diller) {
    let iletiler;
    try {
      iletiler = JSON.parse(girdiler.get(`_locales/${dil}/messages.json`).toString('utf8'));
    } catch {
      sorunlar.push(`okunamayan dil dosyası: _locales/${dil}/messages.json`);
      continue;
    }
    if (dil === m.default_locale) for (const ad of iletiAdlari) if (!iletiler[ad]?.message) sorunlar.push(`varsayılan dilde eksik ileti: ${ad}`);
  }
  return sorunlar;
}

// magaza: Chrome Web Mağazası'na yüklenecek paket. Mağaza manifest'te "key" alanını kabul etmiyor (kimliği kendisi verir);
// alan çıkarılır, gerisi aynı.
export function paketle(hedef, { magaza = false } = {}) {
  const girdiler = eklentiDosyalari().map(ad => [ad, fs.readFileSync(path.join(KOK, ...ad.split('/')))]);
  if (magaza) {
    const i = girdiler.findIndex(([ad]) => ad === 'manifest.json');
    const { key, ...m } = JSON.parse(girdiler[i][1].toString('utf8'));
    girdiler[i] = ['manifest.json', Buffer.from(JSON.stringify(m, null, 2) + '\n', 'utf8')];
  }
  const zip = zipYaz(girdiler);
  const sorunlar = denetle(zipOku(zip));
  if (sorunlar.length) throw new Error('Paket denetimi başarısız:\n  ' + sorunlar.join('\n  '));
  fs.mkdirSync(path.dirname(hedef), { recursive: true });
  fs.writeFileSync(hedef, zip);
  return { hedef, dosya: girdiler.length, bayt: zip.length };
}

if (process.argv[1] && process.argv[1].endsWith('paketle.mjs')) {
  const arg = process.argv.slice(2);
  const magaza = arg.includes('--magaza');
  const surum = JSON.parse(fs.readFileSync(path.join(KOK, 'manifest.json'), 'utf8')).version;
  const varsayilan = magaza ? `WA-Sohbet-Sil-Buton-Gizleyici-${surum}-magaza.zip` : PAKET_ADI;
  const hedef = path.resolve(arg.find(a => a !== '--magaza') || path.join(KOK, 'cikti', varsayilan));
  const r = paketle(hedef, { magaza });
  console.log(`${path.relative(KOK, r.hedef)} · sürüm ${surum}${magaza ? ' · mağaza (key yok)' : ''} · ${r.dosya} dosya · ${r.bayt} bayt`);
}
