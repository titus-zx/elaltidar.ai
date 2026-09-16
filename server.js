import express from 'express';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

export const packages = {
  starter: { id: 'starter', name: 'GPT-4.1 Mini 10M', model: 'gpt-4.1-mini', maxBudget: 29000, durationDays: 3, quota: '10M tokens / 3 hari', price: 'Rp 29.000' },
  claude: { id: 'claude', name: 'Claude Haiku 3.5 10M', model: 'claude-3-5-haiku', maxBudget: 39000, durationDays: 3, quota: '10M tokens / 3 hari', price: 'Rp 39.000' },
  pro: { id: 'pro', name: 'Gemini 2.0 Flash 20M', model: 'gemini-2.0-flash', maxBudget: 25000, durationDays: 7, quota: '20M tokens / 7 hari', price: 'Rp 25.000' },
  scale: { id: 'scale', name: 'DeepSeek Chat 50M', model: 'deepseek-chat', maxBudget: 45000, durationDays: 7, quota: '50M tokens / 7 hari', price: 'Rp 45.000' },
  qwen: { id: 'qwen', name: 'Qwen Turbo 50M', model: 'qwen-turbo', maxBudget: 35000, durationDays: 7, quota: '50M tokens / 7 hari', price: 'Rp 35.000' },
};

function parseEnv(envText = '') {
  const parsed = {};
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    parsed[match[1]] = match[2].replace(/^[\'"]|[\'"]$/g, '');
  }
  return parsed;
}

export function loadConfig(envText = '') {
  const env = { ...process.env, ...parseEnv(envText) };
  return {
    apiPort: Number(env.API_PORT || 8787),
    litellmBaseUrl: (env.LITELLM_BASE_URL || 'https://litellm.xtrip.click').replace(/\/$/, ''),
    litellmMasterKey: env.LITELLM_MASTER_KEY || '',
    sessionCookieName: env.SESSION_COOKIE_NAME || 'elaltidar_session',
  };
}

function maskKey(key) {
  return key ? `${key.slice(0, 12)}....${key.slice(-4)}` : null;
}

function keyHash(key) {
  return createHash('sha256').update(key).digest('hex');
}

export function createStore({ file = './data/elaltidar.sqlite' } = {}) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );
    CREATE TABLE IF NOT EXISTS keys (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      public_key TEXT NOT NULL,
      package_id TEXT NOT NULL,
      litellm_key_alias TEXT,
      litellm_response TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      package_id TEXT NOT NULL,
      package_name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      paid_at TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );
  `);

  return {
    close() {
      db.close();
    },
    upsertCustomer(email) {
      const normalizedEmail = email.toLowerCase();
      const existing = db.prepare('SELECT id, email, created_at AS createdAt FROM customers WHERE email = ?').get(normalizedEmail);
      if (existing) return existing;
      const customer = { id: randomBytes(8).toString('hex'), email: normalizedEmail, createdAt: new Date().toISOString() };
      db.prepare('INSERT INTO customers (id, email, created_at) VALUES (?, ?, ?)').run(customer.id, customer.email, customer.createdAt);
      return customer;
    },
    createSession(customerId) {
      const session = { token: randomBytes(32).toString('hex'), customerId, createdAt: new Date().toISOString() };
      db.prepare('INSERT INTO sessions (token, customer_id, created_at) VALUES (?, ?, ?)').run(session.token, session.customerId, session.createdAt);
      return session;
    },
    customerByToken(token) {
      if (!token) return null;
      return db.prepare(`
        SELECT customers.id, customers.email, customers.created_at AS createdAt
        FROM sessions
        JOIN customers ON customers.id = sessions.customer_id
        WHERE sessions.token = ?
      `).get(token) || null;
    },
    saveKey(customerId, key, packageId, litellmResponse = {}) {
      const row = {
        id: randomBytes(8).toString('hex'),
        customerId,
        keyHash: keyHash(key),
        publicKey: maskKey(key),
        packageId,
        litellmKeyAlias: litellmResponse.key_alias || litellmResponse.key_name || null,
        litellmResponse: JSON.stringify(litellmResponse),
        createdAt: new Date().toISOString(),
      };
      db.prepare(`
        INSERT INTO keys (id, customer_id, key_hash, public_key, package_id, litellm_key_alias, litellm_response, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(row.id, row.customerId, row.keyHash, row.publicKey, row.packageId, row.litellmKeyAlias, row.litellmResponse, row.createdAt);
      return row;
    },
    createOrder(customerId, packageId) {
      const pkg = packages[packageId] || packages.starter;
      const row = { id: randomBytes(8).toString('hex'), customerId, packageId: pkg.id, packageName: pkg.name, amount: pkg.maxBudget, status: 'pending', createdAt: new Date().toISOString(), paidAt: null };
      db.prepare(`
        INSERT INTO orders (id, customer_id, package_id, package_name, amount, status, created_at, paid_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(row.id, row.customerId, row.packageId, row.packageName, row.amount, row.status, row.createdAt, row.paidAt);
      return row;
    },
    approveOrder(orderId) {
      const paidAt = new Date().toISOString();
      db.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ?").run(paidAt, orderId);
      return db.prepare(`
        SELECT id, customer_id AS customerId, package_id AS packageId, package_name AS packageName, amount, status, created_at AS createdAt, paid_at AS paidAt
        FROM orders WHERE id = ?
      `).get(orderId) || null;
    },
    dashboard(customer) {
      const latestKey = db.prepare(`
        SELECT id, customer_id AS customerId, public_key AS publicKey, package_id AS packageId, litellm_key_alias AS litellmKeyAlias, created_at AS createdAt
        FROM keys WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1
      `).get(customer.id) || null;
      const activePackage = db.prepare(`
        SELECT id, customer_id AS customerId, package_id AS packageId, package_name AS packageName, amount, status, created_at AS createdAt, paid_at AS paidAt
        FROM orders WHERE customer_id = ? AND status = 'paid' ORDER BY paid_at DESC LIMIT 1
      `).get(customer.id) || null;
      const orders = db.prepare(`
        SELECT id, customer_id AS customerId, package_id AS packageId, package_name AS packageName, amount, status, created_at AS createdAt, paid_at AS paidAt
        FROM orders WHERE customer_id = ? ORDER BY created_at DESC
      `).all(customer.id);
      return { customer, activePackage, latestKey, orders };
    },
  };
}

function getToken(req, body = {}) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  if (body.token) return body.token;
  return null;
}

async function readLiteLLMUsage({ config, latestKey, fetchImpl }) {
  if (!config.litellmMasterKey || !latestKey?.litellmKeyAlias) return null;
  const url = `${config.litellmBaseUrl}/key/info?key=${encodeURIComponent(latestKey.litellmKeyAlias)}`;
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${config.litellmMasterKey}` } });
  if (!res.ok) return null;
  return res.json();
}

