/* Bandezar – POŁĄCZENIA w instalacji zespołu (TRYB=zespol). Opis: dokumentacja/POLACZENIA-ZESPOLU.md.
   Instalacja zespołu sama, bez serwera Arka, pobiera:
     • emisje w radiu z odsluchane.eu (co godzinę, bez klucza),
     • ceny paliw z biuletynu Komisji Europejskiej + kursy EBC (dwa razy na dobę, bez klucza),
     • statystyki „W sieci” raz dziennie: Deezer (bez klucza), Last.fm (klucz zespołu), YouTube (klucz Google zespołu).
   Klucz Google zespołu służy też do przeglądania folderów Dysku Google (serwer/dysk.mjs), a Client ID Google do wysyłki
   terminów do Kalendarza Google (w przeglądarce, app/src/js/27-gkal.js).
   Ustawienia (meta 'uslugi') zmienia tylko lider. Klucze nigdy nie wracają do przeglądarki (tylko „ustawiony, kończy się na …”).
   Wszystko, co przychodzi z sieci, przechodzi przez filtry: liczby całkowite, krótki tekst bez < > " ` \, daty według wzorca.
   Wyniki: /radio.json, /staty.json, /paliwa.json w tym samym formacie co pliki robione przez GitHub Actions w wersji MKL,
   więc aplikacja czyta je tym samym kodem (17-radio.js, 26-siec.js, 23-paliwa.js). */

const UA = 'Bandezar/1.0 (organizer zespolu)';
const HOUR = 3600000;

/* ---------- czyszczenie ---------- */
export function czysc(t, maks = 100) {
  return String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f<>"`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, maks);
}
export function liczba(x) {
  const s = String(x == null ? '' : x).trim();
  if (!/^\d{1,13}$/.test(s)) return null;
  return Number(s);
}
export function klucz(x) {
  return String(x || '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', oacute: 'ó', Oacute: 'Ó', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bdquo: '„', rdquo: '”', ldquo: '“', rsquo: '’', lsquo: '‘' };
export function encje(s) {
  return String(s).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : ''; }
    return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
  });
}

async function pobierz(url, opts = {}, max = 5000000) {
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'pl,en;q=0.8', ...(opts.headers || {}) }, redirect: 'follow', signal: AbortSignal.timeout(opts.timeout || 25000) });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  const buf = await r.arrayBuffer();
  if (buf.byteLength > max) throw new Error('za duże');
  return opts.bin ? buf : new TextDecoder().decode(buf);
}
const pobierzJson = async (url, opts) => JSON.parse(await pobierz(url, opts));

/* ---------- RADIO: odsluchane.eu (ten sam algorytm co skrypty/radio_pobierz.py) ---------- */
const RE_DATA = /^(\d{2})-(\d{2})-(\d{4})$/, RE_GODZ = /^([01]\d|2[0-3]):([0-5]\d)$/;
const BLOKI = new Set(['tr', 'td', 'th', 'div', 'p', 'li', 'br', 'table', 'tbody', 'thead', 'h1', 'h2', 'h3', 'h4', 'section', 'article', 'header', 'footer', 'ul', 'ol', 'nav', 'main']);
/* tekst strony w kawałkach: jeden kawałek = tekst jednej komórki / jednego bloku */
export function kawalki(html) {
  const s = String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, '');
  const out = []; let buf = '';
  const flush = () => { const t = encje(buf).replace(/\s+/g, ' ').trim(); if (t) out.push(t); buf = ''; };
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|([^<]+)|</g; let m;
  while ((m = re.exec(s))) {
    if (m[1]) { if (BLOKI.has(m[1].toLowerCase())) flush(); }
    else buf += m[2] || '<';
  }
  flush();
  return out;
}
export function radioAdres(w) { return 'https://www.odsluchane.eu/wykonawca/' + encodeURIComponent(w); }
export function parsujRadio(html, wykonawca) {
  const k = kawalki(html), pref = String(wykonawca).toLowerCase() + ' - ', out = [];
  let dzien = null;
  for (let i = 0; i < k.length; i++) {
    const x = k[i], m = RE_DATA.exec(x);
    if (m) { dzien = `${m[3]}-${m[2]}-${m[1]}`; continue; }
    if (!dzien || !RE_GODZ.test(x)) continue;
    const reszta = k.slice(i + 1, i + 4);
    for (let j = 0; j < reszta.length; j++) {
      const y = reszta[j];
      if (y.toLowerCase().startsWith(pref) && j + 1 < reszta.length) {
        const ti = czysc(y.slice(pref.length), 80), st = czysc(reszta[j + 1], 60);
        if (ti && st && !RE_GODZ.test(st) && !RE_DATA.test(st)) out.push({ d: dzien, t: x, st, ti });
        break;
      }
    }
  }
  return out;
}

