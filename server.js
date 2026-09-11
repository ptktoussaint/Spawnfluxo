require('dotenv').config({ quiet: true });
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const {
  buildShareMetaTags,
  toAbsoluteUrl,
  SITE_DEFAULTS,
  SHARE_IMAGE_WIDTH,
  SHARE_IMAGE_HEIGHT,
} = require('./lib/share-card');

const app = express();
// Só usamos parâmetros de busca simples (?q=&category=), então trocamos o
// parser padrão (qs) pelo parser simples do Node: evita uma vulnerabilidade
// de DoS conhecida no qs (sem correção disponível ainda) sem perder nada,
// já que nunca precisamos da sintaxe de colchetes/aninhamento que ele resolve.
app.set('query parser', 'simple');
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h de sessão
const SEED_FILE = path.join(__dirname, 'data', 'seed-cars.json');
const SEED_ITEMS_FILE = path.join(__dirname, 'data', 'seed-items.json');
const VALID_TYPES = ['veiculo', 'item'];
const INDEX_FILE = path.join(__dirname, 'public', 'index.html');
const SHARE_META_PLACEHOLDER = '<!--SHARE_META-->';

// Domínio público canônico (ex.: https://spawnfluxo.onrender.com). Serve para
// montar og:url e transformar a imagem do cartão em URL absoluta. Se não for
// definido, caímos no domínio do cabeçalho Host da requisição — funciona, mas
// esse cabeçalho é controlado por quem chama, então em produção vale fixar.
const SITE_URL = normalizeSiteUrl(process.env.SITE_URL);

function normalizeSiteUrl(value) {
  const raw = String(value ?? '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const { protocol } = new URL(raw);
    if (protocol !== 'https:' && protocol !== 'http:') throw new Error('protocolo inválido');
    return raw;
  } catch {
    console.warn(`[AVISO] SITE_URL inválida (${value}); usando o domínio da requisição.`);
    return '';
  }
}

// Só caracteres válidos de host: o Host vem de quem chama, não entra cru.
const SAFE_HOST_PATTERN = /^[A-Za-z0-9.-]+(:\d+)?$/;

function getBaseUrl(req) {
  if (SITE_URL) return SITE_URL;
  const host = req.get('host') || '';
  if (!SAFE_HOST_PATTERN.test(host)) return '';
  return `${req.protocol}://${host}`;
}

if (ADMIN_PASSWORD === 'admin123' || ADMIN_PASSWORD.length < 8) {
  console.warn(
    '[AVISO DE SEGURANÇA] ADMIN_PASSWORD está fraca ou usando o valor padrão. ' +
    'Defina uma senha forte na variável de ambiente ADMIN_PASSWORD antes de expor este servidor publicamente.'
  );
}

// ----- Banco de dados (Postgres via Supabase) -----
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(
    'Falta a variável de ambiente DATABASE_URL (connection string do Postgres/Supabase). ' +
    'Veja o README para instruções de configuração.'
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  // Supabase exige TLS; rejectUnauthorized:false evita falha de verificação
  // de cadeia de certificado comum em hosts gerenciados como este.
  ssl: { rejectUnauthorized: false },
});

// Sem este listener, uma conexão ociosa que cai (banco reiniciou, rede oscilou,
// Supabase hibernou) vira um 'error' não tratado e o Node derruba o processo
// inteiro — tirando o site do ar mesmo com todo o catálogo já em memória, que
// continuaria sendo servido sem problema. Registrar o listener transforma isso
// num aviso no log: o pool descarta a conexão morta e abre outra na próxima
// escrita.
pool.on('error', (err) => {
  console.error('[AVISO] Conexão ociosa com o Postgres caiu; o cache em memória continua servindo.', err.message);
});

function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // remove acentos
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}

function rowToCar(row) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    spawnCode: row.spawn_code,
    categories: row.categories || [],
    photoUrl: row.photo_url || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// "veiculo" (aba original) ou "item" (aba nova) — qualquer outro valor é
