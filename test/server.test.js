import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApiServer, createStore, loadConfig } from '../server.js';

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function post(base, path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(base, path, token) {
  const res = await fetch(base + path, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

test('login creates customer session and dashboard returns member state', async () => {
  const store = createStore({ file: ':memory:' });
  const app = createApiServer({ store, config: { litellmBaseUrl: 'https://litellm.test', litellmMasterKey: 'test-key' } });
  const server = await listen(app);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const login = await post(base, '/api/login', { email: 'titus@example.com' });
  assert.equal(login.status, 200);
  assert.match(login.body.token, /^[a-f0-9]{64}$/);

  const dashboard = await get(base, '/api/dashboard', login.body.token);
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.customer.email, 'titus@example.com');
  assert.equal(dashboard.body.gateway.baseUrl, 'https://litellm.test/v1');

  server.close();
  await once(server, 'close');
  store.close();
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
  const app = createApiServer({ store, fetchImpl: fakeFetch, config: { litellmBaseUrl: 'https://litellm.test', litellmMasterKey: 'master' } });
  const server = await listen(app);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const login = await post(base, '/api/login', { email: 'titus@example.com' });
  const created = await post(base, '/api/keys', { token: login.body.token, packageId: 'starter' });

  assert.equal(created.status, 200);
  assert.equal(created.body.key, 'sk-live-test');
  assert.equal(calls[0].url, 'https://litellm.test/key/generate');
  assert.equal(calls[0].options.headers.authorization, 'Bearer master');
  assert.match(calls[0].options.body, /"max_budget":29000/);

  server.close();
  await once(server, 'close');
  store.close();
});

test('config loader reads dotenv file without exposing secrets', () => {
  const config = loadConfig('LITELLM_BASE_URL=https://litellm.example\nLITELLM_MASTER_KEY=sk-test\n');
  assert.equal(config.litellmBaseUrl, 'https://litellm.example');
  assert.equal(config.litellmMasterKey, 'sk-test');
});