/* ---------- W SIECI: Deezer, Last.fm, YouTube (jak skrypty/staty_pobierz.py) ---------- */
export async function deezer(zespol) {
  const wyn = (await pobierzJson('https://api.deezer.com/search/artist?q=' + encodeURIComponent(zespol))).data || [];
  const art = wyn.find(a => klucz(a && a.name) === klucz(zespol));
  if (!art) throw Object.assign(new Error('brak'), { kod: 'brak' });
  const aid = liczba(art.id); if (aid == null) throw new Error('id');
  const a = await pobierzJson('https://api.deezer.com/artist/' + aid);
  const top = (await pobierzJson('https://api.deezer.com/artist/' + aid + '/top?limit=100')).data || [];
  const utwory = {};
  for (const t of top) { const ti = czysc(t && t.title, 80), r = liczba(t && t.rank); if (ti && r != null) utwory[ti] = Math.max(r, utwory[ti] || 0); }
  return { fani: liczba(a.nb_fan), url: 'https://www.deezer.com/artist/' + aid, utwory };
}
export async function lastfm(zespol, key) {
  const base = 'https://ws.audioscrobbler.com/2.0/?format=json&autocorrect=1&api_key=' + encodeURIComponent(key) + '&artist=' + encodeURIComponent(zespol);
  const info = await pobierzJson(base + '&method=artist.getinfo');
  if (info && info.error) throw Object.assign(new Error('lastfm'), { kod: info.error === 10 || info.error === 26 ? 'klucz' : 'brak' });
  const st = (info.artist && info.artist.stats) || {};
  const top = ((await pobierzJson(base + '&method=artist.gettoptracks&limit=300')).toptracks || {}).track || [];
  const utwory = {}, byly = new Set();
  for (const t of top) {
    const ti = czysc(t && t.name, 80), p = liczba(t && t.playcount), s = liczba(t && t.listeners);
    if (ti && p != null && s != null && !byly.has(klucz(ti))) { byly.add(klucz(ti)); utwory[ti] = [p, s]; }
  }
  return { sluchacze: liczba(st.listeners), odtworzenia: liczba(st.playcount), utwory };
}
export async function youtube(kanal, key) {
  const k = encodeURIComponent(key), Y = 'https://www.googleapis.com/youtube/v3/';
  const sel = kanal.startsWith('@') ? 'forHandle=' + encodeURIComponent(kanal) : 'id=' + encodeURIComponent(kanal);
  const ch = ((await pobierzJson(Y + 'channels?part=statistics,contentDetails&' + sel + '&key=' + k)).items || [])[0];
  if (!ch) throw Object.assign(new Error('kanal'), { kod: 'kanal' });
  const st = ch.statistics || {}, upl = ch.contentDetails && ch.contentDetails.relatedPlaylists && ch.contentDetails.relatedPlaylists.uploads;
  const ids = []; let tok = '';
  if (typeof upl === 'string' && /^[A-Za-z0-9_-]{10,60}$/.test(upl)) for (let i = 0; i < 6; i++) {
    const r = await pobierzJson(Y + 'playlistItems?part=contentDetails&maxResults=50&playlistId=' + upl + '&key=' + k + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''));
    for (const it of r.items || []) { const v = it && it.contentDetails && it.contentDetails.videoId; if (/^[A-Za-z0-9_-]{11}$/.test(v || '')) ids.push(v); }
    tok = typeof r.nextPageToken === 'string' && r.nextPageToken.length < 200 ? r.nextPageToken : '';
    if (!tok) break;
  }
  const filmy = {};
  for (let i = 0; i < ids.length; i += 50) {
    const r = await pobierzJson(Y + 'videos?part=statistics,snippet&id=' + ids.slice(i, i + 50).join(',') + '&key=' + k);
    for (const v of r.items || []) {
      const ti = czysc(v && v.snippet && v.snippet.title, 120), w = liczba(v && v.statistics && v.statistics.viewCount);
      if (ti && w != null && /^[A-Za-z0-9_-]{11}$/.test(v.id || '')) filmy[v.id] = [ti, w];
    }
  }
  return { subskrypcje: liczba(st.subscriberCount), wyswietlenia: liczba(st.viewCount), filmy };
}

