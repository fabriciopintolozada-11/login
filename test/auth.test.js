import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

// BD en memoria: los tests no tocan data/app.db
process.env.DB_PATH = ':memory:';

const { app } = await import('../server/index.js');
const { hashPassword, verifyPassword } = await import('../server/auth.js');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function post(path, body, cookie) {
  return fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
    body: JSON.stringify(body),
  });
}

function sessionCookie(res) {
  return res.headers.get('set-cookie')?.split(';')[0];
}

describe('hashPassword / verifyPassword', () => {
  test('acepta la contraseña correcta', async () => {
    const hash = await hashPassword('secreto123');
    assert.equal(await verifyPassword('secreto123', hash), true);
  });

  test('rechaza una contraseña incorrecta', async () => {
    const hash = await hashPassword('secreto123');
    assert.equal(await verifyPassword('otra-cosa', hash), false);
  });

  test('usa un salt distinto en cada hash', async () => {
    assert.notEqual(await hashPassword('igual'), await hashPassword('igual'));
  });
});

describe('API', () => {
  const user = { name: 'Ana', email: 'ana@example.com', password: 'password123' };

  test('POST /api/register valida los datos', async () => {
    let res = await post('/api/register', { ...user, name: '' });
    assert.equal(res.status, 400);
    res = await post('/api/register', { ...user, email: 'no-es-email' });
    assert.equal(res.status, 400);
    res = await post('/api/register', { ...user, password: 'corta' });
    assert.equal(res.status, 400);
  });

  test('POST /api/register crea el usuario y abre sesión', async () => {
    const res = await post('/api/register', user);
    assert.equal(res.status, 201);
    assert.match(sessionCookie(res), /^sid=/);
  });

  test('POST /api/register rechaza un email duplicado', async () => {
    const res = await post('/api/register', { ...user, email: 'ANA@example.com' });
    assert.equal(res.status, 409);
  });

  test('GET /api/me sin sesión devuelve 401', async () => {
    const res = await fetch(`${baseUrl}/api/me`);
    assert.equal(res.status, 401);
  });

  test('login, /api/me y logout', async () => {
    const login = await post('/api/login', { email: user.email, password: user.password });
    assert.equal(login.status, 200);
    const cookie = sessionCookie(login);

    const me = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
    assert.equal(me.status, 200);
    const { user: data } = await me.json();
    assert.equal(data.email, user.email);
    assert.equal(data.password_hash, undefined);

    await post('/api/logout', {}, cookie);
    const after = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
    assert.equal(after.status, 401);
  });

  test('POST /api/login con contraseña incorrecta devuelve 401', async () => {
    const res = await post('/api/login', { email: user.email, password: 'incorrecta' });
    assert.equal(res.status, 401);
  });

  test('POST /api/login bloquea tras demasiados intentos', async () => {
    let res;
    for (let i = 0; i < 11; i++) {
      res = await post('/api/login', { email: user.email, password: 'incorrecta' });
    }
    assert.equal(res.status, 429);
  });
});