// rejeitado; nunca aceitamos o valor cru do cliente sem passar por aqui.
function normalizeType(type) {
  return VALID_TYPES.includes(type) ? type : null;
}

const MAX_NAME_LENGTH = 200;
const MAX_SPAWN_CODE_LENGTH = 100;
const MAX_CATEGORY_LENGTH = 60;
const MAX_CATEGORIES_PER_CAR = 20;
const MAX_PHOTO_URL_LENGTH = 2000;

// Limites de tamanho evitam que um valor absurdamente grande fique preso no
// cache em memória e seja reenviado em toda resposta pública dali em diante.
function normalizeCategoriesInput(categories) {
  if (!Array.isArray(categories) || categories.length > MAX_CATEGORIES_PER_CAR) return null;
  const trimmed = categories.map((c) => String(c).trim()).filter(Boolean);
  if (trimmed.some((c) => c.length > MAX_CATEGORY_LENGTH)) return null;
  return [...new Set(trimmed)];
}

// ----- Cache em memória -----
// Bancos gerenciados costumam cobrar ou limitar por operação/tráfego. Para
// não depender do número de acessos ao site, os dados ficam em memória e o
// banco só é lido uma vez (na inicialização do servidor) e escrito a cada
// alteração do admin — nunca lido de novo a cada requisição pública.
let carsCache = [];
let categoriesCache = { veiculo: [], item: [] };

// Campos do "Cartão de compartilhamento". Ficam no mesmo cache em memória que
// carros e categorias: renderizar a home NÃO consulta o banco nenhuma vez.
const SHARE_FIELDS = {
  shareTitle: { key: 'share_title', label: 'Título do cartão', maxLength: 200 },
  shareDescription: { key: 'share_description', label: 'Subtítulo do cartão', maxLength: 300 },
  shareImage: { key: 'share_image', label: 'Imagem do cartão', maxLength: MAX_PHOTO_URL_LENGTH },
};

let siteConfigCache = { shareTitle: '', shareDescription: '', shareImage: '' };

// Limite curto: se o banco estiver lento/fora do ar na inicialização, seguimos
// com os valores de reserva em vez de ficar pendurado esperando resposta.
const SITE_CONFIG_QUERY_TIMEOUT_MS = 3000;

async function queryWithTimeout(text, params, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`consulta passou de ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([pool.query(text, params), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function loadSiteConfigFromDb() {
  try {
    const { rows } = await queryWithTimeout('SELECT key, value FROM site_config', [], SITE_CONFIG_QUERY_TIMEOUT_MS);
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const loaded = {};
    for (const [field, { key }] of Object.entries(SHARE_FIELDS)) {
      loaded[field] = byKey.get(key) || '';
    }
    siteConfigCache = loaded;
  } catch (err) {
    // Inclui o caso "tabela ainda não existe" (migração 003 não rodada): o
    // site sobe normalmente, só usando as reservas no cartão.
    console.warn(
      '[AVISO] Não foi possível ler site_config; o cartão de compartilhamento vai usar os valores de reserva.',
      err.message
    );
  }
}

function sortCategoryNames(names) {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function addCategoriesToCache(type, names) {
  categoriesCache[type] = sortCategoryNames([...(categoriesCache[type] || []), ...names]);
}

async function loadCacheFromDb() {
  const [carsResult, catResult] = await Promise.all([
    pool.query('SELECT * FROM cars'),
    pool.query('SELECT * FROM categories'),
  ]);
  carsCache = carsResult.rows.map(rowToCar);
  const grouped = { veiculo: [], item: [] };
  for (const row of catResult.rows) {
    if (!grouped[row.type]) grouped[row.type] = [];
    if (row.name) grouped[row.type].push(row.name);
  }
  categoriesCache = {
    veiculo: sortCategoryNames(grouped.veiculo),
    item: sortCategoryNames(grouped.item),
  };
  const totalVeiculos = carsCache.filter((c) => c.type === 'veiculo').length;
  const totalItens = carsCache.filter((c) => c.type === 'item').length;
  console.log(
    `Cache carregado do banco: ${totalVeiculos} veículos (${categoriesCache.veiculo.length} categorias), ` +
    `${totalItens} itens (${categoriesCache.item.length} categorias).`
  );
}

function readCars(type) {
  return carsCache.filter((c) => c.type === type);
}

function readCategoryNames(type) {
  return categoriesCache[type] || [];
}

async function registerCategories(type, names) {
  for (const name of names) {
    const slug = slugify(name);
    if (!slug) continue;
    await pool.query(
      `INSERT INTO categories (type, slug, name, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (type, slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
      [type, slug, name]
    );
  }
  addCategoriesToCache(type, names);
}

