import express from 'express';
import Database from 'better-sqlite3';
import pg from 'pg';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

const { Pool } = pg;

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
    storeFile: env.STORE_FILE || (env.VERCEL ? '/tmp/elaltidar.sqlite' : './data/elaltidar.sqlite'),
    databaseUrl: env.DATABASE_URL || env.POSTGRES_URL || '',
  };
}

function maskKey(key) {
  return key ? `${key.slice(0, 12)}....${key.slice(-4)}` : null;
}

function keyHash(key) {
  return createHash('sha256').update(key).digest('hex');
}

function mapCustomer(row) {
  return row ? { id: row.id, email: row.email, createdAt: row.created_at || row.createdAt } : null;
}

function mapOrder(row) {
  return row ? {
    id: row.id,
    customerId: row.customer_id || row.customerId,
    packageId: row.package_id || row.packageId,
    packageName: row.package_name || row.packageName,
    amount: row.amount,
    status: row.status,
    createdAt: row.created_at || row.createdAt,
    paidAt: row.paid_at || row.paidAt,
  } : null;
}

function mapKey(row) {
  return row ? {
    id: row.id,
    customerId: row.customer_id || row.customerId,
    publicKey: row.public_key || row.publicKey,
    packageId: row.package_id || row.packageId,
    litellmKeyAlias: row.litellm_key_alias || row.litellmKeyAlias,
    createdAt: row.created_at || row.createdAt,
  } : null;
}

