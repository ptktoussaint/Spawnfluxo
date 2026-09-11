'use strict';

// Núcleo do "cartão de compartilhamento" (Open Graph / Twitter Card): o bloco
// de <meta> que Discord, WhatsApp, Telegram e Slack leem para montar a prévia
// quando alguém cola o link do site.
//
// Este módulo é puro de propósito — não toca banco, express nem rede — porque
// os robôs de prévia NÃO executam JavaScript: as tags precisam ser montadas no
// servidor e já sair prontas dentro do HTML da resposta. Sendo puro, dá para
// testar tudo (fallbacks, escape, URL absoluta) sem subir servidor nem banco.

// Identidade do site. Estes são os valores de reserva usados quando o campo
// correspondente do cartão está vazio no painel admin.
// OBS: o logo também aparece no <header> de public/index.html e
// public/admin.html — se trocar aqui, troque lá também.
const SITE_DEFAULTS = {
  name: 'SPAWNS FLUXO "BY PTK"',
  description: 'Catálogo de códigos de spawn de veículos e itens do servidor',
  logo: 'https://i.imgur.com/IoY8XvL.png',
  themeColor: '#a855f7', // mesmo valor de --accent em public/css/style.css
};

// Tamanho que declaramos para a imagem do cartão. É a proporção que Discord,
// WhatsApp e Slack esperam de uma imagem "grande"; uma imagem com outra
// proporção ainda funciona, mas pode aparecer cortada/com barras.
const SHARE_IMAGE_WIDTH = 1200;
const SHARE_IMAGE_HEIGHT = 630;

// Escapa para uso DENTRO de um atributo HTML (content="..."). Os valores vêm
// do banco e podem conter &, ", < ou >; sem escapar, um título com aspas
// fecharia o atributo e quebraria o HTML da página inteira (além de virar
// brecha de injeção). O & precisa ser o PRIMEIRO substituído, senão as
// entidades geradas pelas trocas seguintes seriam escapadas de novo.
function escapeHtmlAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = String(value ?? '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

// Remove a barra final para podermos concatenar caminhos sem gerar "//".
function normalizeBaseUrl(baseUrl) {
  return String(baseUrl ?? '').trim().replace(/\/+$/, '');
}

// og:image precisa ser URL absoluta — caminho relativo ("/img/card.png") é
// simplesmente ignorado pelos robôs, que não têm como saber o domínio.
// Se já vier com http:// ou https://, usa como está; se vier como caminho
// interno, monta o endereço completo a partir do domínio do site.
function toAbsoluteUrl(value, baseUrl) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme) {
    // Só http/https viram URL de imagem. Qualquer outro esquema
    // (javascript:, data:, file:...) é descartado.
    return /^https?$/i.test(scheme[1]) ? raw : '';
  }

  // Protocol-relative ("//cdn/x.png") não dá para resolver com segurança aqui.
  if (raw.startsWith('//')) return '';

  const base = normalizeBaseUrl(baseUrl);
  if (!base) return ''; // sem domínio conhecido, melhor não emitir imagem quebrada
  return base + (raw.startsWith('/') ? raw : '/' + raw);
}

// Aplica as reservas: campo vazio cai para o valor equivalente do site.
// config: { shareTitle, shareDescription, shareImage } (todos opcionais)
function resolveShareCard(config = {}, options = {}) {
  const site = { ...SITE_DEFAULTS, ...(options.site || {}) };
  const base = normalizeBaseUrl(options.baseUrl);

  const title = firstNonEmpty(config.shareTitle, site.name);
  const description = firstNonEmpty(config.shareDescription, site.description);
  const image = toAbsoluteUrl(firstNonEmpty(config.shareImage, site.logo), base);

  return {
    title,
    description,
    image,
    siteName: site.name,
    themeColor: site.themeColor,
    // A URL nunca carrega query string: og:url vai parar nos servidores de
    // terceiros que geram a prévia, então não pode levar token, id de sessão
    // nem qualquer parâmetro.
    url: base ? base + '/' : '',
    // Cartão grande só faz sentido com imagem; sem imagem, o layout "summary"
    // é o correto (só texto, sem moldura de imagem vazia).
    twitterCard: image ? 'summary_large_image' : 'summary',
  };
}

function metaProperty(property, content) {
  return `<meta property="${escapeHtmlAttribute(property)}" content="${escapeHtmlAttribute(content)}">`;
}

function metaName(name, content) {
  return `<meta name="${escapeHtmlAttribute(name)}" content="${escapeHtmlAttribute(content)}">`;
}

// Monta o bloco de <meta> pronto para ser injetado no <head>.
function buildShareMetaTags(config = {}, options = {}) {
  const card = resolveShareCard(config, options);
  const tags = [
    metaName('description', card.description),
    metaName('theme-color', card.themeColor), // barra colorida lateral do cartão no Discord
    metaProperty('og:type', 'website'),
    metaProperty('og:site_name', card.siteName),
    metaProperty('og:title', card.title),
    metaProperty('og:description', card.description),
  ];

  if (card.url) tags.push(metaProperty('og:url', card.url));

  // Sem imagem, nenhuma tag de imagem é emitida — o cartão sai só com texto,
  // em vez de mostrar moldura de imagem quebrada.
  if (card.image) {
    tags.push(metaProperty('og:image', card.image));
    tags.push(metaProperty('og:image:width', String(SHARE_IMAGE_WIDTH)));
    tags.push(metaProperty('og:image:height', String(SHARE_IMAGE_HEIGHT)));
    tags.push(metaProperty('og:image:alt', card.title));
  }

  tags.push(metaName('twitter:card', card.twitterCard));
  tags.push(metaName('twitter:title', card.title));
  tags.push(metaName('twitter:description', card.description));
  if (card.image) tags.push(metaName('twitter:image', card.image));

  return tags.join('\n  ');
}

module.exports = {
  SITE_DEFAULTS,
  SHARE_IMAGE_WIDTH,
  SHARE_IMAGE_HEIGHT,
  escapeHtmlAttribute,
  toAbsoluteUrl,
  resolveShareCard,
  buildShareMetaTags,
};