async function seedTypeIfEmpty(type, seedFile) {
  const { rows } = await pool.query('SELECT 1 FROM cars WHERE type = $1 LIMIT 1', [type]);
  if (rows.length > 0) return;
  if (!fs.existsSync(seedFile)) return;

  const seedCars = JSON.parse(fs.readFileSync(seedFile, 'utf-8'));
  if (seedCars.length === 0) return;

  const values = [];
  const placeholders = seedCars.map((car, i) => {
    const base = i * 8;
    values.push(
      car.id,
      type,
      car.name,
      car.spawnCode,
      car.category ? [car.category] : [],
      car.photoUrl || '',
      car.createdAt,
      car.updatedAt
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
  });

  await pool.query(
    `INSERT INTO cars (id, type, name, spawn_code, categories, photo_url, created_at, updated_at)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (id) DO NOTHING`,
    values
  );

  await registerCategories(type, [...new Set(seedCars.map((c) => c.category).filter(Boolean))]);
  console.log(`Banco semeado com ${seedCars.length} ${type === 'item' ? 'itens' : 'veículos'} a partir de ${path.basename(seedFile)}.`);
}

async function seedIfEmpty() {
  await seedTypeIfEmpty('veiculo', SEED_FILE);
  await seedTypeIfEmpty('item', SEED_ITEMS_FILE);
}

// Tokens de sessao do admin ficam apenas em memoria (nunca tocam disco) e
// expiram sozinhos; reiniciar o servidor também derruba todas as sessões.
const tokens = new Map(); // token -> expiresAt

function issueToken() {
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, Date.now() + TOKEN_TTL_MS);
  return token;
}

function isValidToken(token) {
  const expiresAt = tokens.get(token);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    tokens.delete(token);
    return false;
  }
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [token, expiresAt] of tokens) {
    if (now > expiresAt) tokens.delete(token);
  }
}, 60 * 60 * 1000).unref();

function safeCompare(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Ainda gasta o tempo de uma comparação para não vazar o tamanho via timing.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function isValidPhotoUrl(url) {
  if (!url) return true; // foto é opcional
  if (url.length > MAX_PHOTO_URL_LENGTH) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token && isValidToken(token)) return next();
  return res.status(401).json({ error: 'Não autorizado' });
}

// Habilite se o app rodar atrás de um proxy/load balancer (Render, Railway, etc.)
// para o rate limiter identificar o IP real do cliente.
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'https:'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
    },
  },
}));

// Helmet não define mais um Permissions-Policy padrão; como o site não usa
// nenhuma dessas APIs do navegador, desabilita todas explicitamente.
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=(), usb=()');
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // só conta tentativas com senha errada, não logins legítimos
  message: { error: 'Muitas tentativas de login. Tente novamente mais tarde.' },
});

const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

// Limite adicional e mais rígido só para as rotas que escrevem no banco —
// mesmo com um token válido, evita que ele seja usado para inundar o banco
// de escritas (ex.: um token vazado/roubado).
const writeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas alterações em pouco tempo. Tente novamente em alguns minutos.' },
});