export function createApiServer({ store = createStore(), config = loadConfig(), fetchImpl = fetch } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader('access-control-allow-origin', req.headers.origin || '*');
    res.setHeader('access-control-allow-headers', 'content-type,authorization');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).json({});
    next();
  });

  app.get('/health', (req, res) => res.json({ ok: true, gateway: `${config.litellmBaseUrl}/v1` }));

  app.get('/api/packages', (req, res) => res.json({ packages: Object.values(packages) }));

  app.post('/api/login', (req, res) => {
    if (!/^\S+@\S+\.\S+$/.test(req.body.email || '')) return res.status(400).json({ error: 'invalid_email' });
    const customer = store.upsertCustomer(req.body.email);
    const session = store.createSession(customer.id);
    return res.json({ token: session.token, customer });
  });

  app.get('/api/dashboard', async (req, res) => {
    const customer = store.customerByToken(getToken(req));
    if (!customer) return res.status(401).json({ error: 'unauthorized' });
    const dashboard = store.dashboard(customer);
    const usage = await readLiteLLMUsage({ config, latestKey: dashboard.latestKey, fetchImpl });
    return res.json({ ...dashboard, usage, gateway: { baseUrl: `${config.litellmBaseUrl}/v1` }, packages: Object.values(packages) });
  });

  app.post('/api/orders', (req, res) => {
    const customer = store.customerByToken(getToken(req, req.body));
    if (!customer) return res.status(401).json({ error: 'unauthorized' });
    return res.json({ order: store.createOrder(customer.id, req.body.packageId || 'starter') });
  });

  app.post('/api/orders/:orderId/approve', (req, res) => {
    const customer = store.customerByToken(getToken(req, req.body));
    if (!customer) return res.status(401).json({ error: 'unauthorized' });
    const order = store.approveOrder(req.params.orderId);
    if (!order || order.customerId !== customer.id) return res.status(404).json({ error: 'order_not_found' });
    return res.json({ order });
  });

  app.post('/api/keys', async (req, res) => {
    const customer = store.customerByToken(getToken(req, req.body));
    if (!customer) return res.status(401).json({ error: 'unauthorized' });
    if (!config.litellmMasterKey) return res.status(500).json({ error: 'missing_litellm_master_key' });

    const pkg = packages[req.body.packageId] || packages.starter;
    const keyAlias = `elaltidar-${customer.id}-${pkg.id}`;
    const llmRes = await fetchImpl(`${config.litellmBaseUrl}/key/generate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.litellmMasterKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        key_alias: keyAlias,
        key_name: keyAlias,
        max_budget: pkg.maxBudget,
        duration: `${pkg.durationDays}d`,
        metadata: { customer_id: customer.id, customer_email: customer.email, package_id: pkg.id, brand: 'ElaltidarAI' },
      }),
    });
    const payload = await llmRes.json();
    if (!llmRes.ok) return res.status(llmRes.status).json({ error: 'litellm_key_generate_failed', detail: payload });
    const key = payload.key || payload.token;
    if (!key) return res.status(502).json({ error: 'litellm_key_missing', detail: payload });
    const keyMeta = store.saveKey(customer.id, key, pkg.id, { ...payload, key_alias: keyAlias });
    return res.json({ key, keyMeta });
  });

  return app;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const envText = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '';
  const config = loadConfig(envText);
  const app = createApiServer({ store: createStore(), config });
  app.listen(config.apiPort, () => console.log(`Elaltidar API listening on http://localhost:${config.apiPort}`));
}
