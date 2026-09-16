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

const FALLBACK_PACKAGES: Package[] = [
  { id: 'starter', name: 'GPT-4.1 Mini 10M', model: 'gpt-4.1-mini', quota: '10M tokens / 3 hari', price: 'Rp 29.000', maxBudget: 29000, durationDays: 3 },
  { id: 'claude', name: 'Claude Haiku 3.5 10M', model: 'claude-3-5-haiku', quota: '10M tokens / 3 hari', price: 'Rp 39.000', maxBudget: 39000, durationDays: 3 },
  { id: 'pro', name: 'Gemini 2.0 Flash 20M', model: 'gemini-2.0-flash', quota: '20M tokens / 7 hari', price: 'Rp 25.000', maxBudget: 25000, durationDays: 7 },
  { id: 'scale', name: 'DeepSeek Chat 50M', model: 'deepseek-chat', quota: '50M tokens / 7 hari', price: 'Rp 45.000', maxBudget: 45000, durationDays: 7 },
  { id: 'qwen', name: 'Qwen Turbo 50M', model: 'qwen-turbo', quota: '50M tokens / 7 hari', price: 'Rp 35.000', maxBudget: 35000, durationDays: 7 },
];

const API_BASE = '/api';
const GATEWAY_BASE = 'https://litellm.xtrip.click/v1';

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

function App() {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState(() => localStorage.getItem('elaltidar_token') || '');
  const [packages, setPackages] = useState(FALLBACK_PACKAGES);
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
    api<{ packages: Package[] }>('/packages')
      .then((data) => setPackages(data.packages))
      .catch(() => setPackages(FALLBACK_PACKAGES));
  }, []);

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

  async function approveOrder(orderId: string) {
    setBusy(`approve-${orderId}`);
    setMessage('');
    try {
      await api<{ order: Order }>(`/orders/${orderId}/approve`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ token }),
      });
      setMessage('Order ditandai paid untuk MVP manual approval.');
      await refreshDashboard();
    } catch (error) {
      setMessage(`Approve gagal: ${(error as Error).message}`);
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
          <p className="eyebrow">AI API Platform</p>
          <h1>Jual akses multi-model AI lewat satu API.</h1>
          <p className="lead">Storefront token, member dashboard, dan OpenAI-compatible endpoint di atas LiteLLM existing: <code>{GATEWAY_BASE}</code>.</p>
          <div className="actions">
            <a className="primary" href="#pricing">Lihat paket</a>
            <a className="secondary" href="#dashboard">Buka dashboard</a>
          </div>
        </div>
        <div className="heroCard">
          <span>Live gateway</span>
          <strong>litellm.xtrip.click</strong>
          <p>Routing model, API key, budget, dan usage tetap di LiteLLM. Storefront menjadi layer bisnis dan customer dashboard.</p>
        </div>
      </section>

      <section className="modelRail" aria-label="Supported AI models">
        <p>POWERING LEADING AI MODELS</p>
        <div>
          <span>OpenAI</span><span>Anthropic</span><span>Gemini</span><span>DeepSeek</span><span>Qwen</span><span>GLM</span><span>Meta</span>
          <span>OpenAI</span><span>Anthropic</span><span>Gemini</span><span>DeepSeek</span><span>Qwen</span><span>GLM</span><span>Meta</span>
        </div>
      </section>

      <section className="stats">
        <div><strong>1 API</strong><span>OpenAI-compatible</span></div>
        <div><strong>{packages.length}</strong><span>Token packages</span></div>
        <div><strong>LiteLLM</strong><span>Budget & key backend</span></div>
        <div><strong>SQLite</strong><span>MVP customer data</span></div>
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
        <h2>Pilih quota, lanjut dari dashboard.</h2>
        <div className="plans">
          {packages.map((item) => <article className="plan" key={item.id}>
            <span>{item.model}</span>
            <h3>{item.name}</h3>
            <p>{item.quota}</p>
            <strong>{item.price}</strong>
            <button disabled={busy === `order-${item.id}`} onClick={() => createOrder(item.id)}>{busy === `order-${item.id}` ? 'Membuat...' : 'Buat order'}</button>
          </article>)}
        </div>
      </section>

      <section id="dashboard" className="section dashboard">
        <div>
          <p className="eyebrow">Member dashboard</p>
          <h2>Customer area MVP</h2>
          <p>Login email untuk membuat order, approve manual saat pembayaran sudah dicek, lalu generate key LiteLLM dengan quota paket.</p>
          <form className="loginForm" onSubmit={login}>
            <input type="email" placeholder="email customer" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <button disabled={busy === 'login'}>{busy === 'login' ? 'Masuk...' : 'Login'}</button>
          </form>
          {message && <p className="notice">{message}</p>}
        </div>
        <div className="panel">
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
          <div className="keyBox">
            <span>API Key</span>
            <code>{plainKey || dashboard?.latestKey?.publicKey || 'Belum dibuat'}</code>
            <button disabled={!token || busy === `key-${selectedPackage}`} onClick={() => createKey(selectedPackage)}>{busy === `key-${selectedPackage}` ? 'Generate...' : 'Generate key'}</button>
          </div>
          {latestOrder?.status === 'pending' && <button className="wideButton" disabled={busy === `approve-${latestOrder.id}`} onClick={() => approveOrder(latestOrder.id)}>{busy === `approve-${latestOrder.id}` ? 'Approving...' : 'Approve manual order'}</button>}
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