app.use('/api', apiLimiter);
app.use(express.json({ limit: '200kb' }));

// ----- Home com o cartão de compartilhamento embutido -----
// Precisa vir ANTES do express.static, que serviria o index.html cru.
//
// Os robôs de prévia (Discord, WhatsApp, Telegram, Slack) não executam
// JavaScript: nada que o navegador aplique depois existe para eles. Por isso as
// meta tags são montadas aqui no servidor e já saem prontas no HTML.
// Também não há redirecionamento nenhum neste caminho, de propósito — o robô
// não carrega cookie e acabaria lendo o cartão da página errada.
let indexHtmlTemplate = '';

function loadIndexTemplate() {
  try {
    indexHtmlTemplate = fs.readFileSync(INDEX_FILE, 'utf-8');
  } catch (err) {
    console.error('[AVISO] Não foi possível ler public/index.html:', err.message);
    indexHtmlTemplate = '';
  }
}

app.get(['/', '/index.html'], (req, res, next) => {
  if (!indexHtmlTemplate) return next(); // deixa o express.static tentar servir
  const metaTags = buildShareMetaTags(siteConfigCache, { baseUrl: getBaseUrl(req) });
  const html = indexHtmlTemplate.includes(SHARE_META_PLACEHOLDER)
    ? indexHtmlTemplate.replace(SHARE_META_PLACEHOLDER, metaTags)
    : indexHtmlTemplate.replace('</head>', `  ${metaTags}\n</head>`);
  // O cartão muda assim que o admin salva; sem isso o robô poderia reusar uma
  // versão antiga do HTML guardada em cache.
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(html);
});

app.use(express.static(path.join(__dirname, 'public')));

// ----- Endpoints públicos (somente leitura) -----

app.get('/api/cars', (req, res) => {
  const type = normalizeType(req.query.type) || 'veiculo';
  const { q = '', category = '' } = req.query;
  let cars = readCars(type);
  const term = String(q).trim().toLowerCase();
  if (term) {
    cars = cars.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        c.spawnCode.toLowerCase().includes(term) ||
        c.categories.some((cat) => cat.toLowerCase().includes(term))
    );
  }
  // ?category= pode repetir (?category=A&category=B): o parser simples do
  // Node já entrega um array nesse caso. Casa qualquer uma das selecionadas.
  const categoryList = Array.isArray(category) ? category : category ? [category] : [];
  if (categoryList.length > 0) {
    cars = cars.filter((c) => categoryList.some((cat) => c.categories.includes(cat)));
  }
  cars = [...cars].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  res.json(cars);
});

app.get('/api/categories', (req, res) => {
  const type = normalizeType(req.query.type) || 'veiculo';
  res.json(readCategoryNames(type));
});