function createPostgresStore(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false } });
  let ready;
  const ensureReady = () => {
    ready ||= pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id),
        key_hash TEXT NOT NULL,
        public_key TEXT NOT NULL,
        package_id TEXT NOT NULL,
        litellm_key_alias TEXT,
        litellm_response JSONB,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id),
        package_id TEXT NOT NULL,
        package_name TEXT NOT NULL,
        amount INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        paid_at TEXT
      );
    `);
    return ready;
  };

  return {
    async close() {
      await pool.end();
    },
    async upsertCustomer(email) {
      await ensureReady();
      const normalizedEmail = email.toLowerCase();
      const existing = await pool.query('SELECT id, email, created_at FROM customers WHERE email = $1', [normalizedEmail]);
      if (existing.rows[0]) return mapCustomer(existing.rows[0]);
      const customer = { id: randomBytes(8).toString('hex'), email: normalizedEmail, createdAt: new Date().toISOString() };
      await pool.query('INSERT INTO customers (id, email, created_at) VALUES ($1, $2, $3)', [customer.id, customer.email, customer.createdAt]);
      return customer;
    },
    async createSession(customerId) {
      await ensureReady();
      const session = { token: randomBytes(32).toString('hex'), customerId, createdAt: new Date().toISOString() };
      await pool.query('INSERT INTO sessions (token, customer_id, created_at) VALUES ($1, $2, $3)', [session.token, session.customerId, session.createdAt]);
      return session;
    },
    async customerByToken(token) {
      await ensureReady();
      if (!token) return null;
      const result = await pool.query(`
        SELECT customers.id, customers.email, customers.created_at
        FROM sessions
        JOIN customers ON customers.id = sessions.customer_id
        WHERE sessions.token = $1
      `, [token]);
      return mapCustomer(result.rows[0]);
    },
    async saveKey(customerId, key, packageId, litellmResponse = {}) {
      await ensureReady();
      const row = {
        id: randomBytes(8).toString('hex'),
        customerId,
        keyHash: keyHash(key),
        publicKey: maskKey(key),
        packageId,
        litellmKeyAlias: litellmResponse.key_alias || litellmResponse.key_name || null,
        litellmResponse,
        createdAt: new Date().toISOString(),
      };
      await pool.query(`
        INSERT INTO api_keys (id, customer_id, key_hash, public_key, package_id, litellm_key_alias, litellm_response, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [row.id, row.customerId, row.keyHash, row.publicKey, row.packageId, row.litellmKeyAlias, row.litellmResponse, row.createdAt]);
      return row;
    },
    async createOrder(customerId, packageId) {
      await ensureReady();
      const pkg = packages[packageId] || packages.starter;
      const row = { id: randomBytes(8).toString('hex'), customerId, packageId: pkg.id, packageName: pkg.name, amount: pkg.maxBudget, status: 'pending', createdAt: new Date().toISOString(), paidAt: null };
      await pool.query(`
        INSERT INTO orders (id, customer_id, package_id, package_name, amount, status, created_at, paid_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [row.id, row.customerId, row.packageId, row.packageName, row.amount, row.status, row.createdAt, row.paidAt]);
      return row;
    },
    async approveOrder(orderId) {
      await ensureReady();
      const paidAt = new Date().toISOString();
      const result = await pool.query(`
        UPDATE orders SET status = 'paid', paid_at = $1 WHERE id = $2
        RETURNING id, customer_id, package_id, package_name, amount, status, created_at, paid_at
      `, [paidAt, orderId]);
      return mapOrder(result.rows[0]);
    },
    async dashboard(customer) {
      await ensureReady();
      const latestKey = await pool.query(`
        SELECT id, customer_id, public_key, package_id, litellm_key_alias, created_at
        FROM api_keys WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1
      `, [customer.id]);
      const activePackage = await pool.query(`
        SELECT id, customer_id, package_id, package_name, amount, status, created_at, paid_at
        FROM orders WHERE customer_id = $1 AND status = 'paid' ORDER BY paid_at DESC LIMIT 1
      `, [customer.id]);
      const orders = await pool.query(`
        SELECT id, customer_id, package_id, package_name, amount, status, created_at, paid_at
        FROM orders WHERE customer_id = $1 ORDER BY created_at DESC
      `, [customer.id]);
      return { customer, activePackage: mapOrder(activePackage.rows[0]), latestKey: mapKey(latestKey.rows[0]), orders: orders.rows.map(mapOrder) };
    },
  };
}

function createSqliteStore(file) {
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
      return { customer, activePackage: mapOrder(activePackage), latestKey: mapKey(latestKey), orders: orders.map(mapOrder) };
    },
  };
}

export function createStore({ file = './data/elaltidar.sqlite', databaseUrl = '' } = {}) {
  return databaseUrl ? createPostgresStore(databaseUrl) : createSqliteStore(file);
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

export function createApiServer({ store, config = loadConfig(), fetchImpl = fetch } = {}) {
  const appStore = store || createStore({ file: config.storeFile, databaseUrl: config.databaseUrl });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader('access-control-allow-origin', req.headers.origin || '*');
    res.setHeader('access-control-allow-headers', 'content-type,authorization');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).json({});
    next();
  });

  const health = (req, res) => res.json({ ok: true, gateway: `${config.litellmBaseUrl}/v1` });
  app.get('/health', health);
  app.get('/api/health', health);

  app.get('/api/packages', (req, res) => res.json({ packages: Object.values(packages) }));

  app.post('/api/login', async (req, res) => {
    if (!/^\S+@\S+\.\S+$/.test(req.body.email || '')) return res.status(400).json({ error: 'invalid_email' });
    const customer = await appStore.upsertCustomer(req.body.email);
    const session = await appStore.createSession(customer.id);
    return res.json({ token: session.token, customer });
  });

  app.get('/api/dashboard', async (req, res) => {
    const customer = await appStore.customerByToken(getToken(req));
    if (!customer) return res.status(401).json({ error: 'unauthorized' });
    const dashboard = await appStore.dashboard(customer);
    const usage = await readLiteLLMUsage({ config, latestKey: dashboard.latestKey, fetchImpl });
    return res.json({ ...dashboard, usage, gateway: { baseUrl: `${config.litellmBaseUrl}/v1` }, packages: Object.values(packages) });
  });

  app.post('/api/orders', async (req, res) => {
    const customer = await appStore.customerByToken(getToken(req, req.body));
    if (!customer) return res.status(401).json({ error: 'unauthorized' });
    return res.json({ order: await appStore.createOrder(customer.id, req.body.packageId || 'starter') });
  });

  app.post('/api/orders/:orderId/approve', async (req, res) => {
    const customer = await appStore.customerByToken(getToken(req, req.body));
    if (!customer) return res.status(401).json({ error: 'unauthorized' });
    const order = await appStore.approveOrder(req.params.orderId);
    if (!order || order.customerId !== customer.id) return res.status(404).json({ error: 'order_not_found' });
    return res.json({ order });
  });

  app.post('/api/keys', async (req, res) => {
    const customer = await appStore.customerByToken(getToken(req, req.body));
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
    const keyMeta = await appStore.saveKey(customer.id, key, pkg.id, { ...payload, key_alias: keyAlias });
    return res.json({ key, keyMeta });
  });

  return app;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const envText = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '';
  const config = loadConfig(envText);
  const app = createApiServer({ store: createStore({ file: config.storeFile, databaseUrl: config.databaseUrl }), config });
  app.listen(config.apiPort, () => console.log(`Elaltidar API listening on http://localhost:${config.apiPort}`));
}