/* ---------- CENY PALIW: biuletyn KE (plik .xlsx) + kursy EBC (jak skrypty/paliwa_ue.py) ---------- */
export const PALIWA_STRONA = 'https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en';
const ECB = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const KRAJE = { austria: 'AT', belgium: 'BE', bulgaria: 'BG', croatia: 'HR', cyprus: 'CY', czechia: 'CZ', 'czech republic': 'CZ', denmark: 'DK', estonia: 'EE', finland: 'FI', france: 'FR', germany: 'DE', greece: 'GR', hungary: 'HU', ireland: 'IE', italy: 'IT', latvia: 'LV', lithuania: 'LT', luxembourg: 'LU', malta: 'MT', netherlands: 'NL', poland: 'PL', portugal: 'PT', romania: 'RO', slovakia: 'SK', slovenia: 'SI', spain: 'ES', sweden: 'SE' };
const WALUTY = { CZ: 'CZK', DK: 'DKK', HU: 'HUF', PL: 'PLN', RO: 'RON', SE: 'SEK' };

/* rozpakowanie wybranych plików z ZIP-a (xlsx to ZIP z plikami XML) */
export async function unzip(buf, want) {
  const v = new DataView(buf), u8 = new Uint8Array(buf), out = {};
  let e = -1; for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('zip');
  const n = v.getUint16(e + 10, true); let p = v.getUint32(e + 16, true);
  for (let i = 0; i < n && p + 46 <= buf.byteLength; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('zip');
    const metoda = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true);
    const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    if (!want(name)) continue;
    if (usize > 30000000 || v.getUint32(lo, true) !== 0x04034b50) throw new Error('zip');
    const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true), data = u8.slice(start, start + csize);
    let raw;
    if (metoda === 0) raw = data;
    else if (metoda === 8) raw = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else throw new Error('zip');
    out[name] = new TextDecoder().decode(raw);
  }
  return out;
}
const xmlTekst = s => encje(String(s).replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<[^>]+>/g, ''));
function kolumna(ref) { let c = 0; for (const ch of String(ref).replace(/\d+$/, '')) c = c * 26 + (ch.charCodeAt(0) - 64); return c - 1; }
/* arkusz → tablica wierszy (komórki: liczba albo tekst) */
export function arkusz(xml, wspolne) {
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const r = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const at = cm[1], inner = cm[2] || '', ref = (/\br="([A-Z]+\d+)"/.exec(at) || [])[1], typ = (/\bt="(\w+)"/.exec(at) || [])[1] || 'n';
      const vv = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
      let val = null;
      if (typ === 's') val = wspolne[Number(vv)] ?? null;
      else if (typ === 'inlineStr') val = xmlTekst((/<is>([\s\S]*?)<\/is>/.exec(inner) || [])[1] || '');
      else if (typ === 'str') val = vv != null ? encje(vv) : null;
      else if (vv != null && vv !== '') val = Number(vv);
      const c = ref ? kolumna(ref) : r.length;
      if (c >= 0 && c < 100) r[c] = val;
    }
    rows.push(r);
  }
  return rows;
}
function num(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (x == null) return null;
  let s = String(x).replace(/[  ]/g, '');
  if (!/^[0-9.,]+$/.test(s)) return null;
  s = (s.split('.').length === 2 || (s.includes(',') && s.includes('.'))) ? s.replace(/,/g, '') : s.replace(/,/g, '.');
  const n = Number(s); return Number.isFinite(n) ? n : null;
}
function rodzaj(h) {
  h = String(h || '').toLowerCase();
  if (h.includes('super') && h.includes('95')) return 'pb';
  if (h.includes('gas oil') && (h.includes('auto') || h.includes('diesel'))) return 'on';
  if (h.includes('diesel')) return 'on';
  if (h.includes('lpg')) return 'lpg';
  return null;
}
const dataExcel = n => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
export function parsujPaliwa(arkusze) {
  for (const rows of arkusze) {
    for (let hi = 0; hi < Math.min(rows.length, 40); hi++) {
      const kinds = {}; (rows[hi] || []).forEach((c, j) => { const k = rodzaj(c); if (k && !(k in kinds)) kinds[k] = j; });
      if (!('pb' in kinds && 'on' in kinds)) continue;
      const wEur = String((rows[hi] || [])[0] || '').toLowerCase().includes('eur');
      let date = null;
      for (const r of rows.slice(0, hi + 2)) {
        for (const c of r || []) {
          if (typeof c === 'number' && c > 40000 && c < 70000 && Number.isInteger(c)) { date = dataExcel(c); break; }
          const s = String(c == null ? '' : c), m = /(20\d\d)[-/.](\d\d)[-/.](\d\d)/.exec(s) || /(\d\d)[-/.](\d\d)[-/.](20\d\d)/.exec(s);
          if (m) { date = m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`; break; }
        }
        if (date) break;
      }
      const out = {};
      for (const r of rows.slice(hi + 1)) {
        const name = ((r || []).slice(0, 3).find(c => typeof c === 'string' && c.trim()) || '').trim().toLowerCase();
        const code = KRAJE[name] || (name.length === 2 && Object.values(KRAJE).includes(name.toUpperCase()) ? name.toUpperCase() : null);
        if (!code) continue;
        const vals = {};
        for (const [k, j] of Object.entries(kinds)) { let x = num(r[j]); if (x == null || x <= 0) continue; if (x > 50) x /= 1000; vals[k] = Math.round(x * 1000) / 1000; }
        if (Object.keys(vals).length) { vals.cur = wEur ? 'EUR' : (WALUTY[code] || 'EUR'); out[code] = vals; }
      }
      return { date, countries: out };
    }
  }
  throw new Error('naglowki');
}
export function parsujKursy(xml) {
  const d = /time=['"](\d{4}-\d\d-\d\d)['"]/.exec(xml), r = {};
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g)) r[m[1]] = Number(m[2]);
  if (!d || Object.keys(r).length < 10) throw new Error('ebc');
  return { date: d[1], rates: r };
}
export function przelicz(p, kursy) {
  let ecb = null;
  for (const [c, v] of Object.entries(p.countries)) {
    if (WALUTY[c] && v.cur === 'EUR') {
      const k = kursy && kursy.rates[WALUTY[c]]; if (!k) throw new Error('kurs');
      for (const f of ['pb', 'on', 'lpg']) if (f in v) v[f] = Math.round(v[f] * k * 100) / 100;
      v.cur = WALUTY[c]; ecb = { date: kursy.date, url: ECB };
    }
  }
  if (Object.keys(p.countries).length < 10) throw new Error('kraje');
  for (const v of Object.values(p.countries)) for (const f of ['pb', 'on', 'lpg']) if (f in v && !(v[f] > 0.2 && v[f] < 5000)) throw new Error('cena');
  if (!/^\d{4}-\d\d-\d\d$/.test(p.date || '')) throw new Error('data');
  return { source: 'Komisja Europejska, Weekly Oil Bulletin (ceny z podatkami)', url: PALIWA_STRONA, date: p.date, fetched: new Date().toISOString().slice(0, 16) + 'Z', ecb, countries: p.countries };
}
export function linkXlsx(html) {
  const c = [...String(html).matchAll(/href="([^"]+)"/g)].map(m => m[1]).filter(l => l.includes('document/download') && /prices(%20|\s|_)+with(%20|\s|_)+taxes/i.test(l) && !/history/i.test(l));
  if (!c.length) throw new Error('link');
  const u = c[0].replace(/&amp;/g, '&');
  return u.startsWith('http') ? u : 'https://energy.ec.europa.eu' + u;
}
export async function pobierzPaliwa() {
  const url = linkXlsx(await pobierz(PALIWA_STRONA));
  if (!/^https:\/\/energy\.ec\.europa\.eu\//.test(url)) throw new Error('link');
  const buf = await pobierz(url, { bin: true, timeout: 40000 }, 20000000);
  const pliki = await unzip(buf, n => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const wspolne = [...(pliki['xl/sharedStrings.xml'] || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xmlTekst(m[1]));
  const ark = Object.keys(pliki).filter(n => n.startsWith('xl/worksheets/')).sort((a, b) => Number(/\d+/.exec(a.slice(14))[0]) - Number(/\d+/.exec(b.slice(14))[0])).map(n => arkusz(pliki[n], wspolne));
  const p = parsujPaliwa(ark);
  const kursy = Object.entries(p.countries).some(([c, v]) => WALUTY[c] && v.cur === 'EUR') ? parsujKursy(await pobierz(ECB)) : null;
  return przelicz(p, kursy);
}

/* ---------- ustawienia zespołu ---------- */
const RE = {
  yt: /^(@[A-Za-z0-9._-]{3,100}|UC[A-Za-z0-9_-]{22})$/,
  lf: /^[0-9a-f]{32}$/,
  gk: /^AIza[0-9A-Za-z_-]{30,45}$/,
  gc: /^\d{6,20}-[a-z0-9]{10,40}\.apps\.googleusercontent\.com$/
};
async function meta(env, k) { const v = await env.DB.prepare(`SELECT v FROM meta WHERE k = ?`).bind(k).first('v'); try { return v ? JSON.parse(v) : null; } catch (_) { return null; } }
async function metaSet(env, k, v) { await env.DB.prepare(`INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`).bind(k, JSON.stringify(v)).run(); }
export async function ustawienia(env) { const u = (await meta(env, 'uslugi')) || {}; return { w: u.w || '', yt: u.yt || '', lf: u.lf || '', gk: u.gk || '', gc: u.gc || '' }; }
/* zapis: pole pominięte albo puste = bez zmian (klucze), '-' = usuń; zwraca null albo kod błędu */
export async function zapiszUstawienia(env, d) {
  const u = await ustawienia(env);
  if (typeof d.w === 'string') u.w = czysc(d.w, 100);
  for (const f of ['yt', 'lf', 'gk', 'gc']) {
    if (typeof d[f] !== 'string') continue;
    const v = d[f].trim();
    if (!v) { if (f === 'yt' || f === 'gc') u[f] = ''; continue; }
    if (v === '-') { u[f] = ''; continue; }
    if (!RE[f].test(v)) return f;
    u[f] = v;
  }
  await metaSet(env, 'uslugi', u);
  return null;
}
const koncowka = k => k ? '…' + k.slice(-4) : '';
export async function stanUslug(env) {
  const u = await ustawienia(env), s = (await meta(env, 'uslugi_stan')) || {};
  const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM radio_plays`).first('n');
  const dni = await env.DB.prepare(`SELECT COUNT(*) AS n FROM staty_dni`).first('n');
  return { w: u.w, yt: u.yt, gc: u.gc, lf: !!u.lf, lfEnd: koncowka(u.lf), gk: !!u.gk, gkEnd: koncowka(u.gk), stan: s, emisje: n || 0, dni: dni || 0 };
}
export async function kluczGoogle(env) { try { return (await ustawienia(env)).gk; } catch (_) { return ''; } }

/* ---------- odświeżanie (co godzinę z zegara Cloudflare albo przyciskiem „Pobierz teraz”) ---------- */
const kodBledu = e => (e && e.kod) || (e && (e.status === 400 || e.status === 403) ? 'klucz' : e && e.status === 404 ? 'brak' : 'siec');
export async function odswiez(env, force) {
  const u = await ustawienia(env), s = (await meta(env, 'uslugi_stan')) || {}, now = Date.now(), dzis = new Date(now).toISOString().slice(0, 10);
  /* radio */
  if (u.w && (force || !s.r || now - (s.r.at || 0) > 50 * 60000)) {
    try {
      const plays = parsujRadio(await pobierz(radioAdres(u.w), {}, 3000000), u.w);
      let nowe = 0;
      for (let i = 0; i < plays.length; i += 50) {
        const res = await env.DB.batch(plays.slice(i, i + 50).map(e => env.DB.prepare(`INSERT OR IGNORE INTO radio_plays (k, d, t, st, ti) VALUES (?, ?, ?, ?, ?)`).bind(e.d + ' ' + e.t + ' ' + e.st, e.d, e.t, e.st, e.ti)));
        nowe += res.reduce((a, r) => a + ((r.meta && r.meta.changes) || 0), 0);
      }
      s.r = { at: now, n: plays.length, nowe, err: plays.length ? '' : 'brak' };
    } catch (e) { s.r = { ...(s.r || {}), at: now, err: kodBledu(e) }; }
  }
  /* ceny paliw (biuletyn wychodzi raz w tygodniu, sprawdzamy co 12 godzin) */
  if (force || !s.p || now - (s.p.at || 0) > 12 * HOUR) {
    try { const p = await pobierzPaliwa(); await metaSet(env, 'paliwa', p); s.p = { at: now, d: p.date, err: '' }; }
    catch (e) { s.p = { ...(s.p || {}), at: now, err: kodBledu(e) }; }
  }
  /* statystyki: raz dziennie, po 3:00 UTC; nieudana próba = kolejna za godzinę */
  const doStat = u.w || (u.yt && u.gk);
  if (doStat && (force || (!(s.s && s.s.d === dzis) && new Date(now).getUTCHours() >= 3 && now - ((s.s && s.s.at) || 0) > 50 * 60000))) {
    const wpis = { d: dzis }, bledy = {};
    const zrodla = [];
    if (u.w) zrodla.push(['deezer', () => deezer(u.w)]);
    if (u.w && u.lf) zrodla.push(['lastfm', () => lastfm(u.w, u.lf)]);
    if (u.yt && u.gk) zrodla.push(['youtube', () => youtube(u.yt, u.gk)]);
    for (const [n, f] of zrodla) { try { wpis[n] = await f(); } catch (e) { bledy[n] = kodBledu(e); } }
    if (Object.keys(wpis).length > 1) {
      await env.DB.prepare(`INSERT INTO staty_dni (d, v) VALUES (?, ?) ON CONFLICT(d) DO UPDATE SET v = excluded.v`).bind(dzis, JSON.stringify(wpis)).run();
      await env.DB.prepare(`DELETE FROM staty_dni WHERE d < ?`).bind(new Date(now - 400 * 86400000).toISOString().slice(0, 10)).run();
    }
    s.s = { at: now, d: Object.keys(wpis).length > 1 ? dzis : ((s.s && s.s.d) || ''), ok: Object.keys(wpis).filter(k => k !== 'd'), err: bledy };
  }
  await metaSet(env, 'uslugi_stan', s);
  return s;
}

/* ---------- pliki dla aplikacji: /radio.json, /staty.json, /paliwa.json (null = brak, wtedy plik z paczki albo 404) ---------- */
const iso16 = ms => new Date(ms).toISOString().slice(0, 16) + 'Z';
export async function daneJson(env, nazwa) {
  if (nazwa === 'paliwa.json') return await meta(env, 'paliwa');
  const u = await ustawienia(env), s = (await meta(env, 'uslugi_stan')) || {};
  if (!u.w && nazwa === 'radio.json') return null;
  const artist = u.w || (await env.DB.prepare(`SELECT name FROM bands LIMIT 1`).first('name')) || '';
  if (nazwa === 'radio.json') {
    const r = await env.DB.prepare(`SELECT d, t, st, ti FROM radio_plays ORDER BY d DESC, t DESC LIMIT 20000`).all();
    return { artist: u.w, source: radioAdres(u.w), updated: iso16((s.r && s.r.at) || Date.now()), plays: r.results };
  }
  if (nazwa === 'staty.json') {
    const r = await env.DB.prepare(`SELECT v FROM staty_dni ORDER BY d`).all(), historia = [];
    for (const x of r.results) { try { historia.push(JSON.parse(x.v)); } catch (_) { /* pomijamy */ } }
    if (!historia.length) return null;
    return { artist, updated: iso16((s.s && s.s.at) || Date.now()), historia };
  }
  return null;
}
