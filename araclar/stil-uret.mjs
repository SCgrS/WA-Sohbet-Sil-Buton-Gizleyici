// Eklentinin WhatsApp Web'e eklediği tek dosyayı, icerik.css'i üretir: npm run stil
// Kurallar aşağıdaki iki listeden üretilir, böylece her seçenek her kurala aynı biçimde girer. Testler depodaki icerik.css'in
// bu listelerden üretilenle birebir aynı olduğunu denetler.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Gizlenecek menü seçenekleri. WhatsApp'ın arayüz metinleri değişirse ya da başka bir dil eklemek isterseniz yalnızca bu
// iki listeyi güncelleyin ve "npm run stil" çalıştırın. Her metin, menü düğmesinin etiketiyle (aria-label) BİREBİR
// karşılaştırılır: Büyük/küçük harf ve boşluklar dâhil tam aynı olmalıdır, "içeriyor" araması yapılmaz. Bu yüzden mesajı
// silen "Sil" etkilenmez.
export const GIZLENECEK_SECENEKLER = [
  'Sohbeti sil',
  'Sohbeti temizle',
  'Delete chat',
  'Clear chat'
];

// Sohbet menüsünü tanıtan seçenekler. İçinde bunlardan biri bulunan menü, açık sohbetin menüsüdür. Soldaki sohbet
// listesinin menüsünde ve mesaj menüsünde bunlar yoktur, o menülerde hiçbir şey gizlenmez.
export const SOHBET_MENUSU_SECENEKLERI = [
  'Mesaj seç',
  'Sohbeti kapat',
  'Select messages',
  'Close chat'
];

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STIL_DOSYASI = path.join(KOK, 'icerik.css');
// Katmanın, kökteki kabın ve değişkenin adı. Sayfanın kendi adlarıyla karışmasın diye eklentinin adını taşır.
export const AD = 'wa-sohbet-sil-buton-gizleyici';
export const UC_NOKTA_DEGISKENI = `--${AD}-uc-nokta`;

const ACIKLAMA = `/*
 * WA Sohbet Sil Buton Gizleyici: web.whatsapp.com'a eklenen stil kuralları.
 *
 * Bu dosya araclar/stil-uret.mjs ile üretilir. Elle değiştirmeyin: Seçenek listeleri o dosyadadır, listeleri değiştirince
 * "npm run stil" çalıştırın.
 *
 * Eklentide çalışan kod yoktur. Chrome bu dosyayı WhatsApp Web açılırken sayfaya ekler ve kuralları kendi çizim motoruyla
 * uygular. Dosyada yalnızca seçenekleri gizleyen kurallar vardır: Bir şey yükleyen ya da sayfadaki bir yazıyı ekrana
 * getiren kural bulunmaz.
 *
 * Kurallar yalnızca sohbet alanında sağ tıkla açılan sohbet menüsünde gizler:
 *   - Sohbet menüsü: İçinde SOHBET_MENUSU_SECENEKLERI'nden biri bulunan menü.
 *   - Sağ tıkla açılan: Aynı sohbet menüsü sohbetin üstündeki üç nokta düğmesiyle de açılır. O düğme, menüsü açıkken
 *     aria-expanded="true" taşır. Bu durumda kurallar uygulanmaz, seçenekler üç nokta menüsünde görünür kalır.
 *
 * WhatsApp Web'in yapısı (2026-10'da ölçüldü): Menüler sonradan eklenen div[role="menu"] öğeleridir ve hepsi aynı ortak
 * katmanda açılır. Seçenekler button[role="menuitem"] öğeleridir ve aria-label değerleri görünen yazıyla aynıdır. Ayırıcı
 * çizgiler, seçeneklerle aynı kapta duran rolsüz ve boş div'lerdir. Açık sohbetin üst çubuğu #main içindeki header'dır,
 * üç nokta düğmesi aria-haspopup taşır. Sınıf adları rastgele olduğu için kullanılmaz.
 *
 * Yazım, WhatsApp sayfası değiştikçe Chrome'a fazladan iş çıkarmayacak biçimde seçildi:
 *   - Üç nokta düğmesinin durumu kökte (:root) kalıtılmayan tek bir değişkene yazılır, menü kuralları ona kökün kabı
 *     üzerinden bakar. Sayfaya mesaj ya da sohbet eklenip çıktıkça Chrome yalnızca kökü yeniden hesaplar, bütün sayfayı değil.
 *   - Ayırıcı kuralları önce çizginin bir menünün içinde olduğuna bakar. Menü dışındaki boş div'lerin komşularına bakılmaz.
 *   - Kurallar kendi katmanlarındadır (@layer). Chrome eklentinin kurallarını sayfanınkilerden önce sıraladığı için
 *     sayfanın stil dosyalarındaki !important kuralları gizlemeyi bozamaz.
 *
 * Bilinen sınır: Kökteki kap adı ve değişken olağan önceliktedir, böylece sayfanın kendi kök kurallarını bozmaz. WhatsApp
 * köke kendi kap adını (container-name) verirse kurallar kökün kabını bulamaz, gizleme kalkar ve seçenekler görünür. Sayfa
 * bozulmaz.
 */`;