// Criação explícita de categoria, mesmo sem nenhum carro usando-a ainda.
app.post('/api/categories', requireAuth, writeLimiter, async (req, res, next) => {
  try {
    const { name, type: rawType } = req.body || {};
    const type = normalizeType(rawType);
    if (!type) return res.status(400).json({ error: 'Tipo inválido (use "veiculo" ou "item")' });
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) return res.status(400).json({ error: 'Nome da categoria é obrigatório' });
    if (trimmed.length > MAX_CATEGORY_LENGTH) {
      return res.status(400).json({ error: `Nome de categoria muito longo (máx. ${MAX_CATEGORY_LENGTH} caracteres)` });
    }
    const slug = slugify(trimmed);
    if (!slug) return res.status(400).json({ error: 'Nome de categoria inválido' });
    await pool.query(
      `INSERT INTO categories (type, slug, name, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (type, slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
      [type, slug, trimmed]
    );
    addCategoriesToCache(type, [trimmed]);
    res.status(201).json({ type, name: trimmed });
  } catch (err) {
    next(err);
  }
});

// Renomeia uma categoria. Atualiza a linha em categories e troca o nome
// dentro do array categories[] de todo carro/item que a usava, tudo na mesma
// transação — o efeito aparece nos botões públicos assim que o cache atualiza.
app.put('/api/categories/:type/:name', requireAuth, writeLimiter, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const type = normalizeType(req.params.type);
    if (!type) return res.status(400).json({ error: 'Tipo inválido' });
    const oldName = req.params.name;
    const { name: rawNewName } = req.body || {};
    const newName = typeof rawNewName === 'string' ? rawNewName.trim() : '';
    if (!newName) return res.status(400).json({ error: 'Novo nome da categoria é obrigatório' });
    if (newName.length > MAX_CATEGORY_LENGTH) {
      return res.status(400).json({ error: `Nome de categoria muito longo (máx. ${MAX_CATEGORY_LENGTH} caracteres)` });
    }
    const newSlug = slugify(newName);
    if (!newSlug) return res.status(400).json({ error: 'Nome de categoria inválido' });

    await client.query('BEGIN');
    const oldCatResult = await client.query('SELECT slug FROM categories WHERE type = $1 AND name = $2', [type, oldName]);
    if (oldCatResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }
    const oldSlug = oldCatResult.rows[0].slug;

    if (newSlug !== oldSlug) {
      const clash = await client.query('SELECT 1 FROM categories WHERE type = $1 AND slug = $2', [type, newSlug]);
      if (clash.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Já existe uma categoria com esse nome' });
      }
    }

    await client.query(
      'UPDATE categories SET slug = $1, name = $2, updated_at = now() WHERE type = $3 AND slug = $4',
      [newSlug, newName, type, oldSlug]
    );
    const now = new Date().toISOString();
    const carsResult = await client.query(
      `UPDATE cars SET categories = array_replace(categories, $1, $2), updated_at = $3
       WHERE type = $4 AND $1 = ANY(categories)
       RETURNING *`,
      [oldName, newName, now, type]
    );
    await client.query('COMMIT');

    const updatedById = new Map(carsResult.rows.map((r) => [r.id, rowToCar(r)]));
    carsCache = carsCache.map((c) => updatedById.get(c.id) || c);
    categoriesCache[type] = sortCategoryNames(categoriesCache[type].map((n) => (n === oldName ? newName : n)));

    res.json({ ok: true, name: newName, affectedCars: carsResult.rows.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// Exclui uma categoria. Carros/itens que a tinham simplesmente perdem essa
// categoria (podendo ficar sem nenhuma) — eles não são excluídos.
app.delete('/api/categories/:type/:name', requireAuth, writeLimiter, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const type = normalizeType(req.params.type);
    if (!type) return res.status(400).json({ error: 'Tipo inválido' });
    const categoryName = req.params.name;
    const now = new Date().toISOString();

    await client.query('BEGIN');
    const catResult = await client.query(
      'DELETE FROM categories WHERE type = $1 AND name = $2 RETURNING slug',
      [type, categoryName]
    );
    if (catResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }
    const updateResult = await client.query(
      `UPDATE cars SET categories = array_remove(categories, $1), updated_at = $2
       WHERE type = $3 AND $1 = ANY(categories)
       RETURNING *`,
      [categoryName, now, type]
    );
    await client.query('COMMIT');

    const updatedById = new Map(updateResult.rows.map((r) => [r.id, rowToCar(r)]));
    carsCache = carsCache.map((c) => updatedById.get(c.id) || c);
    categoriesCache[type] = categoriesCache[type].filter((name) => name !== categoryName);

    res.json({ ok: true, affectedCars: updateResult.rows.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ----- Configuração do site (cartão de compartilhamento) -----
// Os valores já saem públicos nas meta tags da home, mas só o admin precisa
// lê-los por aqui — então a rota fica atrás do login como as demais de gestão.

// Aceita o mesmo que o renderizador aceita: vazio (usa o logo do site), link
// http(s) externo, ou caminho interno que vira URL absoluta na hora de montar
// a tag. Usar a mesma função evita salvar algo que depois seria descartado.
function isValidShareImage(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return true;
  return toAbsoluteUrl(raw, 'https://exemplo.invalid') !== '';
}

app.get('/api/site-config', requireAuth, (req, res) => {
  // Os valores de reserva vão junto para o painel mostrar, em cada campo
  // vazio, exatamente o que o cartão vai usar no lugar.
  res.json({
    ...siteConfigCache,
    defaults: {
      title: SITE_DEFAULTS.name,
      description: SITE_DEFAULTS.description,
      image: SITE_DEFAULTS.logo,
    },
    recommendedImageSize: { width: SHARE_IMAGE_WIDTH, height: SHARE_IMAGE_HEIGHT },
  });
});

app.put('/api/site-config', requireAuth, writeLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const updated = { ...siteConfigCache };

    for (const [field, { label, maxLength }] of Object.entries(SHARE_FIELDS)) {
      if (body[field] === undefined) continue; // campo não enviado = mantém o atual
      const value = String(body[field] ?? '').trim();
      if (value.length > maxLength) {
        return res.status(400).json({ error: `${label}: muito longo (máx. ${maxLength} caracteres)` });
      }
      updated[field] = value;
    }

    if (!isValidShareImage(updated.shareImage)) {
      return res.status(400).json({
        error: 'Imagem do cartão inválida. Use um link https:// (recomendado) ou um caminho interno começando com /.',
      });
    }

    for (const [field, { key }] of Object.entries(SHARE_FIELDS)) {
      await pool.query(
        `INSERT INTO site_config (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, updated[field]]
      );
    }

    siteConfigCache = updated;
    res.json({ ...siteConfigCache });
  } catch (err) {
    next(err);
  }
});

