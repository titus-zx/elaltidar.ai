import React, { FormEvent, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Package = {
  id: string;
  name: string;
  model: string;
  quota: string;
  price: string;
  maxBudget: number;
  durationDays: number;
};

type Customer = {
  id: string;
  email: string;
  createdAt: string;
};

type Order = {
  id: string;
  packageId: string;
  packageName: string;
  amount: number;
  status: 'pending' | 'paid';
  createdAt: string;
  paidAt: string | null;
};

type KeyMeta = {
  id: string;
  publicKey: string;
  packageId: string;
  createdAt: string;
};

type Dashboard = {
  customer: Customer;
  activePackage: Order | null;
  latestKey: KeyMeta | null;
  orders: Order[];
  gateway: { baseUrl: string };
  packages: Package[];
  usage: unknown | null;
};

type PublicConfig = {
  allowDevLogin: boolean;
  telegramBotUsername: string;
};

type TelegramAuth = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

const FALLBACK_PACKAGES: Package[] = [
  { id: 'starter', name: 'GPT-4.1 Mini 10M', model: 'gpt-4.1-mini', quota: '10M tokens / 3 hari', price: 'Rp 29.000', maxBudget: 29000, durationDays: 3 },
  { id: 'claude', name: 'Claude Haiku 3.5 10M', model: 'claude-3-5-haiku', quota: '10M tokens / 3 hari', price: 'Rp 39.000', maxBudget: 39000, durationDays: 3 },
  { id: 'pro', name: 'Gemini 2.0 Flash 20M', model: 'gemini-2.0-flash', quota: '20M tokens / 7 hari', price: 'Rp 25.000', maxBudget: 25000, durationDays: 7 },
  { id: 'scale', name: 'DeepSeek Chat 50M', model: 'deepseek-chat', quota: '50M tokens / 7 hari', price: 'Rp 45.000', maxBudget: 45000, durationDays: 7 },
  { id: 'qwen', name: 'Qwen Turbo 50M', model: 'qwen-turbo', quota: '50M tokens / 7 hari', price: 'Rp 35.000', maxBudget: 35000, durationDays: 7 },
];

const API_BASE = '/api';
const GATEWAY_BASE = 'https://litellm.xtrip.click/v1';

function modelMark(label: string, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/><circle cx="47" cy="17" r="7" fill="#fffdf7" opacity=".32"/><text x="32" y="39" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="800" fill="#fffdf7">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const providerMeta: Record<string, { name: string; icon: string; accent: string }> = {
  starter: { name: 'OpenAI', icon: modelMark('O', '#10a37f'), accent: '#10a37f' },
  claude: { name: 'Anthropic', icon: modelMark('A', '#d97757'), accent: '#d97757' },
  pro: { name: 'Gemini', icon: modelMark('G', '#3b82f6'), accent: '#3b82f6' },
  scale: { name: 'DeepSeek', icon: modelMark('D', '#4f46e5'), accent: '#4f46e5' },
  qwen: { name: 'Qwen', icon: modelMark('Q', '#f97316'), accent: '#f97316' },
};

const modelLogos = [
  providerMeta.starter,
  providerMeta.claude,
  providerMeta.pro,
  providerMeta.scale,
  providerMeta.qwen,
  { name: 'Meta', icon: modelMark('M', '#2563eb'), accent: '#2563eb' },
  { name: 'Z.ai', icon: modelMark('Z', '#64748b'), accent: '#64748b' },
];

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'request_failed');
  return data;
}

function formatRupiah(amount: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}

function metaForPackage(packageId: string) {
  return providerMeta[packageId] || { name: 'Model Pool', icon: modelMark('AI', '#15605b'), accent: '#15605b' };
}

