const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATA_FILE = path.join(__dirname, 'data', 'cars.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h de sessão

if (ADMIN_PASSWORD === 'admin123' || ADMIN_PASSWORD.length < 8) {
  console.warn(
    '[AVISO DE SEGURANÇA] ADMIN_PASSWORD está fraca ou usando o valor padrão. ' +
    'Defina uma senha forte na variável de ambiente ADMIN_PASSWORD antes de expor este servidor publicamente.'
  );
}

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

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

function readCars() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function writeCars(cars) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(cars, null, 2));
}

function isValidPhotoUrl(url) {
  if (!url) return true; // foto é opcional
  return /^https:\/\/[^\s]+$/i.test(url) || /^\/uploads\/[A-Za-z0-9._-]+$/.test(url);
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
      imgSrc: ["'self'", 'https:', 'data:'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomUUID() + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Formato de imagem inválido'));
  },
});

// ----- Endpoints públicos (somente leitura) -----

app.get('/api/cars', (req, res) => {
  const { q = '', category = '' } = req.query;
  let cars = readCars();
  const term = String(q).trim().toLowerCase();
  if (term) {
    cars = cars.filter(
      (c) => c.name.toLowerCase().includes(term) || c.category.toLowerCase().includes(term)
    );
  }
  if (category) {
    cars = cars.filter((c) => c.category === category);
  }
  cars.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  res.json(cars);
});

app.get('/api/categories', (req, res) => {
  const cars = readCars();
  const set = new Set(cars.map((c) => c.category).filter(Boolean));
  res.json([...set].sort((a, b) => a.localeCompare(b, 'pt-BR')));
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

app.post('/api/cars', requireAuth, (req, res) => {
  const { name, spawnCode, category, photoUrl } = req.body || {};
  if (!name || !spawnCode || !category) {
    return res.status(400).json({ error: 'Nome, código e categoria são obrigatórios' });
  }
  if (photoUrl && !isValidPhotoUrl(photoUrl)) {
    return res.status(400).json({ error: 'URL de foto inválida. Use https:// ou uma foto enviada pelo formulário.' });
  }
  const cars = readCars();
  const now = new Date().toISOString();
  const car = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    spawnCode: String(spawnCode).trim(),
    category: String(category).trim(),
    photoUrl: photoUrl ? String(photoUrl).trim() : '',
    createdAt: now,
    updatedAt: now,
  };
  cars.push(car);
  writeCars(cars);
  res.status(201).json(car);
});

app.put('/api/cars/:id', requireAuth, (req, res) => {
  const cars = readCars();
  const idx = cars.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Carro não encontrado' });

  const { name, spawnCode, category, photoUrl } = req.body || {};
  if (photoUrl && !isValidPhotoUrl(String(photoUrl).trim())) {
    return res.status(400).json({ error: 'URL de foto inválida. Use https:// ou uma foto enviada pelo formulário.' });
  }
  const car = cars[idx];
  if (name !== undefined) car.name = String(name).trim();
  if (spawnCode !== undefined) car.spawnCode = String(spawnCode).trim();
  if (category !== undefined) car.category = String(category).trim();
  if (photoUrl !== undefined) car.photoUrl = String(photoUrl).trim();

  if (!car.name || !car.spawnCode || !car.category) {
    return res.status(400).json({ error: 'Nome, código e categoria são obrigatórios' });
  }

  car.updatedAt = new Date().toISOString();
  cars[idx] = car;
  writeCars(cars);
  res.json(car);
});

app.delete('/api/cars/:id', requireAuth, (req, res) => {
  const cars = readCars();
  const exists = cars.some((c) => c.id === req.params.id);
  if (!exists) return res.status(404).json({ error: 'Carro não encontrado' });
  writeCars(cars.filter((c) => c.id !== req.params.id));
  res.json({ ok: true });
});

app.post('/api/upload', requireAuth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  res.json({ url: '/uploads/' + req.file.filename });
});

// Tratamento de erros do multer (ex: arquivo grande demais, formato invalido)
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || 'Erro no upload' });
  next();
});

app.listen(PORT, () => {
  console.log(`Spawnfluxo rodando em http://localhost:${PORT}`);
});
