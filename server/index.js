import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import {
  COOKIE_NAME, cookieOptions, createSession, deleteSession,
  hashPassword, loadUser, requireAuth, verifyPassword,
} from './auth.js';

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

app.use(express.json());
app.use(loadUser);
app.use(express.static(publicDir));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Límite simple de intentos de login por IP (en memoria)
const attempts = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const entry = attempts.get(req.ip) || { count: 0, reset: now + 15 * 60 * 1000 };
  if (now > entry.reset) Object.assign(entry, { count: 0, reset: now + 15 * 60 * 1000 });
  entry.count++;
  attempts.set(req.ip, entry);
  if (entry.count > 10) {
    return res.status(429).json({ error: 'Demasiados intentos. Prueba más tarde.' });
  }
  next();
}

function startSession(res, userId) {
  const { token, expiresAt } = createSession(userId);
  res.cookie(COOKIE_NAME, token, cookieOptions(expiresAt));
}

app.post('/api/register', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Email no válido' });
  if (password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'Ese email ya está registrado' });

  const hash = await hashPassword(password);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name, email, hash);

  startSession(res, Number(lastInsertRowid));
  res.status(201).json({ ok: true });
});

app.post('/api/login', rateLimit, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  }

  attempts.delete(req.ip);
  startSession(res, user.id);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  if (req.sessionToken) deleteSession(req.sessionToken);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Limpieza periódica de sesiones expiradas
setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}, 60 * 60 * 1000).unref();

export { app };

// Solo arranca el servidor si se ejecuta directamente (no al importarlo en los tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`Servidor en http://localhost:${PORT}`);
  });
}