function App() {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState(() => localStorage.getItem('elaltidar_token') || '');
  const [packages, setPackages] = useState(FALLBACK_PACKAGES);
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({ allowDevLogin: false, telegramBotUsername: '' });
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [plainKey, setPlainKey] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  async function refreshDashboard(currentToken = token) {
    if (!currentToken) return;
    const data = await api<Dashboard>('/dashboard', { headers: { authorization: `Bearer ${currentToken}` } });
    setDashboard(data);
    setPackages(data.packages);
  }

  useEffect(() => {
    api<PublicConfig>('/config')
      .then(setPublicConfig)
      .catch(() => setPublicConfig({ allowDevLogin: false, telegramBotUsername: '' }));
    api<{ packages: Package[] }>('/packages')
      .then((data) => setPackages(data.packages))
      .catch(() => setPackages(FALLBACK_PACKAGES));
  }, []);

  useEffect(() => {
    if (!publicConfig.telegramBotUsername) return;
    const container = document.getElementById('telegram-login-slot');
    if (!container) return;
    container.innerHTML = '';
    (window as unknown as { onTelegramAuth: (user: TelegramAuth) => void }).onTelegramAuth = async (user) => {
      setBusy('telegram');
      setMessage('');
      try {
        const data = await api<{ token: string; customer: Customer }>('/auth/telegram', {
          method: 'POST',
          body: JSON.stringify(user),
        });
        localStorage.setItem('elaltidar_token', data.token);
        setToken(data.token);
        setMessage('Login Telegram berhasil. Session tersimpan di browser ini.');
        await refreshDashboard(data.token);
      } catch (error) {
        setMessage(`Login Telegram gagal: ${(error as Error).message}`);
      } finally {
        setBusy('');
      }
    };
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', publicConfig.telegramBotUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    container.appendChild(script);
  }, [publicConfig.telegramBotUsername]);

  useEffect(() => {
    if (!token) return;
    refreshDashboard(token).catch(() => {
      localStorage.removeItem('elaltidar_token');
      setToken('');
    });
  }, [token]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy('login');
    setMessage('');
    try {
      const data = await api<{ token: string; customer: Customer }>('/login', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      localStorage.setItem('elaltidar_token', data.token);
      setToken(data.token);
      setMessage('Login berhasil. Session tersimpan di browser ini.');
      await refreshDashboard(data.token);
    } catch (error) {
      setMessage(`Login gagal: ${(error as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function createOrder(packageId: string) {
    if (!token) return setMessage('Login dulu untuk membuat order.');
    setBusy(`order-${packageId}`);
    setMessage('');
    try {
      const data = await api<{ order: Order }>('/orders', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ packageId }),
      });
      setMessage(`Order ${data.order.packageName} dibuat. Status masih pending manual approval.`);
      await refreshDashboard();
    } catch (error) {
      setMessage(`Order gagal: ${(error as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  async function createKey(packageId: string) {
    if (!token) return setMessage('Login dulu untuk generate API key.');
    setBusy(`key-${packageId}`);
    setMessage('');
    try {
      const data = await api<{ key: string; keyMeta: KeyMeta }>('/keys', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ packageId }),
      });
      setPlainKey(data.key);
      setMessage('API key LiteLLM berhasil dibuat. Simpan key penuh sekarang, setelah refresh hanya versi masked yang tampil.');
      await refreshDashboard();
    } catch (error) {
      setMessage(`Generate key gagal: ${(error as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  const selectedPackage = dashboard?.activePackage?.packageId || dashboard?.latestKey?.packageId || packages[0]?.id || 'starter';
  const latestOrder = dashboard?.orders[0] || null;

  return <>
    <header className="nav">
      <a className="brand" href="#top">ElaltidarAI</a>
      <nav>
        <a href="#features">Fitur</a>
        <a href="#pricing">Harga</a>
        <a href="#dashboard">Dashboard</a>
        <a href="#docs">Docs</a>
      </nav>
      <a className="login" href="#dashboard">Member Area</a>
    </header>

    <main id="top">
      <section className="hero">
        <div>
          <p className="eyebrow">ElaltidarAI API</p>
          <h1>Akses model AI terbaik, beli token, langsung pakai.</h1>
          <p className="lead">Platform API AI Indonesia dengan paket token, dashboard member, dan endpoint OpenAI-compatible di atas gateway LiteLLM sendiri.</p>
          <div className="actions">
            <a className="primary" href="#pricing">Lihat paket</a>
            <a className="secondary" href="#dashboard">Buka dashboard</a>
          </div>
        </div>
        <div className="heroCard" aria-label="ElaltidarAI live platform preview">
          <div className="heroCardTop">
            <span>Live gateway</span>
            <b>Online</b>
          </div>
          <strong>1 endpoint untuk banyak model.</strong>
          <p><code>{GATEWAY_BASE}</code></p>
          <div className="heroStats">
            <div><b>{packages.length}</b><span>Model paket</span></div>
            <div><b>Bearer</b><span>API key</span></div>
            <div><b>IDR</b><span>Token topup</span></div>
          </div>
        </div>
      </section>

      <section className="modelRail" aria-label="Supported AI models">
        <p>DIDUKUNG MODEL AI TERDEPAN</p>
        <div>
          {[...modelLogos, ...modelLogos].map((item, index) => <span key={`${item.name}-${index}`}><img src={item.icon} alt="" />{item.name}</span>)}
        </div>
      </section>

      <section className="stats">
        <div><strong>1 API</strong><span>Format OpenAI-compatible</span></div>
        <div><strong>{packages.length}</strong><span>Paket token aktif</span></div>
        <div><strong>Postgres</strong><span>Data customer permanen</span></div>
        <div><strong>LiteLLM</strong><span>Key, budget, dan routing</span></div>
      </section>

      <section id="features" className="section">
        <p className="eyebrow">Fitur MVP</p>
        <h2>Storefront ramping. Backend tetap LiteLLM.</h2>
        <div className="grid3">
          <article><h3>Paket token</h3><p>Customer pilih quota, backend membuat order pending, lalu admin bisa approve manual dulu.</p></article>
          <article><h3>Member dashboard</h3><p>Login email ringan, lihat order, plan aktif, API key masked, dan status gateway.</p></article>
          <article><h3>LiteLLM key</h3><p>Generate API key real via LiteLLM admin API dengan budget dan durasi sesuai paket.</p></article>
        </div>
      </section>

      <section id="pricing" className="section">
        <p className="eyebrow">Pricing</p>
        <div className="sectionHead">
          <h2>Pilih paket token.</h2>
          <div className="currencySwitch"><span>Rp</span><b>IDR</b></div>
        </div>
        <div className="plans">
          {packages.map((item) => {
            const meta = metaForPackage(item.id);
            return <article className="plan" key={item.id} style={{ '--accent': meta.accent } as React.CSSProperties}>
            <div className="planLogo"><img src={meta.icon} alt="" /><span>{meta.name}</span></div>
            <h3>{item.name}</h3>
            <p>{item.quota}</p>
            <ul>
              <li>{item.quota.split(' / ')[0]}</li>
              <li>Aktif {item.durationDays} hari</li>
              <li>Akses via OpenAI-compatible API</li>
            </ul>
            <strong>{item.price}</strong>
            <button disabled={busy === `order-${item.id}`} onClick={() => createOrder(item.id)}>{busy === `order-${item.id}` ? 'Membuat...' : 'Buat order'}</button>
          </article>})}
        </div>
      </section>

      <section id="dashboard" className="section dashboard">
        <div>
          <p className="eyebrow">Member dashboard</p>
          <h2>Customer area MVP</h2>
          <p>Login Telegram untuk membuat order, menunggu approval admin, lalu generate key LiteLLM dengan quota paket.</p>
          <div className="telegramLogin">
            <div id="telegram-login-slot"></div>
            {!publicConfig.telegramBotUsername && <span>Set TELEGRAM_BOT_USERNAME di Vercel untuk mengaktifkan tombol Telegram.</span>}
          </div>
          {publicConfig.allowDevLogin && <form className="loginForm" onSubmit={login}>
            <input type="email" placeholder="email dev login" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <button disabled={busy === 'login'}>{busy === 'login' ? 'Masuk...' : 'Dev login'}</button>
          </form>}
          {message && <p className="notice">{message}</p>}
        </div>
        <div className="panel">
          <div className="consoleBar"><span></span><span></span><span></span><b>member console</b></div>
          <div className="memberTop">
            <div><span>Member</span><strong>{dashboard?.customer.email || 'Belum login'}</strong></div>
            <div><span>Plan aktif</span><strong>{dashboard?.activePackage?.packageName || 'Belum ada'}</strong></div>
          </div>
          <div className="meter">
            <div><span>Gateway</span><b>{dashboard?.gateway.baseUrl || GATEWAY_BASE}</b><em>OpenAI-compatible</em></div>
            <i><u style={{ width: dashboard ? '100%' : '18%' }} /></i>
          </div>
          <div className="meter">
            <div><span>Order terakhir</span><b>{latestOrder?.packageName || 'Belum ada order'}</b><em>{latestOrder?.status || 'idle'}</em></div>
            <i><u style={{ width: latestOrder?.status === 'paid' ? '100%' : latestOrder ? '50%' : '10%' }} /></i>
          </div>
          {latestOrder?.status === 'pending' && <p className="approvalNote">Order sedang menunggu approval admin setelah pembayaran dikonfirmasi.</p>}
          <div className="keyBox">
            <span>API Key</span>
            <code>{plainKey || dashboard?.latestKey?.publicKey || 'Belum dibuat'}</code>
            <button disabled={!token || busy === `key-${selectedPackage}`} onClick={() => createKey(selectedPackage)}>{busy === `key-${selectedPackage}` ? 'Generate...' : 'Generate key'}</button>
          </div>
        </div>
      </section>

      <section id="docs" className="section docs">
        <p className="eyebrow">API docs</p>
        <h2>OpenAI-compatible request</h2>
        <pre>{`curl ${GATEWAY_BASE}/chat/completions \\
  -H "Authorization: Bearer $ELALTIDAR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4.1-mini",
    "messages": [{"role": "user", "content": "halo"}]
  }'`}</pre>
      </section>
    </main>

    <footer>(c) 2026 ElaltidarAI - Powered by LiteLLM</footer>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
