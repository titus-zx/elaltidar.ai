import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash, createHmac } from 'node:crypto';
import { createApiServer, createStore, loadConfig } from '../server.js';

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function post(base, path, body) {
  return postWithHeaders(base, path, body);
}

async function postWithHeaders(base, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(base, path, token) {
  const res = await fetch(base + path, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

async function getWithHeaders(base, path, headers = {}) {
  const res = await fetch(base + path, { headers });
  return { status: res.status, body: await res.json() };
}

function telegramPayload(botToken, data) {
  const checkString = Object.keys(data).sort().map((key) => `${key}=${data[key]}`).join('\n');
  const secret = createHash('sha256').update(botToken).digest();
  return { ...data, hash: createHmac('sha256', secret).update(checkString).digest('hex') };
}

test('login creates customer session and dashboard returns member state', async () => {
  const store = createStore({ file: ':memory:' });
  const app = createApiServer({ store, config: { litellmBaseUrl: 'https://litellm.test', litellmMasterKey: 'test-key', allowDevLogin: true } });
  const server = await listen(app);
  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const login = await post(base, '/api/login', { email: 'titus@example.com' });
    assert.equal(login.status, 200);
    assert.match(login.body.token, /^[a-f0-9]{64}$/);

    const dashboard = await get(base, '/api/dashboard', login.body.token);
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.customer.email, 'titus@example.com');
    assert.equal(dashboard.body.gateway.baseUrl, 'https://litellm.test/v1');
  } finally {
    server.close();
    await once(server, 'close');
    store.close();
  }
});

test('create key calls LiteLLM admin API and stores returned key metadata', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ key: 'sk-live-test', token: 'sk-live-test', key_name: 'elaltidar-titus' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const store = createStore({ file: ':memory:' });
  const app = createApiServer({ store, fetchImpl: fakeFetch, config: { litellmBaseUrl: 'https://litellm.test', litellmMasterKey: 'master', allowDevLogin: true } });
  const server = await listen(app);
  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const login = await post(base, '/api/login', { email: 'titus@example.com' });
    const created = await post(base, '/api/keys', { token: login.body.token, packageId: 'starter' });

    assert.equal(created.status, 200);
    assert.equal(created.body.key, 'sk-live-test');
    assert.equal(calls[0].url, 'https://litellm.test/key/generate');
    assert.equal(calls[0].options.headers.authorization, 'Bearer master');
    assert.match(calls[0].options.body, /"max_budget":29000/);
  } finally {
    server.close();
    await once(server, 'close');
    store.close();
  }
});

test('config loader reads dotenv file without exposing secrets', () => {
  const config = loadConfig('LITELLM_BASE_URL=https://litellm.example\nLITELLM_MASTER_KEY=sk-test\n');
  assert.equal(config.litellmBaseUrl, 'https://litellm.example');
  assert.equal(config.litellmMasterKey, 'sk-test');
});

test('production config disables email login', async () => {
  const store = createStore({ file: ':memory:' });
  const app = createApiServer({ store, config: { litellmBaseUrl: 'https://litellm.test', litellmMasterKey: 'test-key', allowDevLogin: false } });
  const server = await listen(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = await post(base, '/api/login', { email: 'titus@example.com' });
    assert.equal(login.status, 403);
    assert.equal(login.body.error, 'dev_login_disabled');
  } finally {
    server.close();
    await once(server, 'close');
    store.close();
  }
});

test('telegram auth creates verified customer session', async () => {
  const botToken = 'telegram-test-token';
  const store = createStore({ file: ':memory:' });
  const app = createApiServer({ store, config: { litellmBaseUrl: 'https://litellm.test', litellmMasterKey: 'test-key', telegramBotToken: botToken, allowDevLogin: false } });
  const server = await listen(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const payload = telegramPayload(botToken, { id: 12345, first_name: 'Titus', username: 'titus_zx', auth_date: Math.floor(Date.now() / 1000) });
    const login = await post(base, '/api/auth/telegram', payload);
    assert.equal(login.status, 200);
    assert.match(login.body.token, /^[a-f0-9]{64}$/);
    assert.equal(login.body.customer.telegramId, '12345');
    assert.equal(login.body.customer.displayName, 'Titus');
  } finally {
    server.close();
    await once(server, 'close');
    store.close();
  }
});

test('admin token is required to approve orders', async () => {
  const store = createStore({ file: ':memory:' });
  const app = createApiServer({ store, config: { litellmBaseUrl: 'https://litellm.test', litellmMasterKey: 'test-key', allowDevLogin: true, adminToken: 'admin-secret' } });
  const server = await listen(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = await post(base, '/api/login', { email: 'titus@example.com' });
    const created = await postWithHeaders(base, '/api/orders', { packageId: 'starter' }, { authorization: `Bearer ${login.body.token}` });

    const rejected = await postWithHeaders(base, `/api/admin/orders/${created.body.order.id}/approve`, {}, { authorization: `Bearer ${login.body.token}` });
    assert.equal(rejected.status, 401);

    const approved = await postWithHeaders(base, `/api/admin/orders/${created.body.order.id}/approve`, {}, { 'x-admin-token': 'admin-secret' });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.order.status, 'paid');

    const allOrders = await getWithHeaders(base, '/api/admin/orders', { 'x-admin-token': 'admin-secret' });
    assert.equal(allOrders.status, 200);
    assert.equal(allOrders.body.orders[0].customer.email, 'titus@example.com');

    const pending = await getWithHeaders(base, '/api/admin/orders?status=pending', { 'x-admin-token': 'admin-secret' });
    assert.equal(pending.status, 200);
    assert.equal(pending.body.orders.length, 0);
  } finally {
    server.close();
    await once(server, 'close');
    store.close();
  }
});
