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
  const app = createApiServer({ store, fetchImpl: fakeFetch, config: { litellmBaseUrl: 'https://litellm.test', litellmMasterKey: 'master', allowDevLogin: true, adminToken: 'admin-secret' } });
  const server = await listen(app);
  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const login = await post(base, '/api/login', { email: 'titus@example.com' });
  const order = await postWithHeaders(base, '/api/orders', { packageId: 'starter' }, { authorization: `Bearer ${login.body.token}` });
  await postWithHeaders(base, `/api/admin/orders/${order.body.order.id}/approve`, {}, { 'x-admin-token': 'admin-secret' });
    const created = await post(base, '/api/keys', { token: login.body.token, packageId: 'starter' });

    assert.equal(created.status, 200);
    assert.equal(created.body.key, 'sk-live-test');
    assert.equal(calls[0].url, 'https://litellm.test/key/generate');
    assert.equal(calls[0].options.headers.authorization, 'Bearer master');
    assert.match(calls[0].options.body, /"max_budget":29000/);
    assert.match(calls[0].options.body, /"models":\["gpt-4.1-mini"\]/);
  } finally {
    server.close();
    await once(server, 'close');
    store.close();
  }
});

test('key generation requires at least one active paid model entitlement', async () => {
  const store = createStore({ file: ':memory:' });
  const app = createApiServer({ store, config: { litellmBaseUrl: 'https://litellm.test', litellmMasterKey: 'master', allowDevLogin: true } });
  const server = await listen(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = await post(base, '/api/login', { email: 'titus@example.com' });
    const created = await post(base, '/api/keys', { token: login.body.token, packageId: 'starter' });
    assert.equal(created.status, 402);
    assert.equal(created.body.error, 'no_active_model_entitlement');
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

test('paid package entitlements appear in dashboard and v1 models for customer api key', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ key: 'sk-customer-models', key_name: 'elaltidar-titus' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const store = createStore({ file: ':memory:' });
  const app = createApiServer({ store, fetchImpl: fakeFetch, config: { litellmBaseUrl: 'https://litellm.test', litellmMasterKey: 'master', allowDevLogin: true, adminToken: 'admin-secret' } });
  const server = await listen(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = await post(base, '/api/login', { email: 'titus@example.com' });
    const starter = await postWithHeaders(base, '/api/orders', { packageId: 'starter' }, { authorization: `Bearer ${login.body.token}` });
    const pro = await postWithHeaders(base, '/api/orders', { packageId: 'pro' }, { authorization: `Bearer ${login.body.token}` });

    const approvedStarter = await postWithHeaders(base, `/api/admin/orders/${starter.body.order.id}/approve`, {}, { 'x-admin-token': 'admin-secret' });
    const approvedPro = await postWithHeaders(base, `/api/admin/orders/${pro.body.order.id}/approve`, {}, { 'x-admin-token': 'admin-secret' });
    assert.match(approvedStarter.body.order.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(approvedPro.body.order.expiresAt, /^\d{4}-\d{2}-\d{2}T/);

    const createdKey = await post(base, '/api/keys', { token: login.body.token, packageId: 'starter' });
    assert.equal(createdKey.status, 200);
    const keyBody = JSON.parse(calls[0].options.body);
    assert.deepEqual(keyBody.models.sort(), ['gemini-2.0-flash', 'gpt-4.1-mini']);

    const dashboard = await get(base, '/api/dashboard', login.body.token);
    assert.deepEqual(dashboard.body.availableModels.map((item) => item.id).sort(), ['gemini-2.0-flash', 'gpt-4.1-mini']);

    const models = await getWithHeaders(base, '/v1/models', { authorization: 'Bearer sk-customer-models' });
    assert.equal(models.status, 200);
    assert.equal(models.body.object, 'list');
    assert.deepEqual(models.body.data.map((item) => item.id).sort(), ['gemini-2.0-flash', 'gpt-4.1-mini']);
  } finally {
    server.close();
    await once(server, 'close');
    store.close();
  }
});

test('existing customer key is reused and synced when new model orders are approved', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/key/update')) {
      return new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ key: 'sk-one-customer-key', key_name: 'elaltidar-titus' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const store = createStore({ file: ':memory:' });
  const app = createApiServer({ store, fetchImpl: fakeFetch, config: { litellmBaseUrl: 'https://litellm.test', litellmMasterKey: 'master', allowDevLogin: true, adminToken: 'admin-secret' } });
  const server = await listen(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = await post(base, '/api/login', { email: 'titus@example.com' });
    const starter = await postWithHeaders(base, '/api/orders', { packageId: 'starter' }, { authorization: `Bearer ${login.body.token}` });
    await postWithHeaders(base, `/api/admin/orders/${starter.body.order.id}/approve`, {}, { 'x-admin-token': 'admin-secret' });

    const firstKey = await post(base, '/api/keys', { token: login.body.token });
    assert.equal(firstKey.status, 200);
    assert.equal(firstKey.body.key, 'sk-one-customer-key');

    const pro = await postWithHeaders(base, '/api/orders', { packageId: 'pro' }, { authorization: `Bearer ${login.body.token}` });
    const syncedApproval = await postWithHeaders(base, `/api/admin/orders/${pro.body.order.id}/approve`, {}, { 'x-admin-token': 'admin-secret' });
    assert.equal(syncedApproval.status, 200);
    assert.equal(syncedApproval.body.keySync.synced, true);

    const generateCalls = calls.filter((call) => call.url.endsWith('/key/generate'));
    const updateCalls = calls.filter((call) => call.url.endsWith('/key/update'));
    assert.equal(generateCalls.length, 1);
    assert.equal(updateCalls.length, 1);
    const updateBody = JSON.parse(updateCalls[0].options.body);
    assert.equal(updateBody.key, 'sk-one-customer-key');
    assert.deepEqual(updateBody.models.sort(), ['gemini-2.0-flash', 'gpt-4.1-mini']);

    const reused = await post(base, '/api/keys', { token: login.body.token });
    assert.equal(reused.status, 200);
    assert.equal(reused.body.key, null);
    assert.equal(reused.body.reused, true);
    assert.equal(reused.body.keyMeta.publicKey, 'sk-one-custo....-key');
    assert.equal(reused.body.keyMeta.litellmKey, undefined);
    assert.equal(calls.filter((call) => call.url.endsWith('/key/generate')).length, 1);
  } finally {
    server.close();
    await once(server, 'close');
    store.close();
  }
});

test('cron sync recomputes LiteLLM allowlists for existing customer keys', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/key/update')) {
      return new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ key: 'sk-cron-customer-key', key_name: 'elaltidar-titus' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const store = createStore({ file: ':memory:' });
  const app = createApiServer({ store, fetchImpl: fakeFetch, config: { litellmBaseUrl: 'https://litellm.test', litellmMasterKey: 'master', allowDevLogin: true, adminToken: 'admin-secret', cronSecret: 'cron-secret' } });
  const server = await listen(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = await post(base, '/api/login', { email: 'titus@example.com' });
    const starter = await postWithHeaders(base, '/api/orders', { packageId: 'starter' }, { authorization: `Bearer ${login.body.token}` });
    await postWithHeaders(base, `/api/admin/orders/${starter.body.order.id}/approve`, {}, { 'x-admin-token': 'admin-secret' });
    await post(base, '/api/keys', { token: login.body.token });

    const rejected = await getWithHeaders(base, '/api/cron/sync-expired-entitlements', { authorization: 'Bearer wrong' });
    assert.equal(rejected.status, 401);

    const synced = await getWithHeaders(base, '/api/cron/sync-expired-entitlements', { authorization: 'Bearer cron-secret' });
    assert.equal(synced.status, 200);
    assert.equal(synced.body.checked, 1);
    assert.equal(synced.body.synced, 1);

    const adminSynced = await postWithHeaders(base, '/api/admin/sync-keys', {}, { 'x-admin-token': 'admin-secret' });
    assert.equal(adminSynced.status, 200);
    assert.equal(adminSynced.body.checked, 1);

    const updateCalls = calls.filter((call) => call.url.endsWith('/key/update'));
    assert.equal(updateCalls.length, 2);
    const cronUpdateBody = JSON.parse(updateCalls[0].options.body);
    assert.equal(cronUpdateBody.key, 'sk-cron-customer-key');
    assert.deepEqual(cronUpdateBody.models, ['gpt-4.1-mini']);
  } finally {
    server.close();
    await once(server, 'close');
    store.close();
  }
});