// ----- Autenticação do admin -----

app.post('/api/login', loginLimiter, (req, res) => {
  const { password } = req.body || {};
  if (typeof password === 'string' && safeCompare(password, ADMIN_PASSWORD)) {
    return res.json({ token: issueToken() });
  }
  res.status(401).json({ error: 'Senha incorreta' });
});

app.post('/api/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization.slice(7);
  tokens.delete(token);
  res.json({ ok: true });
});

// ----- Endpoints administrativos (protegidos) -----

app.post('/api/cars', requireAuth, writeLimiter, async (req, res, next) => {
  try {
    const { type: rawType, name, spawnCode, categories, photoUrl } = req.body || {};
    const type = normalizeType(rawType);
    if (!type) return res.status(400).json({ error: 'Tipo inválido (use "veiculo" ou "item")' });
    const cleanCategories = normalizeCategoriesInput(categories);
    if (!name || !spawnCode || !cleanCategories || cleanCategories.length === 0) {
      return res.status(400).json({ error: 'Nome, código e ao menos uma categoria são obrigatórios' });
    }
    if (String(name).trim().length > MAX_NAME_LENGTH || String(spawnCode).trim().length > MAX_SPAWN_CODE_LENGTH) {
      return res.status(400).json({ error: `Nome (máx. ${MAX_NAME_LENGTH}) ou código (máx. ${MAX_SPAWN_CODE_LENGTH}) muito longo` });
    }
    if (photoUrl && !isValidPhotoUrl(photoUrl)) {
      return res.status(400).json({ error: 'URL de foto inválida. Use um link https://.' });
    }
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const car = {
      id,
      type,
      name: String(name).trim(),
      spawnCode: String(spawnCode).trim(),
      categories: cleanCategories,
      photoUrl: photoUrl ? String(photoUrl).trim() : '',
      createdAt: now,
      updatedAt: now,
    };
    await pool.query(
      `INSERT INTO cars (id, type, name, spawn_code, categories, photo_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [car.id, car.type, car.name, car.spawnCode, car.categories, car.photoUrl, now]
    );
    await registerCategories(type, cleanCategories);
    carsCache = [...carsCache, car];
    res.status(201).json(car);
  } catch (err) {
    next(err);
  }
});

app.put('/api/cars/:id', requireAuth, writeLimiter, async (req, res, next) => {
  try {
    const current = carsCache.find((c) => c.id === req.params.id);
    if (!current) return res.status(404).json({ error: 'Carro não encontrado' });

    const { name, spawnCode, categories, photoUrl } = req.body || {};
    if (photoUrl && !isValidPhotoUrl(String(photoUrl).trim())) {
      return res.status(400).json({ error: 'URL de foto inválida. Use um link https://.' });
    }
    let cleanCategories;
    if (categories !== undefined) {
      cleanCategories = normalizeCategoriesInput(categories);
      if (!cleanCategories) {
        return res.status(400).json({ error: 'Categorias inválidas' });
      }
    }

    const updated = { ...current };
    if (name !== undefined) updated.name = String(name).trim();
    if (spawnCode !== undefined) updated.spawnCode = String(spawnCode).trim();
    if (cleanCategories !== undefined) updated.categories = cleanCategories;
    if (photoUrl !== undefined) updated.photoUrl = String(photoUrl).trim();

    if (!updated.name || !updated.spawnCode || updated.categories.length === 0) {
      return res.status(400).json({ error: 'Nome, código e ao menos uma categoria são obrigatórios' });
    }
    if (updated.name.length > MAX_NAME_LENGTH || updated.spawnCode.length > MAX_SPAWN_CODE_LENGTH) {
      return res.status(400).json({ error: `Nome (máx. ${MAX_NAME_LENGTH}) ou código (máx. ${MAX_SPAWN_CODE_LENGTH}) muito longo` });
    }

    updated.updatedAt = new Date().toISOString();
    await pool.query(
      `UPDATE cars SET name = $1, spawn_code = $2, categories = $3, photo_url = $4, updated_at = $5
       WHERE id = $6`,
      [updated.name, updated.spawnCode, updated.categories, updated.photoUrl, updated.updatedAt, req.params.id]
    );
    if (cleanCategories) await registerCategories(current.type, cleanCategories);
    carsCache = carsCache.map((c) => (c.id === req.params.id ? updated : c));
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/cars/:id', requireAuth, writeLimiter, async (req, res, next) => {
  try {
    const exists = carsCache.some((c) => c.id === req.params.id);
    if (!exists) return res.status(404).json({ error: 'Carro não encontrado' });
    await pool.query('DELETE FROM cars WHERE id = $1', [req.params.id]);
    carsCache = carsCache.filter((c) => c.id !== req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Gera o backup em texto: nome == código de spawn, agrupado por categoria
// (mesmo formato das listas originais que o cliente usava antes do site).
function buildBackupText(type) {
  const cars = readCars(type);
  const blocks = [];
  for (const category of readCategoryNames(type)) {
    const inCategory = cars
      .filter((c) => c.categories.includes(category))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    if (inCategory.length === 0) continue;

    const nameWidth = Math.max(...inCategory.map((c) => c.name.length));
    const separator = '-'.repeat(nameWidth + 20);
    const lines = inCategory.map((c) => `${c.name.padEnd(nameWidth)} == ${c.spawnCode}`);
    blocks.push([category, separator, ...lines].join('\n'));
  }
  return blocks.join('\n\n');
}

app.get('/api/export', requireAuth, (req, res) => {
  const type = normalizeType(req.query.type) || 'veiculo';
  const filename = type === 'item' ? 'spawnfluxo-backup-itens.txt' : 'spawnfluxo-backup-veiculos.txt';
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buildBackupText(type));
});

// Handler de erro genérico (rotas assíncronas usam next(err) para cair aqui).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

async function main() {
  await seedIfEmpty();
  await loadCacheFromDb();
  await loadSiteConfigFromDb();
  loadIndexTemplate();
  app.listen(PORT, () => {
    console.log(`Spawnfluxo rodando em http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Falha ao iniciar o servidor:', err);
  process.exit(1);
});
