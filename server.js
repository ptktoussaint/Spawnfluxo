require('dotenv').config({ quiet: true });
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

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

// ----- Firebase (Firestore) -----
// Os dados dos veículos ficam no Firestore em vez de disco local, porque a
// hospedagem gratuita (Render free tier) não oferece disco persistente.
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  console.error(
    'Faltam variáveis de ambiente do Firebase (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, ' +
    'FIREBASE_PRIVATE_KEY). Veja o README para instruções de configuração.'
  );
  process.exit(1);
}

const firebaseApp = initializeApp({
  credential: cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY,
  }),
});

const db = getFirestore(firebaseApp);
const carsCollection = db.collection('cars');
const categoriesCollection = db.collection('categories');

function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // remove acentos
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}

// Aceita tanto o formato antigo (category: string) quanto o novo
// (categories: string[]), para não quebrar documentos já existentes no Firestore.
function normalizeCarDoc(id, data) {
  const { category, categories, ...rest } = data;
  const list = Array.isArray(categories)
    ? categories.filter(Boolean)
    : category
      ? [category]
      : [];
  return { id, ...rest, categories: list };
}

function normalizeCategoriesInput(categories) {
  if (!Array.isArray(categories)) return null;
  return [...new Set(categories.map((c) => String(c).trim()).filter(Boolean))];
}

async function readCars() {
  const snapshot = await carsCollection.get();
  return snapshot.docs.map((doc) => normalizeCarDoc(doc.id, doc.data()));
}

async function registerCategories(names) {
  const writes = names.map((name) => {
    const slug = slugify(name);
    if (!slug) return Promise.resolve();
    return categoriesCollection.doc(slug).set({ name, updatedAt: new Date().toISOString() }, { merge: true });
  });
  await Promise.all(writes);
}

// Lê só a coleção "categories" (poucos documentos), sem reler todos os
// carros: toda categoria usada por algum carro já foi registrada ali por
// registerCategories() (seja no seed inicial ou em cada criação/edição),
// então não precisamos pagar o custo de reler a coleção "cars" inteira
// só para montar essa lista — economiza cota de leitura do Firestore.
async function readCategoryNames() {
  const catSnap = await categoriesCollection.get();
  const names = catSnap.docs.map((d) => d.data().name).filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

async function seedIfEmpty() {
  const existing = await carsCollection.limit(1).get();
  if (!existing.empty) return;
  if (!fs.existsSync(SEED_FILE)) return;

  const seedCars = JSON.parse(fs.readFileSync(SEED_FILE, 'utf-8'));
  const commits = [];
  let batch = db.batch();
  let opCount = 0;

  for (const car of seedCars) {
    const { id, category, ...data } = car;
    batch.set(carsCollection.doc(id), { ...data, categories: category ? [category] : [] });
    opCount += 1;
    if (opCount === 450) { // limite de 500 operações por batch no Firestore
      commits.push(batch.commit());
      batch = db.batch();
      opCount = 0;
    }
  }
  if (opCount > 0) commits.push(batch.commit());

  await Promise.all(commits);
  await registerCategories([...new Set(seedCars.map((c) => c.category).filter(Boolean))]);
  console.log(`Firestore semeado com ${seedCars.length} veículos a partir de data/seed-cars.json.`);
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

app.get('/api/cars', async (req, res, next) => {
  try {
    const { q = '', category = '' } = req.query;
    let cars = await readCars();
    const term = String(q).trim().toLowerCase();
    if (term) {
      cars = cars.filter(
        (c) => c.name.toLowerCase().includes(term) || c.categories.some((cat) => cat.toLowerCase().includes(term))
      );
    }
    if (category) {
      cars = cars.filter((c) => c.categories.includes(category));
    }
    cars.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    res.json(cars);
  } catch (err) {
    next(err);
  }
});

app.get('/api/categories', async (req, res, next) => {
  try {
    res.json(await readCategoryNames());
  } catch (err) {
    next(err);
  }
});

// Criação explícita de categoria, mesmo sem nenhum carro usando-a ainda.
app.post('/api/categories', requireAuth, async (req, res, next) => {
  try {
    const { name } = req.body || {};
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) return res.status(400).json({ error: 'Nome da categoria é obrigatório' });
    const slug = slugify(trimmed);
    if (!slug) return res.status(400).json({ error: 'Nome de categoria inválido' });
    await categoriesCollection.doc(slug).set({ name: trimmed, updatedAt: new Date().toISOString() }, { merge: true });
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
    const data = {
      name: String(name).trim(),
      spawnCode: String(spawnCode).trim(),
      categories: cleanCategories,
      photoUrl: photoUrl ? String(photoUrl).trim() : '',
      createdAt: now,
      updatedAt: now,
    };
    await carsCollection.doc(id).set(data);
    await registerCategories(cleanCategories);
    res.status(201).json({ id, ...data });
  } catch (err) {
    next(err);
  }
});

app.put('/api/cars/:id', requireAuth, async (req, res, next) => {
  try {
    const ref = carsCollection.doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Carro não encontrado' });

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

    const current = normalizeCarDoc(req.params.id, snap.data());
    const updated = { ...current };
    delete updated.id;
    if (name !== undefined) updated.name = String(name).trim();
    if (spawnCode !== undefined) updated.spawnCode = String(spawnCode).trim();
    if (cleanCategories !== undefined) updated.categories = cleanCategories;
    if (photoUrl !== undefined) updated.photoUrl = String(photoUrl).trim();

    if (!updated.name || !updated.spawnCode || updated.categories.length === 0) {
      return res.status(400).json({ error: 'Nome, código e ao menos uma categoria são obrigatórios' });
    }

    updated.updatedAt = new Date().toISOString();
    await ref.set(updated);
    if (cleanCategories) await registerCategories(cleanCategories);
    res.json({ id: req.params.id, ...updated });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/cars/:id', requireAuth, async (req, res, next) => {
  try {
    const ref = carsCollection.doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Carro não encontrado' });
    await ref.delete();
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
  app.listen(PORT, () => {
    console.log(`Spawnfluxo rodando em http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Falha ao iniciar o servidor:', err);
  process.exit(1);
});
