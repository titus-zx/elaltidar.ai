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
  displayName?: string;
  telegramUsername?: string | null;
  createdAt: string;
};

type Order = {
  id: string;
  customerId?: string;
  packageId: string;
  packageName: string;
  amount: number;
  status: 'pending' | 'paid';
  createdAt: string;
  paidAt: string | null;
  expiresAt: string | null;
  customer?: {
    id: string;
    email: string;
    displayName?: string;
    telegramUsername?: string | null;
  };
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
  availableModels: Array<{ id: string; name: string; packageId: string; expiresAt: string }>;
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

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function AdminApp() {
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem('elaltidar_admin_token') || '');
  const [draftToken, setDraftToken] = useState(adminToken);
  const [orders, setOrders] = useState<Order[]>([]);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  async function loadOrders(currentToken = adminToken, currentFilter = statusFilter) {
    if (!currentToken) return;
    setBusy('load-orders');
    setMessage('');
    try {
      const query = currentFilter === 'pending' ? '?status=pending' : '';
      const data = await api<{ orders: Order[] }>(`/admin/orders${query}`, { headers: { 'x-admin-token': currentToken } });
      setOrders(data.orders);
      setMessage(`${data.orders.length} order dimuat.`);
    } catch (error) {
      setMessage(`Admin load gagal: ${(error as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  useEffect(() => {
    if (!adminToken) return;
    loadOrders(adminToken, statusFilter);
  }, [adminToken, statusFilter]);

  function saveToken(event: FormEvent) {
    event.preventDefault();
    localStorage.setItem('elaltidar_admin_token', draftToken);
    setAdminToken(draftToken);
  }

  function clearToken() {
    localStorage.removeItem('elaltidar_admin_token');
    setAdminToken('');
    setDraftToken('');
    setOrders([]);
    setMessage('Admin token dihapus dari browser ini.');
  }

  async function approveOrder(orderId: string) {
    setBusy(`approve-${orderId}`);
    setMessage('');
    try {
      await api<{ order: Order }>(`/admin/orders/${orderId}/approve`, {
        method: 'POST',
        headers: { 'x-admin-token': adminToken },
        body: JSON.stringify({}),
      });
      setMessage('Order berhasil di-approve.');
      await loadOrders(adminToken, statusFilter);
    } catch (error) {
      setMessage(`Approve gagal: ${(error as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  const pendingCount = orders.filter((order) => order.status === 'pending').length;
  const paidCount = orders.filter((order) => order.status === 'paid').length;
  const grossAmount = orders.reduce((sum, order) => sum + order.amount, 0);

  return <>
    <header className="adminShellNav">
      <a className="brand" href="/">ElaltidarAI</a>
      <div className="navActions">
        <a className="login" href="/">Storefront</a>
        {adminToken && <button className="logoutButton" onClick={clearToken}>Clear token</button>}
      </div>
    </header>
    <main className="adminShell">
      <section className="adminHero">
        <div>
          <p className="eyebrow">Admin Area</p>
          <h1>Order operations console.</h1>
          <p>Approve manual payments, monitor pending orders, and keep the customer flow moving without exposing admin actions in the public dashboard.</p>
        </div>
        <form className="adminTokenCard" onSubmit={saveToken}>
          <span>Admin access</span>
          <input type="password" placeholder="ADMIN_TOKEN" value={draftToken} onChange={(event) => setDraftToken(event.target.value)} required />
          <button disabled={busy === 'load-orders'}>{adminToken ? 'Update token' : 'Unlock admin'}</button>
        </form>
      </section>

      <section className="adminStats">
        <div><span>Loaded orders</span><strong>{orders.length}</strong></div>
        <div><span>Pending</span><strong>{pendingCount}</strong></div>
        <div><span>Paid</span><strong>{paidCount}</strong></div>
        <div><span>Gross value</span><strong>{formatRupiah(grossAmount)}</strong></div>
      </section>

      <section className="adminPanel">
        <div className="adminPanelHead">
          <div>
            <p className="eyebrow">Orders</p>
            <h2>Manual approval queue</h2>
          </div>
          <div className="adminToolbar">
            <button className={statusFilter === 'pending' ? 'isActive' : ''} onClick={() => setStatusFilter('pending')}>Pending</button>
            <button className={statusFilter === 'all' ? 'isActive' : ''} onClick={() => setStatusFilter('all')}>All</button>
            <button disabled={!adminToken || busy === 'load-orders'} onClick={() => loadOrders()}>{busy === 'load-orders' ? 'Loading...' : 'Refresh'}</button>
          </div>
        </div>
        {message && <p className="notice">{message}</p>}
        <div className="adminTable">
          <div className="adminTableHeader">
            <span>Customer</span><span>Package</span><span>Amount</span><span>Status</span><span>Expires</span><span>Action</span>
          </div>
          {orders.length === 0 ? <div className="adminEmpty">Belum ada order untuk filter ini.</div> : orders.map((order) => <article className="adminOrderRow" key={order.id}>
            <div><b>{order.customer?.displayName || order.customer?.email || order.customerId}</b><small>{order.customer?.telegramUsername ? `@${order.customer.telegramUsername}` : order.customer?.email}</small></div>
            <div><b>{order.packageName}</b><small>{order.id}</small></div>
            <div>{formatRupiah(order.amount)}</div>
            <div><span className={`statusBadge ${order.status}`}>{order.status}</span></div>
            <div>{formatDate(order.expiresAt)}</div>
            <div>{order.status === 'pending' ? <button disabled={busy === `approve-${order.id}`} onClick={() => approveOrder(order.id)}>{busy === `approve-${order.id}` ? 'Approving...' : 'Approve'}</button> : <span className="paidAt">Paid {formatDate(order.paidAt)}</span>}</div>
          </article>)}
        </div>
      </section>
    </main>
  </>;
}

type MemberDashboardAppProps = {
  dashboard: Dashboard | null;
  memberName?: string;
  latestOrder: Order | null;
  packages: Package[];
  selectedPackage: string;
  plainKey: string;
  token: string;
  busy: string;
  message: string;
  publicConfig: PublicConfig;
  email: string;
  setEmail: (email: string) => void;
  login: (event: FormEvent) => void;
  logout: () => void;
  createOrder: (packageId: string) => void;
  createKey: (packageId: string) => void;
  refreshDashboard: () => void;
};

function MemberDashboardApp({ dashboard, memberName, latestOrder, packages, selectedPackage, plainKey, token, busy, message, publicConfig, email, setEmail, login, logout, createOrder, createKey, refreshDashboard }: MemberDashboardAppProps) {
  const activeQuotaParts = dashboard?.activePackage?.packageName.split(' ') || [];
  const activeQuota = activeQuotaParts[activeQuotaParts.length - 1] || '0';

  return <>
    <header className="dashboardTopbar">
      <a className="brand" href="/">ElaltidarAI</a>
      <div className="navActions">
        <a className="login" href="/">Storefront</a>
        {token && <button className="logoutButton" onClick={logout}>Logout</button>}
      </div>
    </header>
    <main className="dashboardAppShell">
      <aside className="memberSidebar appSidebar">
        <div className="memberSidebarBrand"><span>AI</span><strong>ElaltidarAI</strong></div>
        <nav>
          <a className="isActive" href="/dashboard">Dasbor</a>
          <a href="#quota">Kuota</a>
          <a href="#quota">Topup</a>
          <a href="/#docs">Dokumentasi</a>
          <a href="/admin">Admin</a>
        </nav>
        <div className="memberSidebarUser">
          <b>{memberName || 'Belum login'}</b>
          <span>{dashboard?.customer.telegramUsername ? `@${dashboard.customer.telegramUsername}` : 'Telegram login'}</span>
        </div>
      </aside>

      <section className="dashboardWorkspace">
        <div className="dashboardWorkspaceHead">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1>Dasbor member</h1>
          </div>
          {!token && <a className="telegramCta login" href="#login">Login with Telegram</a>}
        </div>

        {!dashboard ? <div id="login" className="dashboardLoginCard">
          <div>
            <h2>Login untuk masuk dashboard.</h2>
            <p>Gunakan Telegram untuk mengelola order, quota, dan API key ElaltidarAI.</p>
          </div>
          <div className="telegramLogin">
            <div data-telegram-login-slot data-size="large"></div>
            {!publicConfig.telegramBotUsername && <span>Set TELEGRAM_BOT_USERNAME di Vercel untuk mengaktifkan tombol Telegram.</span>}
          </div>
          {publicConfig.allowDevLogin && <form className="loginForm" onSubmit={login}>
            <input type="email" placeholder="email dev login" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <button disabled={busy === 'login'}>{busy === 'login' ? 'Masuk...' : 'Dev login'}</button>
          </form>}
          {message && <p className="notice">{message}</p>}
        </div> : <>
          <div className="dashboardMetricGrid">
            <article><span>Saldo Elaltidar</span><strong>Rp 0</strong><small>Manual topup soon</small></article>
            <article><span>Sisa token</span><strong>{activeQuota}</strong><small>Quota aktif</small></article>
            <article><span>Model dibeli</span><strong>{dashboard.availableModels.length}</strong><small>{packages.length} model tersedia</small></article>
          </div>

          <section className="dashboardEntitlementPanel">
            <div className="dashboardPanelHead">
              <div><span>Model access</span><h2>Model yang sudah dibeli</h2></div>
              <b>{dashboard.availableModels.length} active</b>
            </div>
            {dashboard.availableModels.length === 0 ? <p className="dashboardEmptyText">Belum ada model aktif. Beli paket token, lalu tunggu approval admin.</p> : <div className="entitlementGrid">
              {dashboard.availableModels.map((model) => <article key={`${model.packageId}-${model.expiresAt}`}>
                <strong>{model.name}</strong>
                <code>{model.id}</code>
                <span>Aktif sampai {formatDate(model.expiresAt)}</span>
              </article>)}
            </div>}
          </section>

          <section className="dashboardApiPanel">
            <div className="dashboardPanelHead">
              <div><span>API Key</span><h2>Gunakan dengan endpoint <code>{dashboard.gateway.baseUrl}</code></h2></div>
              <button disabled={!token || busy === `key-${selectedPackage}`} onClick={() => createKey(selectedPackage)}>{busy === `key-${selectedPackage}` ? 'Generate...' : 'Generate key'}</button>
            </div>
            <code>{plainKey || dashboard.latestKey?.publicKey || 'Belum dibuat'}</code>
          </section>

          <section className="dashboardUsagePanel">
            <div className="dashboardPanelHead">
              <div><span>Pemakaian token</span><h2>Statistik pemakaian API Anda</h2></div>
              <b>{latestOrder?.status || 'idle'}</b>
            </div>
            <div className="usageStats">
              <div><span>Hari ini</span><strong>0</strong><small>request</small></div>
              <div><span>Bulan ini</span><strong>0</strong><small>request</small></div>
              <div><span>Total request</span><strong>0</strong><small>request</small></div>
              <div><span>Total token</span><strong>0</strong><small>masuk / keluar</small></div>
            </div>
            <div className="meter">
              <div><span>Order terakhir</span><b>{latestOrder?.packageName || 'Belum ada order'}</b><em>{latestOrder?.status || 'idle'}</em></div>
              <i><u style={{ width: latestOrder?.status === 'paid' ? '100%' : latestOrder ? '50%' : '10%' }} /></i>
            </div>
            {latestOrder?.status === 'pending' && <p className="approvalNote">Order sedang menunggu approval admin setelah pembayaran dikonfirmasi.</p>}
          </section>

          <section id="quota" className="dashboardQuotaPanel">
            <div className="dashboardPanelHead">
              <div><span>Buy quota</span><h2>Pilih paket dari dashboard</h2></div>
            </div>
            <div className="dashboardPackageGrid">
              {packages.map((item) => <article key={item.id}>
                <span>{item.model}</span>
                <strong>{item.name}</strong>
                <p>{item.quota}</p>
                <b>{item.price}</b>
                <button disabled={busy === `order-${item.id}`} onClick={() => createOrder(item.id)}>{busy === `order-${item.id}` ? 'Membuat...' : 'Beli paket'}</button>
              </article>)}
            </div>
          </section>

          <section className="dashboardQuickActions">
            <h2>Quick actions</h2>
            <div>
              <a href="#quota">Lihat model</a>
              <a href="#quota">Buy quota</a>
              <a href="/#docs">Docs API</a>
              <button onClick={refreshDashboard}>Refresh dashboard</button>
            </div>
          </section>
          {message && <p className="notice">{message}</p>}
        </>}
      </section>
    </main>
  </>;
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
  const [path, setPath] = useState(window.location.pathname);
  const [pendingPackageId, setPendingPackageId] = useState(() => new URLSearchParams(window.location.search).get('package') || '');

  function navigate(pathname: string) {
    window.history.pushState({}, '', pathname);
    setPath(window.location.pathname);
    setPendingPackageId(new URLSearchParams(window.location.search).get('package') || '');
  }

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
    const containers = Array.from(document.querySelectorAll('[data-telegram-login-slot]'));
    if (containers.length === 0) return;
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
        navigate(pendingPackageId ? `/dashboard?package=${encodeURIComponent(pendingPackageId)}` : '/dashboard');
      } catch (error) {
        setMessage(`Login Telegram gagal: ${(error as Error).message}`);
      } finally {
        setBusy('');
      }
    };
    containers.forEach((container) => {
      container.innerHTML = '';
      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://telegram.org/js/telegram-widget.js?22';
      script.setAttribute('data-telegram-login', publicConfig.telegramBotUsername);
      script.setAttribute('data-size', container.getAttribute('data-size') || 'large');
      script.setAttribute('data-userpic', 'false');
      script.setAttribute('data-request-access', 'write');
      script.setAttribute('data-onauth', 'onTelegramAuth(user)');
      container.appendChild(script);
    });
  }, [publicConfig.telegramBotUsername, path, dashboard]);

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
      navigate(pendingPackageId ? `/dashboard?package=${encodeURIComponent(pendingPackageId)}` : '/dashboard');
    } catch (error) {
      setMessage(`Login gagal: ${(error as Error).message}`);
    } finally {
      setBusy('');
    }
  }

  function logout() {
    localStorage.removeItem('elaltidar_token');
    setToken('');
    setDashboard(null);
    setPlainKey('');
    setMessage('Session sudah keluar dari browser ini.');
    navigate('/');
  }

  async function createOrder(packageId: string) {
    if (!token) {
      window.history.pushState({}, '', `/dashboard?package=${encodeURIComponent(packageId)}`);
      setPath('/dashboard');
      setPendingPackageId(packageId);
      setMessage('Login Telegram dulu untuk melanjutkan pembelian paket.');
      return;
    }
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
  const memberName = dashboard?.customer.displayName || dashboard?.customer.email;

  useEffect(() => {
    if (!token || !pendingPackageId || !dashboard) return;
    const packageId = pendingPackageId;
    setPendingPackageId('');
    window.history.replaceState({}, '', '/dashboard');
    createOrder(packageId);
  }, [token, pendingPackageId, dashboard]);

  if (path === '/admin') return <AdminApp />;
  if (path === '/dashboard') return <MemberDashboardApp dashboard={dashboard} memberName={memberName} latestOrder={latestOrder} packages={packages} selectedPackage={selectedPackage} plainKey={plainKey} token={token} busy={busy} message={message} publicConfig={publicConfig} email={email} setEmail={setEmail} login={login} logout={logout} createOrder={createOrder} createKey={createKey} refreshDashboard={refreshDashboard} />;

  return <>
    <header className="nav">
      <a className="brand" href="#top">ElaltidarAI</a>
      <nav>
        <a href="#features">Fitur</a>
        <a href="#pricing">Harga</a>
        <a href="#docs">Docs</a>
      </nav>
      <div className="navActions">
        {memberName ? <a className="memberPill telegramMemberPill" href="/dashboard">{memberName}</a> : publicConfig.telegramBotUsername ? <div className="telegramHeaderLogin" data-telegram-login-slot data-size="medium"></div> : <a className="login telegramCta" href="/dashboard">Login with Telegram</a>}
        {memberName && <a className="login" href="/dashboard">Dashboard</a>}
        {token && <button className="logoutButton" onClick={logout}>Logout</button>}
      </div>
    </header>

    <main id="top">
      <section className="hero">
        <div>
          <p className="eyebrow">ElaltidarAI API</p>
          <h1>Akses model AI terbaik, beli token, langsung pakai.</h1>
          <p className="lead">Platform API AI Indonesia dengan paket token, dashboard member, dan endpoint OpenAI-compatible di atas gateway LiteLLM sendiri.</p>
          <div className="actions">
            <a className="primary" href="#pricing">Lihat paket</a>
            <a className="secondary" href="/dashboard">Buka dashboard</a>
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
          <article><h3>Member dashboard</h3><p>Login Telegram, lihat order, plan aktif, API key masked, dan status gateway.</p></article>
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
