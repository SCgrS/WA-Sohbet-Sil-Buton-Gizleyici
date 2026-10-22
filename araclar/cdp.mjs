// Görünmez (headless) Chrome'u geçici profille başlatır ve DevTools iletişim kurallarını (CDP) boru üzerinden konuşur.
// Markalı Chrome 137'den beri --load-extension'ı yok saydığı için eklenti Extensions.loadUnpacked ile yüklenir.
import { spawn, execFileSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OLASI_CHROME_YOLLARI = [
  process.env.CHROME_YOLU,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable'
].filter(Boolean);

export function chromeYolu() {
  return OLASI_CHROME_YOLLARI.find(p => fs.existsSync(p)) || null;
}

export async function chromeBaslat({ ekler = [] } = {}) {
  const yol = chromeYolu();
  if (!yol) throw new Error('Chrome bulunamadı. CHROME_YOLU ortam değişkenini verin.');
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sil-sinama-'));
  const argumanlar = [
    '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--user-data-dir=${profil}`, '--no-first-run', '--no-default-browser-check', '--disable-sync',
    '--disable-component-update', '--hide-scrollbars', '--mute-audio', '--lang=tr-TR',
    // GitHub'ın Linux makinelerinde Chrome'un kum havuzu açılamıyor.
    ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []),
    ...ekler, 'about:blank'
  ];
  // Chrome'un stderr'i okunmaz, bu yüzden boruya bağlanmaz (dolan boru Chrome'u durdurabilir).
  const surec = spawn(yol, argumanlar, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const yaz = surec.stdio[3];
  const oku = surec.stdio[4];
  const cozucu = new StringDecoder('utf8');
  let tampon = '';
  let sira = 0;
  const bekleyen = new Map();
  const dinleyiciler = new Set();
  // Chrome kapanır ya da çökerse bekleyen ve sonradan gönderilen istekler beklemede kalmaz, hata verir.
  let kapandi = null;
  const hepsiniReddet = neden => {
    kapandi = kapandi || neden;
    for (const { red, yontem } of bekleyen.values()) red(new Error(`${yontem}: ${kapandi}`));
    bekleyen.clear();
  };
  surec.on('exit', kod => hepsiniReddet(`Chrome kapandı (çıkış kodu ${kod})`));
  surec.on('error', hata => hepsiniReddet(`Chrome başlatılamadı (${hata.message})`));
  yaz.on('error', hata => hepsiniReddet(`Chrome'a yazılamadı (${hata.message})`));
  oku.on('data', veri => {
    tampon += cozucu.write(veri);
    let i;
    while ((i = tampon.indexOf('\0')) >= 0) {
      const ileti = JSON.parse(tampon.slice(0, i));
      tampon = tampon.slice(i + 1);
      if (ileti.id && bekleyen.has(ileti.id)) {
        const { coz, red, yontem } = bekleyen.get(ileti.id);
        bekleyen.delete(ileti.id);
        if (ileti.error) red(new Error(`${yontem}: ${ileti.error.message}`));
        else coz(ileti.result);
      } else {
        for (const f of dinleyiciler) f(ileti);
      }
    }
  });
  const gonder = (method, params = {}, sessionId) => new Promise((coz, red) => {
    if (kapandi) { red(new Error(`${method}: ${kapandi}`)); return; }
    const id = ++sira;
    bekleyen.set(id, { coz, red, yontem: method });
    yaz.write(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }) + '\0');
  });
  function kapat() {
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/F', '/T', '/PID', String(surec.pid)], { stdio: 'ignore' });
      else surec.kill('SIGKILL');
    } catch { /* süreç zaten kapanmış */ }
    for (let i = 0; i < 10; i++) {
      try {
        fs.rmSync(profil, { recursive: true, force: true });
        break;
      } catch {
        execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 300)']);
      }
    }
  }
  return { gonder, dinle: f => dinleyiciler.add(f), birak: f => dinleyiciler.delete(f), kapat, profil };
}

// Yeni sekme açar ve oturuma bağlanır; dönen g() ile o sekmeye komut gönderilir.
export async function sekmeAc(c, url) {
  const { targetId } = await c.gonder('Target.createTarget', { url });
  const { sessionId } = await c.gonder('Target.attachToTarget', { targetId, flatten: true });
  const g = (yontem, parametreler) => c.gonder(yontem, parametreler, sessionId);
  return { targetId, sessionId, g };
}

// Sayfada bir ifade doğru olana dek bekler; ifadenin değerini döndürür. Sayfa henüz yüklenirken ifade hata verebilir
// (ör. yeni sekme daha about:blank'teyken öğe yok) ya da bağlam gezinme sırasında yok olabilir; bunlar "henüz değil"
// sayılır ve süre dolana dek yeniden denenir. Süre dolunca son hata iletide yazar.
export async function ifadeBekle(g, ifade, sure = 10000) {
  const bas = Date.now();
  let sonHata = null;
  for (;;) {
    const r = await g('Runtime.evaluate', { expression: ifade, returnByValue: true, awaitPromise: true })
      .catch(hata => ({ exceptionDetails: { text: hata.message } }));
    if (r.exceptionDetails) sonHata = r.exceptionDetails.exception?.description || r.exceptionDetails.text;
    else if (r.result && r.result.value) return r.result.value;
    if (Date.now() - bas > sure) throw new Error('bekleme zaman aşımı: ' + ifade + (sonHata ? ` (son hata: ${sonHata})` : ''));
    await new Promise(z => setTimeout(z, 50));
  }
}

export async function degerlendir(g, ifade) {
  const r = await g('Runtime.evaluate', { expression: ifade, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('ifade hatası: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
