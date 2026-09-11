'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SITE_DEFAULTS,
  escapeHtmlAttribute,
  toAbsoluteUrl,
  resolveShareCard,
  buildShareMetaTags,
} = require('../lib/share-card');

const BASE = 'https://spawnfluxo.onrender.com';

// Extrai o content="..." de uma tag pelo seu property/name, já como texto cru
// do HTML (sem desescapar) — é assim que o robô de prévia enxerga.
function rawContentOf(html, attr, key) {
  const re = new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`);
  const match = html.match(re);
  return match ? match[1] : null;
}

test('título e subtítulo próprios têm prioridade sobre o nome/descrição do site', () => {
  const card = resolveShareCard(
    { shareTitle: 'Catálogo de Spawns', shareDescription: 'Todos os códigos do servidor' },
    { baseUrl: BASE }
  );

  assert.equal(card.title, 'Catálogo de Spawns');
  assert.equal(card.description, 'Todos os códigos do servidor');
  // o nome do site continua indo em og:site_name, separado do título
  assert.equal(card.siteName, SITE_DEFAULTS.name);
});

test('campos vazios caem para as reservas do site', () => {
  const card = resolveShareCard({}, { baseUrl: BASE });

  assert.equal(card.title, SITE_DEFAULTS.name);
  assert.equal(card.description, SITE_DEFAULTS.description);
  assert.equal(card.image, SITE_DEFAULTS.logo);
});

test('campos só com espaço em branco contam como vazios', () => {
  const card = resolveShareCard(
    { shareTitle: '   ', shareDescription: '\n\t ', shareImage: '  ' },
    { baseUrl: BASE }
  );

  assert.equal(card.title, SITE_DEFAULTS.name);
  assert.equal(card.description, SITE_DEFAULTS.description);
  assert.equal(card.image, SITE_DEFAULTS.logo);
});

test('sem imagem nenhuma, o cartão sai só com texto e vira summary', () => {
  const card = resolveShareCard({}, { baseUrl: BASE, site: { ...SITE_DEFAULTS, logo: '' } });
  assert.equal(card.image, '');
  assert.equal(card.twitterCard, 'summary');

  const html = buildShareMetaTags({}, { baseUrl: BASE, site: { ...SITE_DEFAULTS, logo: '' } });
  assert.ok(!html.includes('og:image'), 'não deve emitir og:image sem imagem');
  assert.ok(!html.includes('twitter:image'), 'não deve emitir twitter:image sem imagem');
  assert.ok(html.includes('content="summary"'));
});

test('com imagem, vira summary_large_image e declara dimensões e alt', () => {
  const html = buildShareMetaTags({ shareTitle: 'Spawns' }, { baseUrl: BASE });

  assert.equal(rawContentOf(html, 'name', 'twitter:card'), 'summary_large_image');
  assert.equal(rawContentOf(html, 'property', 'og:image:width'), '1200');
  assert.equal(rawContentOf(html, 'property', 'og:image:height'), '630');
  assert.equal(rawContentOf(html, 'property', 'og:image:alt'), 'Spawns');
});

test('caminho interno de imagem vira endereço absoluto', () => {
  assert.equal(toAbsoluteUrl('/img/card.png', BASE), `${BASE}/img/card.png`);
  // sem a barra inicial também funciona
  assert.equal(toAbsoluteUrl('img/card.png', BASE), `${BASE}/img/card.png`);
  // barra sobrando na base não gera "//"
  assert.equal(toAbsoluteUrl('/img/card.png', `${BASE}/`), `${BASE}/img/card.png`);

  const card = resolveShareCard({ shareImage: '/uploads/x.png' }, { baseUrl: BASE });
  assert.equal(card.image, `${BASE}/uploads/x.png`);
});

test('URL externa http/https é usada como veio', () => {
  assert.equal(toAbsoluteUrl('https://i.imgur.com/IoY8XvL.png', BASE), 'https://i.imgur.com/IoY8XvL.png');
  assert.equal(toAbsoluteUrl('http://exemplo.com/a.png', BASE), 'http://exemplo.com/a.png');
});

test('esquemas perigosos na imagem são descartados', () => {
  assert.equal(toAbsoluteUrl('javascript:alert(1)', BASE), '');
  assert.equal(toAbsoluteUrl('data:text/html,<script>alert(1)</script>', BASE), '');
});

test('título com <script> não sai como tag executável', () => {
  const html = buildShareMetaTags(
    { shareTitle: '<script>alert("xss")</script>' },
    { baseUrl: BASE }
  );

  assert.ok(!html.includes('<script>'), 'a tag não pode aparecer crua no HTML');
  assert.ok(!html.includes('</script>'), 'o fechamento também não');
  assert.equal(
    rawContentOf(html, 'property', 'og:title'),
    '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
  );
});

test('aspas no valor não escapam do atributo content', () => {
  // O próprio nome do site tem aspas — é o caso real que quebraria a página.
  const html = buildShareMetaTags({}, { baseUrl: BASE });
  assert.equal(rawContentOf(html, 'property', 'og:site_name'), 'SPAWNS FLUXO &quot;BY PTK&quot;');

  const injected = buildShareMetaTags(
    { shareDescription: '" onload="alert(1)' },
    { baseUrl: BASE }
  );
  assert.ok(!injected.includes('onload="alert(1)"'));
  assert.equal(rawContentOf(injected, 'property', 'og:description'), '&quot; onload=&quot;alert(1)');
});

test('& é escapado uma vez só (sem dupla codificação)', () => {
  const html = buildShareMetaTags({ shareTitle: 'Armas & Itens' }, { baseUrl: BASE });
  assert.equal(rawContentOf(html, 'property', 'og:title'), 'Armas &amp; Itens');
  assert.ok(!html.includes('&amp;amp;'));
});

test('og:url é a raiz do site, sem query string', () => {
  const card = resolveShareCard({}, { baseUrl: `${BASE}/` });
  assert.equal(card.url, `${BASE}/`);
  assert.ok(!card.url.includes('?'), 'og:url não pode levar parâmetro nenhum');
});

test('emite todas as tags pedidas', () => {
  const html = buildShareMetaTags({ shareTitle: 'T', shareDescription: 'D' }, { baseUrl: BASE });
  for (const expected of [
    '<meta name="description"',
    '<meta name="theme-color"',
    '<meta property="og:type"',
    '<meta property="og:site_name"',
    '<meta property="og:title"',
    '<meta property="og:description"',
    '<meta property="og:url"',
    '<meta property="og:image"',
    '<meta property="og:image:width"',
    '<meta property="og:image:height"',
    '<meta property="og:image:alt"',
    '<meta name="twitter:card"',
    '<meta name="twitter:title"',
    '<meta name="twitter:description"',
    '<meta name="twitter:image"',
  ]) {
    assert.ok(html.includes(expected), `faltou ${expected}`);
  }
});

test('theme-color usa a cor principal do site', () => {
  const html = buildShareMetaTags({}, { baseUrl: BASE });
  assert.equal(rawContentOf(html, 'name', 'theme-color'), '#a855f7');
});

test('escapeHtmlAttribute cobre os cinco caracteres perigosos', () => {
  assert.equal(escapeHtmlAttribute(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(escapeHtmlAttribute(null), '');
  assert.equal(escapeHtmlAttribute(undefined), '');
});