export function stilUret(gizlenecek = GIZLENECEK_SECENEKLER, tanitan = SOHBET_MENUSU_SECENEKLERI) {
  const etiketSecicisi = yazi => `[aria-label="${yazi.replace(/["\\]/g, '\\$&')}"]`;
  const seceneklerden = liste => `[role="menuitem"]:is(${liste.map(etiketSecicisi).join(', ')})`;
  const HEDEF = seceneklerden(gizlenecek);
  const MENU = `[role="menu"]:has(${seceneklerden(tanitan)})`;
  const AYIRICI = 'div:not([role]):empty';
  const MENUDEKI_AYIRICI = `${AYIRICI}:is([role="menu"] *)`;
  const UC_NOKTA_ACIK = '#main header [aria-haspopup][aria-expanded="true"]';
  const GIZLE = '{ display: none !important; }';
  const yanYana = adet => ` + ${HEDEF}`.repeat(adet);
  const adetler = gizlenecek.map((_, sira) => sira + 1);
  return [
    ACIKLAMA,
    '',
    `@property ${UC_NOKTA_DEGISKENI} { syntax: '*'; inherits: false; }`,
    '',
    `@layer ${AD} {`,
    '  /* Kök, menü kurallarının baktığı kaptır. Üç nokta menüsü açıkken kökün değişkeni 1 olur. */',
    `  :root { container-name: ${AD}; }`,
    `  :root:has(${UC_NOKTA_ACIK}) { ${UC_NOKTA_DEGISKENI}: 1; }`,
    '',
    `  @container ${AD} not style(${UC_NOKTA_DEGISKENI}: 1) {`,
    '    /* Sohbet menüsündeki gizlenecek seçenekler. */',
    `    ${MENU} ${HEDEF} ${GIZLE}`,
    '',
    '    /*',
    '     * Gizlenen seçeneklerin yanında boşta kalan ayırıcı çizgiler:',
    '     *   - Sondaki: Arkasında yalnızca gizlenen seçenekler ve çizgiler kalan çizgi.',
    '     *   - Baştaki: Önünde yalnızca gizlenen seçenekler olan çizgi.',
    '     *   - Art arda: İki çizgi arasında yalnızca gizlenen seçenekler kalırsa ikinci çizgi.',
    '     * Baştaki ve art arda çizgi kuralları, yan yana 1, 2, … gizlenen seçenek için ayrı ayrı yazılır. Listedeki bütün',
    '     * yazılar yan yana gelse bile kapsanır. Gizlenen seçenek yoksa çizgilere dokunulmaz.',
    '     */',
    `    ${MENU} [role="menuitem"] ~ ${MENUDEKI_AYIRICI}:has(~ ${HEDEF}):not(:has(~ :not(${HEDEF}, ${AYIRICI}))) ${GIZLE}`,
    ...adetler.map(adet => `    ${MENU} ${HEDEF}:first-child${yanYana(adet - 1)} + ${MENUDEKI_AYIRICI} ${GIZLE}`),
    ...adetler.map(adet => `    ${MENU} ${AYIRICI}${yanYana(adet)} + ${MENUDEKI_AYIRICI} ${GIZLE}`),
    '  }',
    '}',
    ''
  ].join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('stil-uret.mjs')) {
  fs.writeFileSync(STIL_DOSYASI, stilUret());
  console.log(`${path.relative(KOK, STIL_DOSYASI)} · ${fs.statSync(STIL_DOSYASI).size} bayt`);
}
