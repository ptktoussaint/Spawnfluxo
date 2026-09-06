require('dotenv').config({ quiet: true });
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h de sessão
const SEED_FILE = path.join(__dirname, 'data', 'seed-cars.json');

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
    name: row.name,
    spawnCode: row.spawn_code,
    categories: row.categories || [],
    photoUrl: row.photo_url || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeCategoriesInput(categories) {
  if (!Array.isArray(categories)) return null;
  return [...new Set(categories.map((c) => String(c).trim()).filter(Boolean))];
}

// ----- Cache em memória -----
// Bancos gerenciados costumam cobrar ou limitar por operação/tráfego. Para
// não depender do número de acessos ao site, os dados ficam em memória e o
// banco só é lido uma vez (na inicialização do servidor) e escrito a cada
// alteração do admin — nunca lido de novo a cada requisição pública.
let carsCache = [];
let categoriesCache = [];

function sortCategoryNames(names) {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function addCategoriesToCache(names) {
  categoriesCache = sortCategoryNames([...categoriesCache, ...names]);
}

async function loadCacheFromDb() {
  const [carsResult, catResult] = await Promise.all([
    pool.query('SELECT * FROM cars'),
    pool.query('SELECT * FROM categories'),
  ]);
  carsCache = carsResult.rows.map(rowToCar);
  categoriesCache = sortCategoryNames(catResult.rows.map((r) => r.name).filter(Boolean));
  console.log(`Cache carregado do banco: ${carsCache.length} veículos, ${categoriesCache.length} categorias.`);
}

function readCars() {
  return carsCache;
}

function readCategoryNames() {
  return categoriesCache;
}

async function registerCategories(names) {
  for (const name of names) {
    const slug = slugify(name);
    if (!slug) continue;
    await pool.query(
      `INSERT INTO categories (slug, name, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
      [slug, name]
    );
  }
  addCategoriesToCache(names);
}

async function seedIfEmpty() {
  const { rows } = await pool.query('SELECT 1 FROM cars LIMIT 1');
  if (rows.length > 0) return;
  if (!fs.existsSync(SEED_FILE)) return;

  const seedCars = JSON.parse(fs.readFileSync(SEED_FILE, 'utf-8'));
  if (seedCars.length === 0) return;

  const values = [];
  const placeholders = seedCars.map((car, i) => {
    const base = i * 7;
    values.push(
      car.id,
      car.name,
      car.spawnCode,
      car.category ? [car.category] : [],
      car.photoUrl || '',
      car.createdAt,
      car.updatedAt
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
  });

  await pool.query(
    `INSERT INTO cars (id, name, spawn_code, categories, photo_url, created_at, updated_at)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (id) DO NOTHING`,
    values
  );

  await registerCategories([...new Set(seedCars.map((c) => c.category).filter(Boolean))]);
  console.log(`Banco semeado com ${seedCars.length} veículos a partir de data/seed-cars.json.`);
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
  return /^https:\/\/[^\s]+$/i.test(url);
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

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente mais tarde.' },
});

const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', apiLimiter);
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ----- Endpoints públicos (somente leitura) -----

app.get('/api/cars', (req, res) => {
  const { q = '', category = '' } = req.query;
  let cars = readCars();
  const term = String(q).trim().toLowerCase();
  if (term) {
    cars = cars.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        c.spawnCode.toLowerCase().includes(term) ||
        c.categories.some((cat) => cat.toLowerCase().includes(term))
    );
  }
  if (category) {
    cars = cars.filter((c) => c.categories.includes(category));
  }
  cars = [...cars].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  res.json(cars);
});

app.get('/api/categories', (req, res) => {
  res.json(readCategoryNames());
});

// Criação explícita de categoria, mesmo sem nenhum carro usando-a ainda.
app.post('/api/categories', requireAuth, async (req, res, next) => {
  try {
    const { name } = req.body || {};
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) return res.status(400).json({ error: 'Nome da categoria é obrigatório' });
    const slug = slugify(trimmed);
    if (!slug) return res.status(400).json({ error: 'Nome de categoria inválido' });
    await pool.query(
      `INSERT INTO categories (slug, name, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
      [slug, trimmed]
    );
    addCategoriesToCache([trimmed]);
    res.status(201).json({ name: trimmed });
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

app.post('/api/cars', requireAuth, async (req, res, next) => {
  try {
    const { name, spawnCode, categories, photoUrl } = req.body || {};
    const cleanCategories = normalizeCategoriesInput(categories);
    if (!name || !spawnCode || !cleanCategories || cleanCategories.length === 0) {
      return res.status(400).json({ error: 'Nome, código e ao menos uma categoria são obrigatórios' });
    }
    if (photoUrl && !isValidPhotoUrl(photoUrl)) {
      return res.status(400).json({ error: 'URL de foto inválida. Use um link https://.' });
    }
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const car = {
      id,
      name: String(name).trim(),
      spawnCode: String(spawnCode).trim(),
      categories: cleanCategories,
      photoUrl: photoUrl ? String(photoUrl).trim() : '',
      createdAt: now,
      updatedAt: now,
    };
    await pool.query(
      `INSERT INTO cars (id, name, spawn_code, categories, photo_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [car.id, car.name, car.spawnCode, car.categories, car.photoUrl, now]
    );
    await registerCategories(cleanCategories);
    carsCache = [...carsCache, car];
    res.status(201).json(car);
  } catch (err) {
    next(err);
  }
});

app.put('/api/cars/:id', requireAuth, async (req, res, next) => {
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

    updated.updatedAt = new Date().toISOString();
    await pool.query(
      `UPDATE cars SET name = $1, spawn_code = $2, categories = $3, photo_url = $4, updated_at = $5
       WHERE id = $6`,
      [updated.name, updated.spawnCode, updated.categories, updated.photoUrl, updated.updatedAt, req.params.id]
    );
    if (cleanCategories) await registerCategories(cleanCategories);
    carsCache = carsCache.map((c) => (c.id === req.params.id ? updated : c));
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/cars/:id', requireAuth, async (req, res, next) => {
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

// Handler de erro genérico (rotas assíncronas usam next(err) para cair aqui).
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

async function main() {
  await seedIfEmpty();
  await loadCacheFromDb();
  app.listen(PORT, () => {
    console.log(`Spawnfluxo rodando em http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Falha ao iniciar o servidor:', err);
  process.exit(1);
});
