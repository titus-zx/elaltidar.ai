import express from 'express';
import Database from 'better-sqlite3';
import pg from 'pg';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';

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
    adminToken: env.ADMIN_TOKEN || '',
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || '',
    telegramBotUsername: env.TELEGRAM_BOT_USERNAME || '',
    allowDevLogin: env.ALLOW_DEV_LOGIN === 'true' || (!env.VERCEL && env.NODE_ENV !== 'production'),
  };
}

function maskKey(key) {
  return key ? `${key.slice(0, 12)}....${key.slice(-4)}` : null;
}

function keyHash(key) {
  return createHash('sha256').update(key).digest('hex');
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function mapCustomer(row) {
  return row ? {
    id: row.id,
    email: row.email,
    displayName: row.display_name || row.displayName || row.email,
    telegramId: row.telegram_id || row.telegramId || null,
    telegramUsername: row.telegram_username || row.telegramUsername || null,
    createdAt: row.created_at || row.createdAt,
  } : null;
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
    expiresAt: row.expires_at || row.expiresAt || null,
    customer: row.customer_email || row.customerEmail ? {
      id: row.customer_id || row.customerId,
      email: row.customer_email || row.customerEmail,
      displayName: row.customer_display_name || row.customerDisplayName || row.customer_email || row.customerEmail,
      telegramUsername: row.customer_telegram_username || row.customerTelegramUsername || null,
    } : undefined,
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

function mapPrivateKey(row) {
  return row ? {
    ...mapKey(row),
    keyHash: row.key_hash || row.keyHash,
    litellmKey: row.litellm_key || row.litellmKey || null,
    litellmResponse: row.litellm_response || row.litellmResponse || null,
  } : null;
}

function verifyTelegramAuth(authData, botToken) {
  if (!botToken) return { ok: false, error: 'missing_telegram_bot_token' };
  const { hash, ...data } = authData || {};
  if (!hash || !data.id || !data.auth_date) return { ok: false, error: 'invalid_telegram_payload' };
  const ageSeconds = Math.floor(Date.now() / 1000) - Number(data.auth_date);
  if (!Number.isFinite(ageSeconds) || ageSeconds > 86400) return { ok: false, error: 'telegram_auth_expired' };
  const checkString = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join('\n');
  const secret = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(checkString).digest('hex');
  const actual = String(hash);
  const ok = actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  return ok ? { ok: true, data } : { ok: false, error: 'invalid_telegram_signature' };
}

function telegramCustomerData(profile) {
  const telegramId = String(profile.id);
  const displayName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.username || `Telegram ${telegramId}`;
  return {
    telegramId,
    telegramUsername: profile.username || null,
    displayName,
    email: `telegram-${telegramId}@telegram.elaltidar.local`,
  };
}

function createPostgresStore(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false } });
  let ready;
  const ensureReady = () => {
    ready ||= pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT,
        telegram_id TEXT,
        telegram_username TEXT,
        created_at TEXT NOT NULL
      );
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS display_name TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS telegram_id TEXT;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS telegram_username TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS customers_telegram_id_idx ON customers(telegram_id) WHERE telegram_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id),
        key_hash TEXT NOT NULL,
        litellm_key TEXT,
        public_key TEXT NOT NULL,
        package_id TEXT NOT NULL,
        litellm_key_alias TEXT,
        litellm_response JSONB,
        created_at TEXT NOT NULL
      );
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS litellm_key TEXT;
      DELETE FROM api_keys older
      USING api_keys newer
      WHERE older.customer_id = newer.customer_id
        AND (older.created_at < newer.created_at OR (older.created_at = newer.created_at AND older.ctid < newer.ctid));
      CREATE UNIQUE INDEX IF NOT EXISTS api_keys_customer_id_idx ON api_keys(customer_id);
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL REFERENCES customers(id),
        package_id TEXT NOT NULL,
        package_name TEXT NOT NULL,
        amount INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        paid_at TEXT,
        expires_at TEXT
      );
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS expires_at TEXT;
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
      const existing = await pool.query('SELECT id, email, display_name, telegram_id, telegram_username, created_at FROM customers WHERE email = $1', [normalizedEmail]);
      if (existing.rows[0]) return mapCustomer(existing.rows[0]);
      const customer = { id: randomBytes(8).toString('hex'), email: normalizedEmail, createdAt: new Date().toISOString() };
      await pool.query('INSERT INTO customers (id, email, created_at) VALUES ($1, $2, $3)', [customer.id, customer.email, customer.createdAt]);
      return customer;
    },
    async upsertTelegramCustomer(profile) {
      await ensureReady();
      const telegram = telegramCustomerData(profile);
      const existing = await pool.query('SELECT id, email, display_name, telegram_id, telegram_username, created_at FROM customers WHERE telegram_id = $1', [telegram.telegramId]);
      if (existing.rows[0]) {
        const updated = await pool.query(`
          UPDATE customers SET display_name = $1, telegram_username = $2 WHERE telegram_id = $3
          RETURNING id, email, display_name, telegram_id, telegram_username, created_at
        `, [telegram.displayName, telegram.telegramUsername, telegram.telegramId]);
        return mapCustomer(updated.rows[0]);
      }
      const customer = { id: randomBytes(8).toString('hex'), ...telegram, createdAt: new Date().toISOString() };
      await pool.query(`
        INSERT INTO customers (id, email, display_name, telegram_id, telegram_username, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [customer.id, customer.email, customer.displayName, customer.telegramId, customer.telegramUsername, customer.createdAt]);
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
        SELECT customers.id, customers.email, customers.display_name, customers.telegram_id, customers.telegram_username, customers.created_at
        FROM sessions
        JOIN customers ON customers.id = sessions.customer_id
        WHERE sessions.token = $1
      `, [token]);
      return mapCustomer(result.rows[0]);
    },
    async customerById(customerId) {
      await ensureReady();
      const result = await pool.query('SELECT id, email, display_name, telegram_id, telegram_username, created_at FROM customers WHERE id = $1', [customerId]);
      return mapCustomer(result.rows[0]);
    },
    async saveKey(customerId, key, packageId, litellmResponse = {}) {
      await ensureReady();
      const row = {
        id: randomBytes(8).toString('hex'),
        customerId,
        keyHash: keyHash(key),
        litellmKey: key,
        publicKey: maskKey(key),
        packageId,
        litellmKeyAlias: litellmResponse.key_alias || litellmResponse.key_name || null,
        litellmResponse,
        createdAt: new Date().toISOString(),
      };
      await pool.query(`
        INSERT INTO api_keys (id, customer_id, key_hash, litellm_key, public_key, package_id, litellm_key_alias, litellm_response, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (customer_id) DO UPDATE SET
          key_hash = EXCLUDED.key_hash,
          litellm_key = EXCLUDED.litellm_key,
          public_key = EXCLUDED.public_key,
          package_id = EXCLUDED.package_id,
          litellm_key_alias = EXCLUDED.litellm_key_alias,
          litellm_response = EXCLUDED.litellm_response,
          created_at = EXCLUDED.created_at
      `, [row.id, row.customerId, row.keyHash, row.litellmKey, row.publicKey, row.packageId, row.litellmKeyAlias, row.litellmResponse, row.createdAt]);
      return row;
    },
    async customerKey(customerId) {
      await ensureReady();
      const result = await pool.query(`
        SELECT id, customer_id, key_hash, litellm_key, public_key, package_id, litellm_key_alias, litellm_response, created_at
        FROM api_keys WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1
      `, [customerId]);
      return mapPrivateKey(result.rows[0]);
    },
    async createOrder(customerId, packageId) {
      await ensureReady();
      const pkg = packages[packageId] || packages.starter;
      const row = { id: randomBytes(8).toString('hex'), customerId, packageId: pkg.id, packageName: pkg.name, amount: pkg.maxBudget, status: 'pending', createdAt: new Date().toISOString(), paidAt: null, expiresAt: null };
      await pool.query(`
        INSERT INTO orders (id, customer_id, package_id, package_name, amount, status, created_at, paid_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [row.id, row.customerId, row.packageId, row.packageName, row.amount, row.status, row.createdAt, row.paidAt, row.expiresAt]);
      return row;
    },
    async approveOrder(orderId) {
      await ensureReady();
      const paidAt = new Date().toISOString();
      const existing = await pool.query('SELECT package_id FROM orders WHERE id = $1', [orderId]);
      if (!existing.rows[0]) return null;
      const pkg = packages[existing.rows[0].package_id] || packages.starter;
      const expiresAt = addDays(paidAt, pkg.durationDays);
      const result = await pool.query(`
        UPDATE orders SET status = 'paid', paid_at = $1, expires_at = $2 WHERE id = $3
        RETURNING id, customer_id, package_id, package_name, amount, status, created_at, paid_at, expires_at
      `, [paidAt, expiresAt, orderId]);
      return mapOrder(result.rows[0]);
    },
    async customerByApiKey(key) {
      await ensureReady();
      if (!key) return null;
      const result = await pool.query(`
        SELECT customers.id, customers.email, customers.display_name, customers.telegram_id, customers.telegram_username, customers.created_at
        FROM api_keys
        JOIN customers ON customers.id = api_keys.customer_id
        WHERE api_keys.key_hash = $1
      `, [keyHash(key)]);
      return mapCustomer(result.rows[0]);
    },
    async availableModels(customerId) {
      await ensureReady();
      const now = new Date().toISOString();
      const result = await pool.query(`
        SELECT id, customer_id, package_id, package_name, amount, status, created_at, paid_at, expires_at
        FROM orders
        WHERE customer_id = $1 AND status = 'paid' AND expires_at > $2
        ORDER BY expires_at DESC
      `, [customerId, now]);
      return result.rows.map(mapOrder).map((order) => ({ order, package: packages[order.packageId] || packages.starter }));
    },
    async listOrders({ status } = {}) {
      await ensureReady();
      const result = status
        ? await pool.query(`
          SELECT orders.id, orders.customer_id, orders.package_id, orders.package_name, orders.amount, orders.status, orders.created_at, orders.paid_at, orders.expires_at,
            customers.email AS customer_email, customers.display_name AS customer_display_name, customers.telegram_username AS customer_telegram_username
          FROM orders
          JOIN customers ON customers.id = orders.customer_id
          WHERE orders.status = $1 ORDER BY orders.created_at DESC
        `, [status])
        : await pool.query(`
          SELECT orders.id, orders.customer_id, orders.package_id, orders.package_name, orders.amount, orders.status, orders.created_at, orders.paid_at, orders.expires_at,
            customers.email AS customer_email, customers.display_name AS customer_display_name, customers.telegram_username AS customer_telegram_username
          FROM orders
          JOIN customers ON customers.id = orders.customer_id
          ORDER BY orders.created_at DESC
        `);
      return result.rows.map(mapOrder);
    },
    async dashboard(customer) {
      await ensureReady();
      const latestKey = await pool.query(`
        SELECT id, customer_id, public_key, package_id, litellm_key_alias, created_at
        FROM api_keys WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1
      `, [customer.id]);
      const activePackage = await pool.query(`
        SELECT id, customer_id, package_id, package_name, amount, status, created_at, paid_at, expires_at
        FROM orders WHERE customer_id = $1 AND status = 'paid' AND expires_at > $2 ORDER BY paid_at DESC LIMIT 1
      `, [customer.id, new Date().toISOString()]);
      const orders = await pool.query(`
        SELECT id, customer_id, package_id, package_name, amount, status, created_at, paid_at, expires_at
        FROM orders WHERE customer_id = $1 ORDER BY created_at DESC
      `, [customer.id]);
      const availableModels = (await this.availableModels(customer.id)).map((item) => ({ id: item.package.model, name: item.package.name, packageId: item.package.id, expiresAt: item.order.expiresAt }));
      return { customer, activePackage: mapOrder(activePackage.rows[0]), availableModels, latestKey: mapKey(latestKey.rows[0]), orders: orders.rows.map(mapOrder) };
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
      display_name TEXT,
      telegram_id TEXT UNIQUE,
      telegram_username TEXT,
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
      litellm_key TEXT,
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
      expires_at TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );
  `);
  const customerColumns = new Set(db.prepare('PRAGMA table_info(customers)').all().map((column) => column.name));
  if (!customerColumns.has('display_name')) db.prepare('ALTER TABLE customers ADD COLUMN display_name TEXT').run();
  if (!customerColumns.has('telegram_id')) db.prepare('ALTER TABLE customers ADD COLUMN telegram_id TEXT').run();
  if (!customerColumns.has('telegram_username')) db.prepare('ALTER TABLE customers ADD COLUMN telegram_username TEXT').run();
  db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS customers_telegram_id_idx ON customers(telegram_id) WHERE telegram_id IS NOT NULL').run();
  const keyColumns = new Set(db.prepare('PRAGMA table_info(keys)').all().map((column) => column.name));
  if (!keyColumns.has('litellm_key')) db.prepare('ALTER TABLE keys ADD COLUMN litellm_key TEXT').run();
  db.prepare('DELETE FROM keys WHERE rowid NOT IN (SELECT MAX(rowid) FROM keys GROUP BY customer_id)').run();
  db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS keys_customer_id_idx ON keys(customer_id)').run();
  const orderColumns = new Set(db.prepare('PRAGMA table_info(orders)').all().map((column) => column.name));
  if (!orderColumns.has('expires_at')) db.prepare('ALTER TABLE orders ADD COLUMN expires_at TEXT').run();

  return {
    close() {
      db.close();
    },
    upsertCustomer(email) {
      const normalizedEmail = email.toLowerCase();
      const existing = db.prepare('SELECT id, email, display_name AS displayName, telegram_id AS telegramId, telegram_username AS telegramUsername, created_at AS createdAt FROM customers WHERE email = ?').get(normalizedEmail);
      if (existing) return mapCustomer(existing);
      const customer = { id: randomBytes(8).toString('hex'), email: normalizedEmail, createdAt: new Date().toISOString() };
      db.prepare('INSERT INTO customers (id, email, created_at) VALUES (?, ?, ?)').run(customer.id, customer.email, customer.createdAt);
      return customer;
    },
    upsertTelegramCustomer(profile) {
      const telegram = telegramCustomerData(profile);
      const existing = db.prepare('SELECT id, email, display_name AS displayName, telegram_id AS telegramId, telegram_username AS telegramUsername, created_at AS createdAt FROM customers WHERE telegram_id = ?').get(telegram.telegramId);
      if (existing) {
        db.prepare('UPDATE customers SET display_name = ?, telegram_username = ? WHERE telegram_id = ?').run(telegram.displayName, telegram.telegramUsername, telegram.telegramId);
        return mapCustomer({ ...existing, displayName: telegram.displayName, telegramUsername: telegram.telegramUsername });
      }
      const customer = { id: randomBytes(8).toString('hex'), ...telegram, createdAt: new Date().toISOString() };
      db.prepare('INSERT INTO customers (id, email, display_name, telegram_id, telegram_username, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(customer.id, customer.email, customer.displayName, customer.telegramId, customer.telegramUsername, customer.createdAt);
      return customer;
    },
    createSession(customerId) {
      const session = { token: randomBytes(32).toString('hex'), customerId, createdAt: new Date().toISOString() };
      db.prepare('INSERT INTO sessions (token, customer_id, created_at) VALUES (?, ?, ?)').run(session.token, session.customerId, session.createdAt);
      return session;
    },
    customerByToken(token) {
      if (!token) return null;
      const customer = db.prepare(`
        SELECT customers.id, customers.email, customers.created_at AS createdAt
        , customers.display_name AS displayName, customers.telegram_id AS telegramId, customers.telegram_username AS telegramUsername
        FROM sessions
        JOIN customers ON customers.id = sessions.customer_id
        WHERE sessions.token = ?
      `).get(token);
      return mapCustomer(customer);
    },
    customerById(customerId) {
      const customer = db.prepare('SELECT id, email, display_name AS displayName, telegram_id AS telegramId, telegram_username AS telegramUsername, created_at AS createdAt FROM customers WHERE id = ?').get(customerId);
      return mapCustomer(customer);
    },
    saveKey(customerId, key, packageId, litellmResponse = {}) {
      const row = {
        id: randomBytes(8).toString('hex'),
        customerId,
        keyHash: keyHash(key),
        litellmKey: key,
        publicKey: maskKey(key),
        packageId,
        litellmKeyAlias: litellmResponse.key_alias || litellmResponse.key_name || null,
        litellmResponse: JSON.stringify(litellmResponse),
        createdAt: new Date().toISOString(),
      };
      const existing = db.prepare('SELECT id FROM keys WHERE customer_id = ?').get(customerId);
      if (existing) {
        db.prepare(`
          UPDATE keys SET key_hash = ?, litellm_key = ?, public_key = ?, package_id = ?, litellm_key_alias = ?, litellm_response = ?, created_at = ?
          WHERE customer_id = ?
        `).run(row.keyHash, row.litellmKey, row.publicKey, row.packageId, row.litellmKeyAlias, row.litellmResponse, row.createdAt, row.customerId);
        return { ...row, id: existing.id };
      }
      db.prepare(`
        INSERT INTO keys (id, customer_id, key_hash, litellm_key, public_key, package_id, litellm_key_alias, litellm_response, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(row.id, row.customerId, row.keyHash, row.litellmKey, row.publicKey, row.packageId, row.litellmKeyAlias, row.litellmResponse, row.createdAt);
      return row;
    },
    customerKey(customerId) {
      const row = db.prepare(`
        SELECT id, customer_id AS customerId, key_hash AS keyHash, litellm_key AS litellmKey, public_key AS publicKey, package_id AS packageId, litellm_key_alias AS litellmKeyAlias, litellm_response AS litellmResponse, created_at AS createdAt
        FROM keys WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1
      `).get(customerId);
      return mapPrivateKey(row);
    },
    createOrder(customerId, packageId) {
      const pkg = packages[packageId] || packages.starter;
      const row = { id: randomBytes(8).toString('hex'), customerId, packageId: pkg.id, packageName: pkg.name, amount: pkg.maxBudget, status: 'pending', createdAt: new Date().toISOString(), paidAt: null, expiresAt: null };
      db.prepare(`
        INSERT INTO orders (id, customer_id, package_id, package_name, amount, status, created_at, paid_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(row.id, row.customerId, row.packageId, row.packageName, row.amount, row.status, row.createdAt, row.paidAt, row.expiresAt);
      return row;
    },
    approveOrder(orderId) {
      const paidAt = new Date().toISOString();
      const existing = db.prepare('SELECT package_id AS packageId FROM orders WHERE id = ?').get(orderId);
      if (!existing) return null;
      const pkg = packages[existing.packageId] || packages.starter;
      const expiresAt = addDays(paidAt, pkg.durationDays);
      db.prepare("UPDATE orders SET status = 'paid', paid_at = ?, expires_at = ? WHERE id = ?").run(paidAt, expiresAt, orderId);
      return db.prepare(`
        SELECT id, customer_id AS customerId, package_id AS packageId, package_name AS packageName, amount, status, created_at AS createdAt, paid_at AS paidAt, expires_at AS expiresAt
        FROM orders WHERE id = ?
      `).get(orderId) || null;
    },
    customerByApiKey(key) {
      if (!key) return null;
      const customer = db.prepare(`
        SELECT customers.id, customers.email, customers.created_at AS createdAt,
          customers.display_name AS displayName, customers.telegram_id AS telegramId, customers.telegram_username AS telegramUsername
        FROM keys
        JOIN customers ON customers.id = keys.customer_id
        WHERE keys.key_hash = ?
      `).get(keyHash(key));
      return mapCustomer(customer);
    },
    availableModels(customerId) {
      const now = new Date().toISOString();
      const orders = db.prepare(`
        SELECT id, customer_id AS customerId, package_id AS packageId, package_name AS packageName, amount, status, created_at AS createdAt, paid_at AS paidAt, expires_at AS expiresAt
        FROM orders
        WHERE customer_id = ? AND status = 'paid' AND expires_at > ?
        ORDER BY expires_at DESC
      `).all(customerId, now).map(mapOrder);
      return orders.map((order) => ({ order, package: packages[order.packageId] || packages.starter }));
    },
    listOrders({ status } = {}) {
      const query = status
        ? db.prepare(`
          SELECT orders.id, orders.customer_id AS customerId, orders.package_id AS packageId, orders.package_name AS packageName, orders.amount, orders.status, orders.created_at AS createdAt, orders.paid_at AS paidAt, orders.expires_at AS expiresAt,
            customers.email AS customerEmail, customers.display_name AS customerDisplayName, customers.telegram_username AS customerTelegramUsername
          FROM orders
          JOIN customers ON customers.id = orders.customer_id
          WHERE orders.status = ? ORDER BY orders.created_at DESC
        `).all(status)
        : db.prepare(`
          SELECT orders.id, orders.customer_id AS customerId, orders.package_id AS packageId, orders.package_name AS packageName, orders.amount, orders.status, orders.created_at AS createdAt, orders.paid_at AS paidAt, orders.expires_at AS expiresAt,
            customers.email AS customerEmail, customers.display_name AS customerDisplayName, customers.telegram_username AS customerTelegramUsername
          FROM orders
          JOIN customers ON customers.id = orders.customer_id
          ORDER BY orders.created_at DESC
        `).all();
      return query.map(mapOrder);
    },
    dashboard(customer) {
      const latestKey = db.prepare(`
        SELECT id, customer_id AS customerId, public_key AS publicKey, package_id AS packageId, litellm_key_alias AS litellmKeyAlias, created_at AS createdAt
        FROM keys WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1
      `).get(customer.id) || null;
      const activePackage = db.prepare(`
        SELECT id, customer_id AS customerId, package_id AS packageId, package_name AS packageName, amount, status, created_at AS createdAt, paid_at AS paidAt, expires_at AS expiresAt
        FROM orders WHERE customer_id = ? AND status = 'paid' AND expires_at > ? ORDER BY paid_at DESC LIMIT 1
      `).get(customer.id, new Date().toISOString()) || null;
      const orders = db.prepare(`
        SELECT id, customer_id AS customerId, package_id AS packageId, package_name AS packageName, amount, status, created_at AS createdAt, paid_at AS paidAt, expires_at AS expiresAt
        FROM orders WHERE customer_id = ? ORDER BY created_at DESC
      `).all(customer.id);
      const availableModels = this.availableModels(customer.id).map((item) => ({ id: item.package.model, name: item.package.name, packageId: item.package.id, expiresAt: item.order.expiresAt }));
      return { customer, activePackage: mapOrder(activePackage), availableModels, latestKey: mapKey(latestKey), orders: orders.map(mapOrder) };
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

function getAdminToken(req) {
  const auth = req.headers.authorization || '';
  if (req.headers['x-admin-token']) return req.headers['x-admin-token'];
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function isAdmin(req, config) {
  return Boolean(config.adminToken && getAdminToken(req) === config.adminToken);
}

async function readLiteLLMUsage({ config, latestKey, fetchImpl }) {
  if (!config.litellmMasterKey || !latestKey?.litellmKeyAlias) return null;
  const url = `${config.litellmBaseUrl}/key/info?key=${encodeURIComponent(latestKey.litellmKeyAlias)}`;
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${config.litellmMasterKey}` } });
  if (!res.ok) return null;
  return res.json();
}

function activeKeyParams(activeEntitlements) {
  const activeModels = Array.from(new Set(activeEntitlements.map((item) => item.package.model)));
  const totalBudget = activeEntitlements.reduce((sum, item) => sum + item.order.amount, 0);
  const latestExpiry = activeEntitlements.reduce((latest, item) => item.order.expiresAt > latest ? item.order.expiresAt : latest, activeEntitlements[0].order.expiresAt);
  const remainingDays = Math.max(1, Math.ceil((new Date(latestExpiry).getTime() - Date.now()) / 86400000));
  return { activeModels, totalBudget, latestExpiry, remainingDays };
}

async function syncCustomerLiteLLMKey({ store, config, customer, fetchImpl }) {
  if (!config.litellmMasterKey) return { synced: false, reason: 'missing_litellm_master_key' };
  const existingKey = await store.customerKey(customer.id);
  if (!existingKey?.litellmKey) return { synced: false, reason: 'missing_customer_key' };
  const activeEntitlements = await store.availableModels(customer.id);
  const params = activeEntitlements.length > 0 ? activeKeyParams(activeEntitlements) : { activeModels: [], totalBudget: 0, remainingDays: 1 };
  const llmRes = await fetchImpl(`${config.litellmBaseUrl}/key/update`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.litellmMasterKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      key: existingKey.litellmKey,
      models: params.activeModels,
      max_budget: params.totalBudget,
      duration: `${params.remainingDays}d`,
      metadata: { customer_id: customer.id, customer_email: customer.email, package_ids: activeEntitlements.map((item) => item.package.id), brand: 'ElaltidarAI' },
    }),
  });
  const payload = await llmRes.json();
  if (!llmRes.ok) {
    const error = new Error('litellm_key_update_failed');
    error.status = llmRes.status;
    error.detail = payload;
    throw error;
  }
  return { synced: true, keyMeta: mapKey(existingKey), models: params.activeModels, detail: payload };
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

  app.get('/api/config', (req, res) => res.json({
    allowDevLogin: config.allowDevLogin,
    telegramBotUsername: config.telegramBotUsername,
  }));

  app.post('/api/login', async (req, res) => {
    if (!config.allowDevLogin) return res.status(403).json({ error: 'dev_login_disabled' });
    if (!/^\S+@\S+\.\S+$/.test(req.body.email || '')) return res.status(400).json({ error: 'invalid_email' });
    const customer = await appStore.upsertCustomer(req.body.email);
    const session = await appStore.createSession(customer.id);
    return res.json({ token: session.token, customer });
  });

  app.post('/api/auth/telegram', async (req, res) => {
    const verified = verifyTelegramAuth(req.body, config.telegramBotToken);
    if (!verified.ok) return res.status(401).json({ error: verified.error });
    const customer = await appStore.upsertTelegramCustomer(verified.data);
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

  app.get('/v1/models', async (req, res) => {
    const customer = await appStore.customerByApiKey(getToken(req));
    if (!customer) return res.status(401).json({ error: { message: 'Unauthorized', type: 'invalid_request_error', code: 'unauthorized' } });
    const availableModels = await appStore.availableModels(customer.id);
    return res.json({
      object: 'list',
      data: availableModels.map((item) => ({
        id: item.package.model,
        object: 'model',
        created: Math.floor(new Date(item.order.paidAt || item.order.createdAt).getTime() / 1000),
        owned_by: 'elaltidarai',
        permission: [],
        root: item.package.model,
        parent: null,
      })),
    });
  });

  app.post('/api/orders', async (req, res) => {
    const customer = await appStore.customerByToken(getToken(req, req.body));
    if (!customer) return res.status(401).json({ error: 'unauthorized' });
    return res.json({ order: await appStore.createOrder(customer.id, req.body.packageId || 'starter') });
  });

  app.get('/api/admin/orders', async (req, res) => {
    if (!isAdmin(req, config)) return res.status(401).json({ error: 'admin_unauthorized' });
    return res.json({ orders: await appStore.listOrders({ status: req.query.status }) });
  });

  app.post('/api/admin/orders/:orderId/approve', async (req, res) => {
    if (!isAdmin(req, config)) return res.status(401).json({ error: 'admin_unauthorized' });
    const order = await appStore.approveOrder(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'order_not_found' });
    const customer = await appStore.customerById(order.customerId);
    try {
      const keySync = customer ? await syncCustomerLiteLLMKey({ store: appStore, config, customer, fetchImpl }) : { synced: false, reason: 'customer_not_found' };
      return res.json({ order, keySync });
    } catch (error) {
      return res.status(error.status || 502).json({ error: 'litellm_key_sync_failed', detail: error.detail || String(error.message || error), order });
    }
  });

  app.post('/api/keys', async (req, res) => {
    const customer = await appStore.customerByToken(getToken(req, req.body));
    if (!customer) return res.status(401).json({ error: 'unauthorized' });
    if (!config.litellmMasterKey) return res.status(500).json({ error: 'missing_litellm_master_key' });

    const activeEntitlements = await appStore.availableModels(customer.id);
    if (activeEntitlements.length === 0) return res.status(402).json({ error: 'no_active_model_entitlement' });
    const existingKey = await appStore.customerKey(customer.id);
    if (existingKey?.litellmKey) {
      const keySync = await syncCustomerLiteLLMKey({ store: appStore, config, customer, fetchImpl });
      return res.json({ key: null, keyMeta: mapKey(existingKey), reused: true, keySync });
    }
    const { activeModels, totalBudget, remainingDays } = activeKeyParams(activeEntitlements);
    const packageId = activeEntitlements[0].package.id;
    const keyAlias = `elaltidar-${customer.id}-multi`;
    const llmRes = await fetchImpl(`${config.litellmBaseUrl}/key/generate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.litellmMasterKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        key_alias: keyAlias,
        key_name: keyAlias,
        max_budget: totalBudget,
        duration: `${remainingDays}d`,
        models: activeModels,
        metadata: { customer_id: customer.id, customer_email: customer.email, package_ids: activeEntitlements.map((item) => item.package.id), brand: 'ElaltidarAI' },
      }),
    });
    const payload = await llmRes.json();
    if (!llmRes.ok) return res.status(llmRes.status).json({ error: 'litellm_key_generate_failed', detail: payload });
    const key = payload.key || payload.token;
    if (!key) return res.status(502).json({ error: 'litellm_key_missing', detail: payload });
    const keyMeta = await appStore.saveKey(customer.id, key, packageId, { ...payload, key_alias: keyAlias });
    return res.json({ key, keyMeta: mapKey(keyMeta) });
  });

  return app;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const envText = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '';
  const config = loadConfig(envText);
  const app = createApiServer({ store: createStore({ file: config.storeFile, databaseUrl: config.databaseUrl }), config });
  app.listen(config.apiPort, () => console.log(`Elaltidar API listening on http://localhost:${config.apiPort}`));
}
