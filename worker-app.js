/* Bandezar na samym Cloudflare: strona + baza (D1) + pliki (R2) + zmiany na żywo (Durable Objects). Ustawienia: wrangler-app.jsonc.
   Opis: dokumentacja/CLOUDFLARE-BAZA.md. Stara wersja zespołu MKL (worker.js + Supabase) działa dalej osobno, nic tu jej nie zmienia.
   /api/baza/...      serwer danych (serwer/baza.mjs)
   /api/na-zywo       gniazdo zmian na żywo (serwer/na-zywo.mjs)
   /api/plik/...      podpisany link do pliku dla osób spoza zespołu (np. PDF oferty)
   /api/kalendarz/... terminy zespołu jako kalendarz do subskrypcji (.ics, link z podpisem)
   TRYB=zespol (wrangler-zespol.jsonc): instalacja na koncie zespołu, jeden zespół, wejście kodem licencji i linkami
   /api/spotify-album, /api/oferta, /api/dysk   jak w worker.js; logowanie sprawdzane w tej bazie
   /radio.json, /staty.json, /paliwa.json   w instalacji zespołu z bazy zespołu (serwer/uslugi.mjs, odświeżane co godzinę zegarem Cloudflare)
   Strona (index.html) dostaje znacznik <meta name="bz-baza" content="cloudflare">, po którym aplikacja wie, że ma używać tego serwera. */
import spotifyAlbum from './serwer/spotify-album.mjs';
import oferta from './serwer/oferta.mjs';
import dysk from './serwer/dysk.mjs';
import baza, { publicFile, socket, icsFeed, userFrom, roleOf, secret } from './serwer/baza.mjs';
import { odswiez, daneJson, kluczGoogle } from './serwer/uslugi.mjs';
export { Zespol } from './serwer/na-zywo.mjs';
export { Pliki } from './serwer/pliki-do.mjs';

/* dla /api/oferta i /api/dysk: kto jest zalogowany i jaką ma rolę (zamiast pytać Supabase) */
function withAuth(env) {
  return { ...env, AUTH: {
    user: async (request) => { try { const u = await userFrom(env, request); return u ? { id: u.id } : null; } catch (_) { return null; } },
    role: (band, uid) => roleOf(env, band, uid).catch(() => '')
  } };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), p = url.pathname;
    if (p.startsWith('/api/baza/')) return baza(request, env, ctx);
    if (p === '/api/na-zywo') return socket(env, request, url);
    if (p.startsWith('/api/plik/')) return request.method === 'GET' ? publicFile(env, url) : new Response('Method Not Allowed', { status: 405 });
    if (p.startsWith('/api/kalendarz/')) return request.method === 'GET' ? icsFeed(env, url) : new Response('Method Not Allowed', { status: 405 });
    if (p === '/api/spotify-album') {
      if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET' } });
      return spotifyAlbum(request);
    }
    if (p === '/api/oferta') return oferta(request, withAuth(env));
    if (p === '/api/dysk') {
      /* instalacja zespołu: klucz Google wklejony przez lidera w Ustawieniach → Połączenia */
      if (env.TRYB === 'zespol' && !env.GOOGLE_KEY) { try { await secret(env); } catch (_) { /* dysk sam zgłosi brak */ } return dysk(request, withAuth({ ...env, GOOGLE_KEY: await kluczGoogle(env) })); }
      return dysk(request, withAuth(env));
    }
    if (env.TRYB === 'zespol' && (p === '/radio.json' || p === '/staty.json' || p === '/paliwa.json') && request.method === 'GET') {
      let d = null; try { await secret(env); d = await daneJson(env, p.slice(1)); } catch (e) { console.error('dane', e && e.stack || e); }
      if (d) return new Response(JSON.stringify(d), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
      if (p !== '/paliwa.json') return new Response('Not Found', { status: 404 });
    }
    if (p.startsWith('/api/')) return new Response('Not Found', { status: 404 });
    const r = await env.ASSETS.fetch(request);
    if (!(r.headers.get('content-type') || '').startsWith('text/html')) return r;
    return new HTMLRewriter().on('head', { element(e) { e.prepend('<meta name="bz-baza" content="cloudflare">' + (env.TRYB === 'zespol' ? '<meta name="bz-tryb" content="zespol">' : ''), { html: true }); } }).transform(r);
  },
  /* zegar Cloudflare (triggers.crons w wrangler-zespol.jsonc): co godzinę radio, ceny paliw i statystyki, gdy przyszła pora */
  async scheduled(event, env, ctx) {
    if (env.TRYB !== 'zespol') return;
    ctx.waitUntil(secret(env).then(() => odswiez(env, false)).catch(e => console.error('odswiez', e && e.stack || e)));
  }
};
