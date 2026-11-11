/* ==========================================================================
   VoltPark · local-first EV smart parking
   No frameworks, no remote assets. Data comes from the local SQLite API.
   ========================================================================== */

(() => {
  'use strict';

  // -----------------------------------------------------------------------
  // Tiny DOM / formatting helpers
  // -----------------------------------------------------------------------

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ESCAPE_MAP[character]);

  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

  const pad = (number) => String(number).padStart(2, '0');
  const money = (value) => Number(value || 0).toFixed(2);
  const num = (value, digits = 1) => Number(value || 0).toFixed(digits).replace(/\.0+$/, '');

  function asDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatFullDate(date = new Date()) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 · ${WEEKDAYS[date.getDay()]}`;
  }

  function formatClock(date = new Date()) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function formatDateTime(value, options = {}) {
    const date = asDate(value);
    if (!date) return '—';
    const now = new Date();
    const sameYear = date.getFullYear() === now.getFullYear();
    const datePart = sameYear
      ? `${date.getMonth() + 1}月${date.getDate()}日`
      : `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
    if (options.dateOnly) return datePart;
    return `${datePart} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatTime(value) {
    const date = asDate(value);
    return date ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : '—';
  }

  function formatRange(start, end) {
    const startDate = asDate(start);
    const endDate = asDate(end);
    if (!startDate || !endDate) return '—';
    const sameDay = startDate.toDateString() === endDate.toDateString();
    const startText = formatDateTime(startDate);
    const endText = sameDay ? formatTime(endDate) : formatDateTime(endDate);
    return `${startText} – ${endText}`;
  }

  function relativeTime(value) {
    const date = asDate(value);
    if (!date) return '';
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const abs = Math.abs(seconds);
    const suffix = seconds >= 0 ? '后' : '前';
    if (abs < 45) return '刚刚';
    if (abs < 3600) return `${Math.floor(abs / 60)} 分钟${suffix}`;
    if (abs < 86400) return `${Math.floor(abs / 3600)} 小时${suffix}`;
    if (abs < 86400 * 7) return `${Math.floor(abs / 86400)} 天${suffix}`;
    return formatDateTime(date, { dateOnly: true });
  }

  function humanDuration(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    if (total < 60) return `${total} 分钟`;
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
  }

  function dateInputValue(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function timeInputValue(date) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 5) return '夜深了';
    if (hour < 11) return '早上好';
    if (hour < 14) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }

  function safeColor(value) {
    return /^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? value : '#24352F';
  }

  function safeNumber(value, digits = 1) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toFixed(digits) : '0';
  }

  // -----------------------------------------------------------------------
  // SVG icon library
  // -----------------------------------------------------------------------

  const ICONS = {
    dashboard: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>',
    map: '<path d="M20 10c0 5.2-8 11-8 11S4 15.2 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 9.5h17"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01"/>',
    calendarCheck: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 9.5h17M8 15.5l2.5 2.5 4.5-5"/>',
    bolt: '<path d="m13.2 2.2-8.1 11.4h5.7l-.8 8.2 8.2-12h-5.8l.8-7.6Z" fill="currentColor" stroke="none"/>',
    car: '<path d="M5.3 16.5 6.7 10c.3-1.2 1.2-2 2.4-2.3l1.4-.4 1.2-2.8c.4-.9 1.2-1.5 2.2-1.5h2.3c1 0 1.9.6 2.3 1.5l1.1 2.5 1.7.5c1.1.3 1.9 1.2 2.1 2.3l.8 6.7"/><path d="M4.3 16.5h15.5M6.2 16.5v2.2M18.2 16.5v2.2M7 12h10"/><circle cx="8" cy="16.5" r="1.7" fill="currentColor" stroke="none"/><circle cx="16.2" cy="16.5" r="1.7" fill="currentColor" stroke="none"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    logout: '<path d="M9 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4M16 8l4 4-4 4M20 12H9"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    gauge: '<path d="M4.2 17.5a8 8 0 1 1 15.6 0"/><path d="m12 13 3.2-3.2M7 18h10"/>',
    wallet: '<path d="M4 6.5h13A2.5 2.5 0 0 1 19.5 9v9A2.5 2.5 0 0 1 17 20.5H6A2 2 0 0 1 4 18.5v-12Z"/><path d="M4 7V6a2 2 0 0 1 2-2h10.5M15.5 13.5h4"/>',
    leaf: '<path d="M20 4C12.5 3.5 5 7 5 14.2c0 2.2.8 4 2.2 5.2C8.5 21 11 21 12.8 20.4 19.5 18.3 20.5 10.3 20 4Z"/><path d="M5.5 20c1.7-5 5.2-8.6 9.5-11"/>',
    battery: '<rect x="3" y="7" width="16" height="10" rx="2.5"/><path d="M21 10.5v3M6.5 10.5v3M10 10.5v3"/>',
    plug: '<path d="M8 3v5M16 3v5M6 8h12v2.5a6 6 0 0 1-12 0V8ZM12 16.5V22"/>',
    parking: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M10 17V7h3.2a3.2 3.2 0 0 1 0 6.4H10"/>',
    alert: '<path d="M12 3.5 21 20H3L12 3.5Z"/><path d="M12 9v5M12 17.2v.1"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
    refresh: '<path d="M20 6v5h-5M4 18v-5h5"/><path d="M6.1 9A7.5 7.5 0 0 1 19 7l1 4M4 13l1 4a7.5 7.5 0 0 0 12.9-2"/>',
    download: '<path d="M12 3v12m-4.5-4.5L12 15l4.5-4.5M4 20h16"/>',
    trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M17.5 14.2A6.5 6.5 0 0 1 22 20"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    eye: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18M10.5 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.5 3.2M6.7 6.8C4 8.6 2.5 12 2.5 12S6 18 12 18c1 0 1.9-.2 2.8-.4M10.2 10.3a2.5 2.5 0 0 0 3.5 3.5"/>',
    shield: '<path d="M12 3 20 6v5.5c0 4.7-3.2 7.9-8 9.5-4.8-1.6-8-4.8-8-9.5V6l8-3Z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
    activity: '<path d="M3 12h4l2.2-6 4.2 12 2.4-6H21"/>',
    power: '<path d="M12 2v9M6.3 5.8a8.5 8.5 0 1 0 11.4 0"/>',
    timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.6 1.7M9 2h6M12 2v4"/>',
    receipt: '<path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.1"/>',
    compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
    station: '<rect x="4" y="3.5" width="11" height="17" rx="2.5"/><path d="M7 7h5M7 11h5M17 8h2.5v8.5a2 2 0 0 1-4 0V11"/>',
    creditCard: '<rect x="2.5" y="5.5" width="19" height="13" rx="3"/><path d="M2.5 10h19M6 14.5h4"/>',
    home: '<path d="m3.5 10.5 8.5-7 8.5 7V20a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-9.5Z"/><path d="M9 21v-6h6v6"/>',
    mailOpen: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9.5Z"/><path d="m3 10 9 6 9-6"/>',
    spark: '<path d="M12 2.5 13.8 9l6.2 1.8-6.2 1.8L12 19l-1.8-6.4L4 10.8 10.2 9 12 2.5Z" fill="currentColor" stroke="none"/>'
  };

  function icon(name, extraClass = '') {
    const markup = ICONS[name] || ICONS.info;
    return `<svg class="icon ${extraClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${markup}</svg>`;
  }

  // -----------------------------------------------------------------------
  // App state
  // -----------------------------------------------------------------------

  const state = {
    user: null,
    page: null,
    requestSeq: 0,
    authMode: 'login',
    dashboard: null,
    slotsData: null,
    reservationsData: null,
    sessionsData: null,
    vehiclesData: null,
    adminData: null,
    filters: { zone: 'all', kind: 'all', query: '' },
    resTab: 'upcoming',
    selectedSlotId: null,
    modalOpen: false,
    lastFocused: null,
    pollTimer: null,
    clockTimer: null,
    busy: false
  };

  const pageEl = $('#page');
  const authView = $('#auth-view');
  const appShell = $('#app-shell');
  const modalRoot = $('#modal-root');
  const toastRoot = $('#toast-root');

  const PAGE_TITLES = {
    dashboard: '总览',
    map: '车位地图',
    reservations: '预约管理',
    sessions: '充电记录',
    vehicles: '我的爱车',
    admin: '运营中心'
  };

  const SLOT_STATES = {
    available: { label: '可预约', pill: 'live' },
    occupied: { label: '已占用', pill: 'done' },
    charging: { label: '充电中', pill: 'live' },
    reserved: { label: '已预约', pill: 'reserved' },
    maintenance: { label: '维护中', pill: 'maintenance' }
  };

  const STATUS_LABELS = {
    reserved: '待到店',
    active: '进行中',
    completed: '已完成',
    cancelled: '已取消',
    expired: '已过期'
  };

  const STATUS_CLASS = {
    reserved: 'status-pill--reserved',
    active: 'status-pill--live',
    completed: 'status-pill--done',
    cancelled: 'status-pill--cancelled',
    expired: 'status-pill--done'
  };

  // -----------------------------------------------------------------------
  // API / session plumbing
  // -----------------------------------------------------------------------

  class ApiFailure extends Error {}

  async function api(path, { method = 'GET', body } = {}) {
    const config = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      config.headers['Content-Type'] = 'application/json';
      config.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(`/api${path}`, config);
    } catch (error) {
      throw new ApiFailure('无法连接本地服务，请确认程序仍在运行');
    }

    let payload = {};
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      payload = await response.json().catch(() => ({}));
    }

    if (response.status === 401 && !path.startsWith('/auth/')) {
      showAuth();
      state.user = null;
      throw new ApiFailure(payload.error || '登录状态已失效，请重新登录');
    }
    if (!response.ok) {
      throw new ApiFailure(payload.error || '操作没有完成，请稍后重试');
    }
    return payload;
  }

  function clearDataCache(includeVehicles = false) {
    state.dashboard = null;
    state.slotsData = null;
    state.reservationsData = null;
    state.sessionsData = null;
    state.adminData = null;
    if (includeVehicles) state.vehiclesData = null;
  }

  async function ensureVehicles() {
    if (!state.vehiclesData) {
      state.vehiclesData = await api('/vehicles');
    }
    return state.vehiclesData.vehicles;
  }

  async function ensureSlots() {
    if (!state.slotsData) {
      state.slotsData = await api('/slots');
    }
    return state.slotsData;
  }

  // -----------------------------------------------------------------------
  // Boot / auth display
  // -----------------------------------------------------------------------

  async function init() {
    setupClock();
    bindEvents();
    setAuthMode('login', { focus: false });
    const bootStarted = Date.now();

    try {
      const result = await api('/auth/me');
      if (result.authenticated) {
        state.user = result.user;
        await showApp({ initial: true });
      } else {
        showAuth();
      }
    } catch (error) {
      console.error(error);
      showAuth();
      toast(error.message || '读取本地账户失败', 'error');
    } finally {
      const elapsed = Date.now() - bootStarted;
      window.setTimeout(hideBoot, Math.max(300, 620 - elapsed));
    }
  }

  function hideBoot() {
    const boot = $('#boot-screen');
    if (!boot) return;
    boot.classList.add('is-leaving');
    window.setTimeout(() => { boot.hidden = true; }, 480);
  }

  function showAuth() {
    stopPolling();
    closeModal({ restoreFocus: false });
    state.user = null;
    state.page = null;
    state.requestSeq += 1;
    appShell.hidden = true;
    authView.hidden = false;
    if (pageEl) pageEl.innerHTML = '';
    document.title = 'VoltPark · 电动车智能停放';
    updateAuthMeta();
    const errorBox = $('#auth-error');
    if (errorBox) errorBox.hidden = true;
    window.setTimeout(() => {
      const email = $('#auth-email');
      if (email && !state.user) email.focus({ preventScroll: true });
    }, 120);
  }

  async function showApp({ initial = false } = {}) {
    authView.hidden = true;
    appShell.hidden = false;
    applyUserChrome();
    updateNotifyDot();

    if (initial) {
      if (!location.hash || !/^#\/(dashboard|map|reservations|sessions|vehicles|admin)$/.test(location.hash)) {
        history.replaceState(null, '', '#/dashboard');
      }
      await route();
      startPolling();
    }
  }

  async function route() {
    if (!state.user) return;
    const raw = (location.hash || '#/dashboard').replace(/^#\/?/, '').split('?')[0];
    let page = PAGE_TITLES[raw] ? raw : 'dashboard';
    if (page === 'admin' && state.user.role !== 'admin') page = 'dashboard';
    if (location.hash !== `#/${page}`) {
      history.replaceState(null, '', `#/${page}`);
    }
    await loadPage(page);
  }

  function navigate(page) {
    if (!state.user) return;
    if (page === 'admin' && state.user.role !== 'admin') return;
    if (state.page === page && location.hash === `#/${page}`) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (location.hash === `#/${page}`) {
      loadPage(page, { force: true });
    } else {
      location.hash = `#/${page}`;
    }
  }

  async function goAndReload(page) {
    clearDataCache(true);
    if (location.hash !== `#/${page}`) {
      location.hash = `#/${page}`;
    } else {
      await loadPage(page, { force: true });
    }
  }

  // -----------------------------------------------------------------------
  // Auth form
  // -----------------------------------------------------------------------

  function updateAuthMeta() {
    const dateEl = $('#auth-date');
    if (dateEl) {
      const now = new Date();
      dateEl.textContent = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())} / ${WEEKDAYS[now.getDay()]}`;
    }
  }

  function setAuthMode(mode, { focus = true } = {}) {
    if (!['login', 'register'].includes(mode)) mode = 'login';
    state.authMode = mode;
    const isRegister = mode === 'register';

    $$('#auth-tabs .auth-tab').forEach((tab) => {
      const active = tab.dataset.authTab === mode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    $$('.register-field, #password-hint').forEach((element) => { element.hidden = !isRegister; });
    const nameInput = $('#auth-name');
    if (nameInput) nameInput.required = isRegister;
    const password = $('#auth-password');
    if (password) password.autocomplete = isRegister ? 'new-password' : 'current-password';
    const title = $('#auth-title');
    const subtitle = $('#auth-subtitle');
    const eyebrow = $('.auth-heading .eyebrow');
    const submitLabel = $('#auth-submit span');
    if (isRegister) {
      if (title) title.textContent = '加入 VoltPark。';
      if (subtitle) subtitle.textContent = '创建你的本地账户，开始智能停车与充电。';
      if (eyebrow) eyebrow.textContent = 'CREATE YOUR ACCOUNT';
      if (submitLabel) submitLabel.textContent = '创建账户';
    } else {
      if (title) title.textContent = '欢迎回来。';
      if (subtitle) subtitle.textContent = '登录你的 VoltPark 账户，查看今天的车位。';
      if (eyebrow) eyebrow.textContent = 'WELCOME BACK';
      if (submitLabel) submitLabel.textContent = '登录';
    }
    setAuthError('');
    if (focus) {
      const target = isRegister ? $('#auth-name') : $('#auth-email');
      target?.focus({ preventScroll: true });
    }
  }

  function setAuthError(message) {
    const errorEl = $('#auth-error');
    if (!errorEl) return;
    errorEl.hidden = !message;
    errorEl.textContent = message || '';
  }

  function setAuthBusy(busy) {
    const button = $('#auth-submit');
    if (!button) return;
    button.disabled = busy;
    button.classList.toggle('is-loading', busy);
    const label = button.querySelector('span');
    if (!button.dataset.originalLabel) button.dataset.originalLabel = label?.textContent || '登录';
    if (label) label.textContent = busy ? '正在验证…' : button.dataset.originalLabel;
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const name = $('#auth-name')?.value.trim() || '';
    const email = $('#auth-email')?.value.trim() || '';
    const password = $('#auth-password')?.value || '';
    setAuthError('');

    if (!email) { setAuthError('请输入邮箱地址'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setAuthError('邮箱格式看起来不太对'); return; }
    if (!password) { setAuthError('请输入密码'); return; }
    if (state.authMode === 'register') {
      if (name.length < 2) { setAuthError('称呼至少需要 2 个字符'); return; }
      if (password.length < 8) { setAuthError('密码至少需要 8 位'); return; }
      if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) { setAuthError('密码需同时包含字母和数字'); return; }
    }

    setAuthBusy(true);
    try {
      const payload = state.authMode === 'register'
        ? { name, email, password }
        : { email, password };
      const result = await api(`/auth/${state.authMode}`, { method: 'POST', body: payload });
      state.user = result.user;
      form.reset();
      await showApp({ initial: true });
      updateAuthMeta();
      toast(state.authMode === 'register' ? `账户已创建，欢迎你，${result.user.name}` : `欢迎回来，${result.user.name}`);
    } catch (error) {
      setAuthError(error.message || '登录失败，请重试');
    } finally {
      setAuthBusy(false);
    }
  }

  async function doLogout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (error) {
      console.warn(error);
    }
    closeModal({ restoreFocus: false });
    clearDataCache(true);
    state.user = null;
    showAuth();
    setAuthMode('login', { focus: false });
    history.replaceState(null, '', location.pathname);
    toast('已安全退出', 'info');
  }

  // -----------------------------------------------------------------------
  // Chrome (sidebar, nav, clock)
  // -----------------------------------------------------------------------

  function applyUserChrome() {
    if (!state.user) return;
    const initial = Array.from(state.user.name || 'V')[0] || 'V';
    const color = safeColor(state.user.avatarColor);
    const sideAvatar = $('#side-avatar');
    const topAvatar = $('#top-avatar');
    if (sideAvatar) {
      sideAvatar.textContent = initial;
      sideAvatar.style.background = color;
    }
    if (topAvatar) {
      topAvatar.textContent = initial;
      topAvatar.style.background = color;
      topAvatar.style.color = '#132019';
    }
    const sideName = $('#side-user-name');
    const sideEmail = $('#side-user-email');
    if (sideName) sideName.textContent = state.user.name;
    if (sideEmail) sideEmail.textContent = state.user.email;
    $('#side-user')?.setAttribute('aria-label', `打开 ${state.user.name} 的账户信息`);
    renderSideNav();
  }

  function renderSideNav() {
    const nav = $('#side-nav');
    if (!nav || !state.user) return;
    const items = [
      { page: 'dashboard', label: '总览', short: '首页', icon: 'dashboard' },
      { page: 'map', label: '车位地图', short: '车位', icon: 'map', badge: 'map' },
      { page: 'reservations', label: '预约管理', short: '预约', icon: 'calendar', badge: 'reservations' },
      { page: 'sessions', label: '充电记录', short: '充电', icon: 'bolt' },
      { page: 'vehicles', label: '我的爱车', short: '爱车', icon: 'car' }
    ];
    if (state.user.role === 'admin') {
      items.push({ page: 'admin', label: '运营中心', short: '运营', icon: 'sliders', admin: true });
    }
    nav.innerHTML = `
      <div class="side-nav-label">WORKSPACE</div>
      ${items.map((item) => `
        <button type="button" class="nav-item${item.admin ? ' nav-item--admin' : ''}" data-action="nav" data-page="${item.page}">
          ${icon(item.icon)}
          <span class="nav-label"><span class="nav-label-full">${esc(item.label)}</span><span class="nav-label-compact">${esc(item.short)}</span></span>
          ${item.badge ? `<b class="nav-badge" data-nav-badge="${item.badge}" hidden></b>` : ''}
        </button>
      `).join('')}
    `;
    setActiveNav(state.page || 'dashboard');
    updateNavBadges();
  }

  function setActiveNav(page) {
    $$('#side-nav .nav-item').forEach((item) => {
      item.classList.toggle('is-active', item.dataset.page === page);
    });
  }

  function updateNavBadges() {
    const mapBadge = $('[data-nav-badge="map"]');
    const resBadge = $('[data-nav-badge="reservations"]');
    let available = null;
    if (state.dashboard?.stats) available = state.dashboard.stats.available;
    else if (state.slotsData?.zones) {
      available = state.slotsData.zones.reduce((sum, zone) => sum + zone.available, 0);
    } else if (state.adminData?.stats) {
      const slots = state.adminData.slots || [];
      available = slots.filter((slot) => slot.state === 'available').length;
    }
    if (mapBadge) {
      mapBadge.hidden = available === null;
      if (available !== null) mapBadge.textContent = String(available);
    }

    let upcoming = null;
    if (state.reservationsData) {
      upcoming = (state.reservationsData.upcoming?.length || 0) + (state.reservationsData.active?.length || 0);
    } else if (state.dashboard) {
      upcoming = state.dashboard.upcomingReservation ? 1 : 0;
    }
    if (resBadge) {
      resBadge.hidden = !upcoming;
      if (upcoming) resBadge.textContent = String(upcoming);
    }
  }

  function updateGlobalSummary() {
    updateNavBadges();
    updateNotifyDot();

    const weekly = state.dashboard?.weekly || state.sessionsData?.weekly || null;
    const today = weekly?.find((point) => point.isToday);
    const active = state.dashboard?.activeSession
      || state.slotsData?.activeSession
      || state.sessionsData?.activeSession
      || null;
    const todayEnergy = Number(today?.energy || 0) + Number(active?.energyKwh || 0);
    const energyValue = $('#side-energy-value');
    const energyBar = $('#side-energy-bar');
    const energyCaption = $('#side-energy-caption');
    if (energyValue) energyValue.textContent = `${num(todayEnergy, 1)} kWh`;
    if (energyBar) energyBar.style.width = `${Math.min(100, Math.max(5, (todayEnergy / 48) * 100))}%`;
    if (energyCaption) {
      energyCaption.textContent = active
        ? (Number(active.powerKw) > 0
          ? `${active.slot.code} 正在充电 · ${num(active.powerKw, 0)} kW`
          : `${active.slot.code} 正在停车 · 计时中`)
        : todayEnergy > 0
          ? '今日充电累计 · 数据来自本地账户'
          : '今日还没有充电记录';
    }
  }

  function updateNotifyDot() {
    const dot = $('#notify-dot');
    if (!dot) return;
    const active = state.dashboard?.activeSession || state.slotsData?.activeSession || state.sessionsData?.activeSession;
    const reservation = state.dashboard?.upcomingReservation;
    dot.hidden = !(active || reservation);
  }

  function setupClock() {
    const tick = () => {
      const now = new Date();
      const topDate = $('#top-date');
      const topClock = $('#top-clock');
      if (topDate) topDate.textContent = `${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 ${WEEKDAYS[now.getDay()]}`;
      if (topClock) topClock.textContent = formatClock(now);
      const authDate = $('#auth-date');
      if (authDate) authDate.textContent = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())} / ${WEEKDAYS[now.getDay()]}`;
      $$('[data-live-timer]').forEach((element) => {
        const started = asDate(element.dataset.start);
        if (!started) return;
        const minutes = Math.max(1, Math.round((Date.now() - started.getTime()) / 60000));
        element.textContent = humanDuration(minutes);
      });
    };
    tick();
    state.clockTimer = window.setInterval(tick, 1000);
  }

  // -----------------------------------------------------------------------
  // Page loading and routing
  // -----------------------------------------------------------------------

  async function loadPage(page, { force = false, background = false } = {}) {
    if (!state.user) return;
    if (page === 'admin' && state.user.role !== 'admin') return;
    if (!background && !force && state.page === page) {
      setActiveNav(page);
      return;
    }
    if (background && (state.modalOpen || document.hidden)) return;
    const focused = document.activeElement;
    if (background && focused && ['INPUT', 'SELECT', 'TEXTAREA'].includes(focused.tagName)) return;

    const sequence = ++state.requestSeq;
    state.page = page;
    setActiveNav(page);
    document.title = `${PAGE_TITLES[page]} · VoltPark`;

    if (!background) {
      pageEl.innerHTML = pageLoader();
    } else {
      pageEl.classList.add('loading-placeholder');
    }

    try {
      if (page === 'dashboard') {
        state.dashboard = await api('/dashboard');
      } else if (page === 'map') {
        const [slotsData, vehiclesData] = await Promise.all([api('/slots'), api('/vehicles')]);
        state.slotsData = slotsData;
        state.vehiclesData = vehiclesData;
      } else if (page === 'reservations') {
        const [reservationsData, vehiclesData] = await Promise.all([api('/reservations'), api('/vehicles')]);
        state.reservationsData = reservationsData;
        state.vehiclesData = vehiclesData;
      } else if (page === 'sessions') {
        state.sessionsData = await api('/sessions');
      } else if (page === 'vehicles') {
        state.vehiclesData = await api('/vehicles');
      } else if (page === 'admin') {
        state.adminData = await api('/admin/overview');
      }
      if (sequence !== state.requestSeq) return;

      pageEl.classList.remove('loading-placeholder');
      renderPage(page);
      updateGlobalSummary();
    } catch (error) {
      pageEl.classList.remove('loading-placeholder');
      if (error.message?.includes('登录') || error.message?.includes('无法连接')) {
        if (error.message?.includes('无法连接')) {
          pageEl.innerHTML = renderPageError(error.message);
        }
        return;
      }
      if (!background) {
        pageEl.innerHTML = renderPageError(error.message || '页面加载失败');
      }
    }
  }

  function pageLoader() {
    return `
      <div class="page-loader">
        <div class="loader-orbit"></div>
        <span>SYNCING WITH PARKING LOT</span>
      </div>
    `;
  }

  function renderPageError(message) {
    return `
      <div class="page-head">
        <div class="page-head__main">
          <span class="eyebrow">SOMETHING WENT WRONG</span>
          <h1 class="page-title">暂时没连上。</h1>
          <p class="page-subtitle">${esc(message || '请稍后重试')}</p>
        </div>
      </div>
      <div class="panel">
        <div class="empty-state">
          <div class="empty-state__icon">${icon('alert')}</div>
          <h3>数据没有加载出来</h3>
          <p>本地服务可能正在重新启动。确认程序运行后，再试一次。</p>
          <button type="button" class="btn btn--dark" data-action="retry">${icon('refresh')}重新加载</button>
        </div>
      </div>
    `;
  }

  function renderPage(page) {
    updateNavBadges();
    if (page === 'dashboard') renderDashboard();
    else if (page === 'map') renderMapPage();
    else if (page === 'reservations') renderReservationsPage();
    else if (page === 'sessions') renderSessionsPage();
    else if (page === 'vehicles') renderVehiclesPage();
    else if (page === 'admin') renderAdminPage();
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = window.setInterval(() => {
      if (!state.user || state.modalOpen || document.hidden) return;
      const activeTag = document.activeElement?.tagName;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(activeTag)) return;
      if (['dashboard', 'map', 'reservations', 'sessions', 'admin'].includes(state.page)) {
        loadPage(state.page, { background: true });
      }
    }, 35000);
  }

  function stopPolling() {
    if (state.pollTimer) {
      window.clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Dashboard
  // -----------------------------------------------------------------------

  function renderDashboard() {
    const data = state.dashboard;
    if (!data) return;
    const stats = data.stats;
    const active = data.activeSession;
    const availability = stats.serviceableSlots ? Math.round((stats.available / stats.serviceableSlots) * 100) : 0;
    const weeklyPoints = data.weekly || [];
    const weekTotal = weeklyPoints.reduce((sum, point) => sum + Number(point.energy || 0), 0);
    const todayEnergy = weeklyPoints.find((point) => point.isToday)?.energy || 0;
    const miniBars = weeklyPoints.map((point) => {
      const max = Math.max(...weeklyPoints.map((item) => Number(item.energy || 0)), 1);
      const height = Math.max(4, Math.round((Number(point.energy || 0) / max) * 22));
      return `<i class="${point.isToday ? 'is-hot' : ''}" style="height:${height}px"></i>`;
    }).join('');

    pageEl.innerHTML = `
      <div class="page-head dashboard-head">
        <div class="page-head__main">
          <div class="page-date">${icon('calendar')} ${formatFullDate()}<span class="date-rule"></span><span class="live-tag">系统在线</span></div>
          <h1 class="page-title">${greeting()}，${esc(data.user.name)}<span class="title-dot">.</span></h1>
          <p class="page-subtitle">B1 层有 <strong>${stats.available}</strong> 个空闲车位，${stats.chargingFree} 个充电桩正在等你。</p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn--outline" data-action="refresh">${icon('refresh')}刷新</button>
          <button type="button" class="btn btn--lime" data-action="open-reserve">${icon('plus')}预约车位</button>
        </div>
      </div>

      <section class="stats-grid" aria-label="停车数据概览">
        <article class="stat-card stat-card--dark">
          <div class="stat-top"><span class="stat-label">可用车位</span><span class="stat-icon">${icon('parking')}</span></div>
          <div class="stat-value">${stats.available}<small>/ ${stats.serviceableSlots}</small></div>
          <div class="stat-meta"><span class="stat-chip">${stats.occupancyRate}%</span> 使用率 · 实时更新</div>
          <div class="stat-track"><i style="width:${availability}%"></i></div>
        </article>
        <article class="stat-card">
          <div class="stat-top"><span class="stat-label">空闲充电桩</span><span class="stat-icon">${icon('bolt')}</span></div>
          <div class="stat-value">${stats.chargingFree}<small>/ ${stats.chargingTotal}</small></div>
          <div class="stat-meta"><span class="stat-chip">${stats.chargingNow} 台</span> 正在充电
            <span class="stat-mini-bars">${miniBars}</span>
          </div>
          <div class="stat-track"><i style="width:${stats.chargingTotal ? Math.round((stats.chargingFree / stats.chargingTotal) * 100) : 0}%"></i></div>
        </article>
        <article class="stat-card">
          <div class="stat-top"><span class="stat-label">本月充电</span><span class="stat-icon">${icon('leaf')}</span></div>
          <div class="stat-value">${num(stats.monthEnergy, 1)}<small>kWh</small></div>
          <div class="stat-meta"><span class="stat-chip">≈ ${num(stats.savedCarbon, 1)} kg</span> 减少碳排放</div>
          <div class="stat-track"><i style="width:${Math.min(100, Math.max(5, stats.monthEnergy / 2))}%"></i></div>
        </article>
        <article class="stat-card">
          <div class="stat-top"><span class="stat-label">${active ? '当前订单' : '今日充电'}</span><span class="stat-icon">${icon(active ? 'wallet' : 'timer')}</span></div>
          <div class="stat-value">${active ? money(active.totalFee) : num(todayEnergy, 1)}<small>${active ? '元' : 'kWh'}</small></div>
          <div class="stat-meta">${active
            ? `<span class="stat-chip">${esc(active.slot.code)}</span> ${humanDuration(active.durationMinutes)} · ${Number(active.powerKw) > 0 ? '充电中' : '停车中'}`
            : '<span class="stat-chip">今日</span> 暂无进行中订单'}</div>
          <div class="stat-track"><i style="width:${active ? Math.max(4, active.progressPercent) : Math.min(100, todayEnergy * 2)}%"></i></div>
        </article>
      </section>

      <div class="dash-layout">
        <div class="dash-main">
          <section class="panel lot-panel">
            <div class="panel-head">
              <div>
                <span class="panel-kicker">LIVE OCCUPANCY / B1</span>
                <h2 class="panel-title">车位实况</h2>
                <p class="panel-sub">每 35 秒同步一次 · 点击车位可查看详情</p>
              </div>
              <button type="button" class="panel-link" data-action="nav" data-page="map">完整地图 ${icon('chevronRight')}</button>
            </div>
            <div class="zone-grid">
              ${data.zones.map((zone) => renderZoneBlock(zone, data.slots)).join('')}
            </div>
            <div class="legend">
              <span class="legend-item"><i class="legend-dot"></i>空闲</span>
              <span class="legend-item"><i class="legend-dot legend-dot--occupied"></i>已占用</span>
              <span class="legend-item"><i class="legend-dot legend-dot--charging"></i>充电中</span>
              <span class="legend-item"><i class="legend-dot legend-dot--reserved"></i>已预约</span>
              <span class="legend-item"><i class="legend-dot legend-dot--maintenance"></i>维护</span>
              <span class="legend-live"><span class="live-pulse"></span> LIVE DATA</span>
            </div>
          </section>

          <div class="lower-grid">
            <section class="panel activity-panel">
              <div class="panel-head">
                <div><span class="panel-kicker">YOUR FLOW</span><h2 class="panel-title">最近动态</h2></div>
                <button type="button" class="panel-link" data-action="nav" data-page="sessions">全部记录 ${icon('chevronRight')}</button>
              </div>
              <div class="activity-list">${renderActivityList(data.activity)}</div>
            </section>
            <section class="panel chart-panel">
              <div class="chart-head">
                <div><span class="panel-kicker">ENERGY / 7 DAYS</span><h2 class="panel-title">本周充电</h2></div>
                <div class="chart-total"><strong>${num(weekTotal, 1)}</strong><span>kWh TOTAL</span></div>
              </div>
              ${renderWeekChart(weeklyPoints)}
              <div class="chart-foot"><span>今日 ${num(todayEnergy, 1)} kWh</span><span>累计减排 <strong>${num(weekTotal * 0.501, 1)} kg</strong></span></div>
            </section>
          </div>
        </div>

        ${active ? renderActiveSessionPanel(active, data.upcomingReservation) : renderEmptySessionPanel(data)}
      </div>
    `;
  }

  function renderZoneBlock(zone, slots) {
    const zoneSlots = slots.filter((slot) => slot.zone === zone.id);
    return `
      <div class="zone-block" data-zone="${esc(zone.id)}">
        <div class="zone-head">
          <span class="zone-letter">${esc(zone.id)}</span>
          <div class="zone-title">
            <strong>${esc(zone.name)}</strong>
            <span>${zone.available} 空闲 · ${zone.occupied} 占用</span>
          </div>
          <span class="zone-count"><b>${zone.available}</b>/${zone.total}</span>
        </div>
        <div class="slot-mini-grid">
          ${zoneSlots.map((slot) => `
            <button type="button" class="slot-mini is-${slot.state}${slot.isMine ? ' is-mine' : ''}" data-action="select-slot" data-slot-id="${slot.id}" title="${esc(slot.code)} · ${SLOT_STATES[slot.state]?.label || ''}">
              <span>${esc(slot.code)}</span>
              <span>${SLOT_STATES[slot.state]?.label || ''}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderActiveSessionPanel(active, upcoming) {
    const charging = Number(active.powerKw) > 0;
    const progress = charging
      ? Math.max(3, Math.min(99, Number(active.progressPercent) || 3))
      : Math.max(4, Math.min(96, Math.round((active.durationMinutes % 120) / 1.2)));
    return `
      <section class="panel session-panel">
        <div class="panel-head">
          <div class="session-status"><span class="live-pulse"></span> ${charging ? 'LIVE CHARGING SESSION' : 'LIVE PARKING SESSION'}</div>
          <span class="session-slot-badge"><i></i>${esc(active.slot.code)}</span>
        </div>
        <h2 class="session-title">${charging ? '正在充电' : '正在停车'} <span>· ${esc(active.vehicle.model)}</span></h2>
        <div class="charge-ring" style="--progress:${progress}">
          <div class="charge-ring__inner">
            <strong>${charging ? num(active.energyKwh, 1) : Math.round(active.durationMinutes)}</strong>
            <span>${charging ? 'KWH DELIVERED' : 'MINUTES PARKED'}</span>
          </div>
          <span class="charge-ring__pulse">${icon(charging ? 'bolt' : 'parking')}</span>
        </div>
        <div class="session-vehicle">
          <div class="session-vehicle__main">
            <span class="session-vehicle__icon">${icon('car')}</span>
            <div><strong>${esc(active.vehicle.plate)}</strong><span>${charging ? `${esc(active.vehicle.connector)} · ` : '标准车位 · '}${esc(active.slot.zone)} 区</span></div>
          </div>
          <span class="session-battery">${charging ? `+${safeNumber(active.batteryGainPercent, 0)}%` : '计时中'}</span>
        </div>
        <div class="session-metrics">
          <div class="session-metric"><span>${charging ? '充电功率' : '停车费率'}</span><strong>${charging ? `${num(active.powerKw, 0)}<small>kW</small>` : `¥${num(active.slot.pricePerHour, 0)}<small>/h</small>`}</strong></div>
          <div class="session-metric"><span>已进行</span><strong data-live-timer data-start="${esc(active.startedAt)}">${humanDuration(active.durationMinutes)}</strong></div>
          <div class="session-metric"><span>预计费用</span><strong>¥${money(active.totalFee)}</strong></div>
        </div>
        <div class="session-bill">
          <div><span>预计结算金额</span><strong>¥${money(active.totalFee)}</strong></div>
          <small>${charging ? '含电费与服务费' : '按停车时长计费'}</small>
        </div>
        <button type="button" class="btn btn--lime btn--block" data-action="end-session" data-session-id="${active.id}">结束停车并结算 ${icon('arrow')}</button>
        <p class="session-note">停车费按 30 分钟计费，结束时以实际用量为准</p>
        ${upcoming ? `
          <div class="session-upcoming">
            <span class="session-upcoming__icon">${icon('calendarCheck')}</span>
            <div><strong>下一程已安排 · ${esc(upcoming.slot.code)}</strong><span>${formatRange(upcoming.startAt, upcoming.endAt)}</span></div>
            <button type="button" class="panel-link" data-action="nav" data-page="reservations">${icon('chevronRight')}</button>
          </div>` : ''}
      </section>
    `;
  }

  function renderEmptySessionPanel(data) {
    const upcoming = data.upcomingReservation;
    return `
      <section class="panel session-panel">
        <div class="panel-head">
          <div class="session-status"><span class="live-pulse"></span> READY WHEN YOU ARE</div>
          <span class="session-slot-badge"><i></i>NO ACTIVE SESSION</span>
        </div>
        <div class="no-session">
          <div class="no-session__mark">${icon('car')}</div>
          <h3>车辆已就位？</h3>
          <p>选择一个空闲车位，立即开始计时。快充车位会同步启动充电。</p>
          <button type="button" class="btn btn--lime" data-action="nav" data-page="map">${icon('map')}寻找空闲车位</button>
          <div class="recommend-list">
            ${(data.recommendations || []).map((slot) => `
              <button type="button" class="recommend-item" data-action="select-slot" data-slot-id="${slot.id}">
                <span class="recommend-code">${esc(slot.code)}</span>
                <span class="recommend-kind">${esc(slot.kindLabel)}${slot.powerKw ? ` · ${num(slot.powerKw, 0)} kW` : ''}</span>
                <span class="recommend-price">¥${num(slot.pricePerHour, 0)}/h</span>
                ${icon('chevronRight', 'recommend-arrow')}
              </button>
            `).join('')}
          </div>
        </div>
        ${upcoming ? `
          <div class="session-upcoming">
            <span class="session-upcoming__icon">${icon('calendarCheck')}</span>
            <div><strong>下一程已安排 · ${esc(upcoming.slot.code)}</strong><span>${formatRange(upcoming.startAt, upcoming.endAt)}</span></div>
            <button type="button" class="panel-link" data-action="nav" data-page="reservations">${icon('chevronRight')}</button>
          </div>` : ''}
      </section>
    `;
  }

  function renderActivityList(activity) {
    if (!activity || !activity.length) {
      return '<div class="activity-empty">还没有动态。选择一个车位，开启第一次智能停车。</div>';
    }
    return activity.map((item) => `
      <div class="activity-item">
        <span class="activity-icon activity-icon--${esc(item.kind)}">${icon(item.kind === 'reservation' ? 'calendarCheck' : item.kind === 'charging' ? 'bolt' : item.kind === 'completed' ? 'receipt' : 'car')}</span>
        <div class="activity-copy"><strong>${esc(item.title)}</strong><span>${esc(item.description)}</span></div>
        <span class="activity-time">${relativeTime(item.time)}</span>
      </div>
    `).join('');
  }

  function renderWeekChart(points) {
    if (!points?.length) return '<div class="activity-empty">暂无充电数据</div>';
    const max = Math.max(...points.map((point) => Number(point.energy || 0)), 1);
    return `
      <div class="week-chart">
        ${points.map((point) => {
          const height = Math.max(4, Math.round((Number(point.energy || 0) / max) * 92));
          return `
            <div class="chart-col${point.isToday ? ' is-today' : ''}" title="${esc(point.day)} · ${num(point.energy, 1)} kWh">
              <span class="chart-value">${num(point.energy, 1)}</span>
              <div class="chart-bar" style="height:${height}px"></div>
              <span class="chart-label">${esc(point.label)}</span>
            </div>`;
        }).join('')}
      </div>
    `;
  }

  // -----------------------------------------------------------------------
  // Parking map
  // -----------------------------------------------------------------------

  function renderMapPage() {
    const data = state.slotsData;
    if (!data) return;
    const filtered = filteredSlots();
    if (!state.selectedSlotId || !data.slots.some((slot) => slot.id === state.selectedSlotId)) {
      const preferred = filtered.find((slot) => slot.isMine)
        || filtered.find((slot) => slot.state === 'available')
        || filtered[0]
        || data.slots[0];
      state.selectedSlotId = preferred?.id ?? null;
    }
    const selected = data.slots.find((slot) => slot.id === state.selectedSlotId) || null;

    pageEl.innerHTML = `
      <div class="page-head">
        <div class="page-head__main">
          <div class="page-date"><span class="live-tag">实时车位</span><span class="date-rule"></span>${data.zones.reduce((sum, zone) => sum + zone.total, 0)} 个车位 · B1 层</div>
          <h1 class="page-title">找到你的位置<span class="title-dot">.</span></h1>
          <p class="page-subtitle">空闲、充电与预约状态一目了然。选择车位后即可停车或预约。</p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn--outline" data-action="refresh">${icon('refresh')}刷新状态</button>
          <button type="button" class="btn btn--lime" data-action="open-reserve">${icon('calendar')}预约车位</button>
        </div>
      </div>

      <div class="map-toolbar">
        <div class="filter-group" aria-label="区域筛选">
          ${['all', 'A', 'B', 'C'].map((zone) => `
            <button type="button" class="filter-chip${state.filters.zone === zone ? ' is-active' : ''}" data-action="filter" data-filter-group="zone" data-filter-value="${zone}">${zone === 'all' ? '全部区域' : `${zone} 区`}</button>
          `).join('')}
        </div>
        <span class="toolbar-divider"></span>
        <div class="filter-group" aria-label="车位类型筛选">
          ${[['all', '全部类型'], ['dc', '直流快充'], ['ac', '交流慢充'], ['parking', '标准车位']].map(([kind, label]) => `
            <button type="button" class="filter-chip${state.filters.kind === kind ? ' is-active' : ''}" data-action="filter" data-filter-group="kind" data-filter-value="${kind}">${label}</button>
          `).join('')}
        </div>
        <label class="map-search">
          ${icon('search')}
          <input type="search" id="slot-search" value="${esc(state.filters.query)}" placeholder="搜索车位编号…" aria-label="搜索车位编号">
        </label>
        <button type="button" class="toolbar-refresh" data-action="refresh">${icon('refresh')} 刷新</button>
      </div>

      <div class="map-layout">
        <section class="panel map-canvas">
          <div class="panel-head">
            <div><span class="panel-kicker">PARKING LEVEL B1</span><h2 class="panel-title">车位分布</h2></div>
            <span class="live-tag">${data.zones.reduce((sum, zone) => sum + zone.available, 0)} 个空闲</span>
          </div>
          <div id="map-results">
            ${renderMapZones(filtered)}
          </div>
          <div class="legend">
            <span class="legend-item"><i class="legend-dot"></i>空闲</span>
            <span class="legend-item"><i class="legend-dot legend-dot--occupied"></i>已占用</span>
            <span class="legend-item"><i class="legend-dot legend-dot--charging"></i>充电中</span>
            <span class="legend-item"><i class="legend-dot legend-dot--reserved"></i>已预约</span>
            <span class="legend-item"><i class="legend-dot legend-dot--maintenance"></i>维护</span>
          </div>
        </section>
        <aside class="panel slot-detail" id="slot-detail">
          ${renderSlotDetail(selected)}
        </aside>
      </div>
    `;
  }

  function filteredSlots() {
    if (!state.slotsData) return [];
    const query = state.filters.query.trim().toLowerCase();
    return state.slotsData.slots.filter((slot) => {
      if (state.filters.zone !== 'all' && slot.zone !== state.filters.zone) return false;
      if (state.filters.kind !== 'all' && slot.kind !== state.filters.kind) return false;
      if (query && !`${slot.code} ${slot.zoneName} ${slot.kindLabel}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }

  function renderMapZones(slots) {
    if (!slots.length) {
      return `<div class="map-empty"><div>${icon('search')}<p>没有匹配的车位，换个筛选条件试试。</p></div></div>`;
    }
    const zones = state.slotsData.zones.filter((zone) => slots.some((slot) => slot.zone === zone.id));
    return zones.map((zone) => {
      const zoneSlots = slots.filter((slot) => slot.zone === zone.id);
      return `
        <section class="map-zone">
          <div class="map-zone-heading">
            <span class="zone-badge zone-badge--${esc(zone.id)}">${esc(zone.id)}</span>
            <div class="map-zone-title"><strong>${esc(zone.name)}</strong><span>${esc(zone.tagline)}</span></div>
            <span class="map-zone-count"><b>${zoneSlots.filter((slot) => slot.state === 'available').length}</b> 可预约 / ${zoneSlots.length}</span>
          </div>
          <div class="slot-grid">
            ${zoneSlots.map(renderSlotCard).join('')}
          </div>
        </section>
      `;
    }).join('');
  }

  function renderSlotCard(slot) {
    const slotIcon = slot.kind === 'dc' ? 'bolt' : slot.kind === 'ac' ? 'plug' : 'parking';
    const selected = slot.id === state.selectedSlotId;
    return `
      <button type="button" class="slot-card is-${slot.state}${selected ? ' is-selected' : ''}${slot.isMine ? ' is-mine' : ''}" data-action="select-slot" data-slot-id="${slot.id}" aria-label="${esc(slot.code)}，${SLOT_STATES[slot.state]?.label || ''}，${esc(slot.kindLabel)}">
        <span class="slot-card__top">
          <span class="slot-card__code">${esc(slot.code)}</span>
          <span class="slot-state-dot"></span>
        </span>
        <span class="slot-card__icon">${icon(slotIcon)}</span>
        <span class="slot-card__kind">${esc(slot.kindLabel)}${slot.powerKw ? ` · ${num(slot.powerKw, 0)} kW` : ''}</span>
        <span class="slot-card__foot"><span class="slot-card__state">${SLOT_STATES[slot.state]?.label || ''}</span><span class="slot-card__price">¥${num(slot.pricePerHour, 0)}/h</span></span>
        ${slot.isMine ? '<span class="slot-card__mine"></span>' : ''}
      </button>
    `;
  }

  function refreshMapContent() {
    if (state.page !== 'map' || !state.slotsData) return;
    const filtered = filteredSlots();
    if (!filtered.some((slot) => slot.id === state.selectedSlotId)) {
      const preferred = filtered.find((slot) => slot.isMine)
        || filtered.find((slot) => slot.state === 'available')
        || filtered[0];
      state.selectedSlotId = preferred?.id ?? null;
    }
    const results = $('#map-results');
    if (results) results.innerHTML = renderMapZones(filtered);
    const detail = $('#slot-detail');
    if (detail) {
      const selected = state.slotsData.slots.find((slot) => slot.id === state.selectedSlotId) || null;
      detail.innerHTML = renderSlotDetail(selected);
    }
  }

  function renderSlotDetail(slot) {
    if (!slot) {
      return `
        <div class="detail-empty">
          <div class="detail-empty__icon">${icon('parking')}</div>
          <h3>选择一个车位</h3>
          <p>点击左侧任意车位，查看充电功率、预约情况与操作选项。</p>
        </div>
        <div class="detail-note" style="margin:0 18px 18px">车位状态每 35 秒自动同步。进行中的订单可在「充电记录」中查看。</div>
      `;
    }
    const stateMeta = SLOT_STATES[slot.state] || SLOT_STATES.available;
    const slotIcon = slot.kind === 'dc' ? 'bolt' : slot.kind === 'ac' ? 'plug' : 'parking';
    const activeSession = state.slotsData?.activeSession;
    const ownActive = slot.occupant?.isMine && activeSession && activeSession.slot.id === slot.id;
    const ownReservation = slot.reservation?.isMine ? slot.reservation : null;
    const now = Date.now();
    const canCheckIn = ownReservation
      && new Date(ownReservation.startAt).getTime() - 15 * 60000 <= now
      && new Date(ownReservation.endAt).getTime() > now
      && ownReservation.status !== 'active';
    const hasActiveOrder = Boolean(activeSession) && !ownActive;

    let actionMarkup = '';
    if (slot.state === 'available') {
      actionMarkup = `
        <button type="button" class="btn btn--lime" data-action="start-session" data-slot-id="${slot.id}" ${hasActiveOrder ? 'disabled' : ''}>${icon('bolt')}${hasActiveOrder ? '请先结束当前订单' : '立即停车'}</button>
        <button type="button" class="btn btn--outline" data-action="open-reserve" data-slot-id="${slot.id}">${icon('calendar')}预约此位</button>
      `;
    } else if (slot.state === 'occupied' || slot.state === 'charging') {
      if (ownActive) {
        actionMarkup = `<button type="button" class="btn btn--lime" data-action="end-session" data-session-id="${activeSession.id}">${icon('receipt')}结束并结算</button>`;
      } else {
        actionMarkup = `<button type="button" class="btn btn--outline" disabled>${icon('car')}车位使用中</button>`;
      }
    } else if (slot.state === 'reserved') {
      if (ownReservation && canCheckIn) {
        actionMarkup = `<button type="button" class="btn btn--lime" data-action="check-in" data-reservation-id="${ownReservation.id}">${icon('check')}签到入场</button>`;
      } else if (ownReservation) {
        actionMarkup = `<button type="button" class="btn btn--outline" disabled>${icon('clock')}开始前 15 分钟可签到</button>`;
      } else {
        actionMarkup = `<button type="button" class="btn btn--outline" disabled>${icon('calendar')}已被其他车主预约</button>`;
      }
    } else if (slot.state === 'maintenance') {
      actionMarkup = `<button type="button" class="btn btn--outline" disabled>${icon('shield')}维护中，暂不可用</button>`;
    }

    if (state.user.role === 'admin' && !slot.occupant && !slot.reservation) {
      const nextStatus = slot.state === 'maintenance' ? 'open' : 'maintenance';
      actionMarkup += `<button type="button" class="btn btn--ghost btn--sm" data-action="toggle-maintenance" data-slot-id="${slot.id}" data-status="${nextStatus}">${slot.state === 'maintenance' ? '恢复运营状态' : '设为维护车位'}</button>`;
    }

    const occupancyBlock = slot.occupant
      ? `<div class="detail-block">
          <div class="detail-block__label"><span>${slot.occupant.isMine ? '我的车辆' : '当前占用'}</span><strong>${esc(slot.occupant.plate)}</strong></div>
          <p>${slot.occupant.isMine ? '这是你的进行中订单。' : '该车位正在使用中。'}已进行 ${humanDuration(slot.occupant.elapsedMinutes)}。</p>
        </div>`
      : '';
    const reservationBlock = slot.reservation
      ? `<div class="detail-block">
          <div class="detail-block__label"><span>${slot.reservation.isMine ? '我的预约' : '车位预约'}</span><strong>${formatRange(slot.reservation.startAt, slot.reservation.endAt)}</strong></div>
          <p>${slot.reservation.isMine ? (canCheckIn ? '可以签到了，请在预约时间内入场。' : '请在开始前 15 分钟内签到。') : '该时段已被其他车主保留。'}</p>
        </div>`
      : '';
    const nextBlock = slot.nextBooking && !slot.reservation
      ? `<div class="detail-block">
          <div class="detail-block__label"><span>你的下一笔预约</span><strong>${formatRange(slot.nextBooking.startAt, slot.nextBooking.endAt)}</strong></div>
          <p>该车位现在仍可临时停车，但请在预约开始前腾出。</p>
        </div>`
      : '';

    return `
      <div class="slot-detail__hero">
        <div class="slot-detail__top">
          <span class="slot-detail__eyebrow">PARKING SLOT / B1</span>
          <span class="detail-hero-icon">${icon(slotIcon)}</span>
        </div>
        <div class="slot-detail__code">${esc(slot.code)}</div>
        <div class="slot-detail__zone">${esc(slot.zoneName)} · ${esc(slot.kindLabel)}</div>
        <span class="slot-detail__state" style="${slot.state === 'maintenance' ? 'color:#e8bd88;background:rgba(232,189,136,.1)' : slot.state === 'reserved' ? 'color:#f0cd96;background:rgba(240,205,150,.1)' : slot.state === 'occupied' ? 'color:#b9c5b9;background:rgba(185,197,185,.1)' : ''}">${stateMeta.label}</span>
      </div>
      <div class="slot-detail__body">
        <div class="detail-meta-grid">
          <div class="detail-meta"><span>充电功率</span><strong>${slot.powerKw ? `${num(slot.powerKw, 0)} <small>kW</small>` : '— 标准车位'}</strong></div>
          <div class="detail-meta"><span>计费标准</span><strong>¥${num(slot.pricePerHour, 0)} <small>/ 小时</small></strong></div>
          <div class="detail-meta"><span>接口标准</span><strong>${esc(slot.connector)}</strong></div>
          <div class="detail-meta"><span>未来预约</span><strong>${slot.upcomingCount || 0} <small>个时段</small></strong></div>
        </div>
        ${occupancyBlock}
        ${reservationBlock}
        ${nextBlock}
        <div class="detail-actions">
          ${actionMarkup}
        </div>
        <p class="detail-disclaimer">${hasActiveOrder ? '你有一个进行中的停车订单，结束当前订单后可开始新的停车。' : '停车费用按 30 分钟为单位计算，充电服务费按实际电量结算。'}</p>
      </div>
    `;
  }

  // -----------------------------------------------------------------------
  // Reservations
  // -----------------------------------------------------------------------

  function renderReservationsPage() {
    const data = state.reservationsData;
    if (!data) return;
    const counts = {
      upcoming: data.upcoming.length,
      active: data.active.length,
      history: data.history.length
    };
    const tab = state.resTab;
    const list = data[tab] || [];
    const vehicles = state.vehiclesData?.vehicles || [];

    pageEl.innerHTML = `
      <div class="page-head">
        <div class="page-head__main">
          <div class="page-date">${icon('calendar')} ${formatFullDate()}<span class="date-rule"></span><span class="live-tag">可提前 30 天预约</span></div>
          <h1 class="page-title">预约你的车位<span class="title-dot">.</span></h1>
          <p class="page-subtitle">提前锁定充电位。开始前 15 分钟签到，入场后自动开始计时。</p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn--outline" data-action="refresh">${icon('refresh')}刷新</button>
          <button type="button" class="btn btn--lime" data-action="open-reserve">${icon('plus')}新建预约</button>
        </div>
      </div>

      <div class="res-layout">
        <section class="panel res-panel">
          <div class="panel-head" style="align-items:center">
            <div><span class="panel-kicker">YOUR RESERVATIONS</span><h2 class="panel-title">预约记录</h2></div>
            <div class="segmented" role="tablist" aria-label="预约状态">
              ${[['upcoming', '待到店'], ['active', '进行中'], ['history', '历史']].map(([key, label]) => `
                <button type="button" class="${tab === key ? 'is-active' : ''}" data-action="res-tab" data-tab="${key}">${label}<span class="count">${counts[key]}</span></button>
              `).join('')}
            </div>
          </div>
          <div class="res-list">
            ${list.length ? list.map((reservation) => renderReservationCard(reservation, tab)).join('') : renderReservationEmpty(tab)}
          </div>
        </section>

        <aside class="res-side">
          <div class="panel tips-card">
            <div class="tips-card__icon">${icon('spark')}</div>
            <h3>把时间留给路上。</h3>
            <p>一个预约，一段从容的充电时间。VoltPark 会为你保留车位。</p>
            <div class="tip-list">
              <div class="tip-item"><span class="tip-item__num">01</span><p><strong>提前锁定</strong><br>最长可提前 30 天预约，时长 30 分钟至 8 小时。</p></div>
              <div class="tip-item"><span class="tip-item__num">02</span><p><strong>弹性签到</strong><br>预约开始前 15 分钟至结束前，均可签到入场。</p></div>
              <div class="tip-item"><span class="tip-item__num">03</span><p><strong>随时取消</strong><br>未签到的预约可以随时取消，不收取费用。</p></div>
            </div>
          </div>
          <div class="panel side-mini-panel">
            <div class="panel-head">
              <div><span class="panel-kicker">QUICK READ</span><h2 class="panel-title">账户速览</h2></div>
            </div>
            <div class="mini-res-stat"><span>待到店预约</span><strong>${counts.upcoming}</strong></div>
            <div class="mini-res-stat"><span>进行中预约</span><strong>${counts.active}</strong></div>
            <div class="mini-res-stat"><span>已绑定车辆</span><strong>${vehicles.length}</strong></div>
            <button type="button" class="btn btn--outline btn--block btn--sm" style="margin-top:12px" data-action="nav" data-page="vehicles">${icon('car')}管理我的爱车</button>
          </div>
        </aside>
      </div>
    `;
  }

  function renderReservationCard(reservation, tab) {
    const date = asDate(reservation.startAt);
    const start = date || new Date();
    const isHistory = tab === 'history';
    const statusClass = STATUS_CLASS[reservation.status] || 'status-pill--done';
    const actions = [];
    if (!isHistory) {
      if (reservation.canCheckIn) {
        actions.push(`<button type="button" class="btn btn--lime" data-action="check-in" data-reservation-id="${reservation.id}">${icon('check')}签到入场</button>`);
      }
      if (reservation.canCancel) {
        actions.push(`<button type="button" class="btn btn--outline" data-action="cancel-reservation" data-reservation-id="${reservation.id}">取消</button>`);
      }
      if (reservation.status === 'active') {
        actions.push(`<button type="button" class="btn btn--soft" data-action="nav" data-page="sessions">${icon('arrow')}查看订单</button>`);
      }
    }
    return `
      <article class="reservation-card${isHistory ? ' is-history' : ''}">
        <div class="res-date"><strong>${pad(start.getDate())}</strong><span>${start.getMonth() + 1} 月 · ${WEEKDAYS[start.getDay()]}</span></div>
        <div class="res-main">
          <div class="res-main__top">
            <h3>${esc(reservation.slot.code)} · ${esc(reservation.slot.zone)} 区</h3>
            <span class="status-pill ${statusClass}">${STATUS_LABELS[reservation.status] || reservation.status}</span>
          </div>
          <div class="res-main__meta">
            <span>${icon('clock')}${formatRange(reservation.startAt, reservation.endAt)}</span>
            <span>${icon('car')}${esc(reservation.vehicle.plate)}</span>
            <span>${icon('bolt')}${reservation.slot.powerKw ? `${num(reservation.slot.powerKw, 0)} kW ${reservation.slot.kind === 'dc' ? '快充' : '慢充'}` : '标准车位'}</span>
          </div>
          <div class="res-main__note">${reservation.note ? esc(reservation.note) : `预约时长 ${humanDuration(reservation.durationMinutes)} · 开始前 15 分钟可签到`}</div>
        </div>
        <div class="res-actions">${actions.join('')}</div>
      </article>
    `;
  }

  function renderReservationEmpty(tab) {
    const copy = tab === 'history'
      ? ['还没有历史预约', '完成一次停车后，这里会留下你的出行记录。']
      : tab === 'active'
        ? ['暂无进行中的预约', '签到后的预约会出现在这里，同时开始计费。']
        : ['车位已经为你准备好', '提前预约一个车位，把找车位的时间留给其他事。'];
    return `
      <div class="empty-state">
        <div class="empty-state__icon">${icon(tab === 'history' ? 'receipt' : 'calendarCheck')}</div>
        <h3>${copy[0]}</h3>
        <p>${copy[1]}</p>
        ${tab === 'upcoming' ? `<button type="button" class="btn btn--dark" data-action="open-reserve">${icon('plus')}新建预约</button>` : ''}
      </div>
    `;
  }

  // -----------------------------------------------------------------------
  // Sessions / charging history
  // -----------------------------------------------------------------------

  function renderSessionsPage() {
    const data = state.sessionsData;
    if (!data) return;
    const summary = data.summary;
    const active = data.activeSession;
    const activeCharging = Boolean(active && Number(active.powerKw) > 0);
    const weeklyTotal = (data.weekly || []).reduce((sum, point) => sum + Number(point.energy || 0), 0);

    pageEl.innerHTML = `
      <div class="page-head">
        <div class="page-head__main">
          <div class="page-date">${icon('receipt')} ${formatFullDate()}<span class="date-rule"></span><span class="live-tag">账单可导出</span></div>
          <h1 class="page-title">每一度电，都有记录<span class="title-dot">.</span></h1>
          <p class="page-subtitle">查看充电量、停车时长与费用明细。数据保存在本机 SQLite 数据库。</p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn--outline" data-action="export-sessions">${icon('download')}导出记录</button>
          <button type="button" class="btn btn--lime" data-action="nav" data-page="map">${icon('map')}去停车</button>
        </div>
      </div>

      <section class="summary-grid">
        <article class="summary-card">
          <div class="summary-card__top"><span>累计充电</span>${icon('bolt')}</div>
          <div class="summary-value">${num(summary.energy, 1)}<small>kWh</small></div>
          <div class="summary-caption">全部完成订单</div>
        </article>
        <article class="summary-card">
          <div class="summary-card__top"><span>累计消费</span>${icon('wallet')}</div>
          <div class="summary-value">¥${money(summary.spend)}</div>
          <div class="summary-caption">停车费 + 充电服务费</div>
        </article>
        <article class="summary-card">
          <div class="summary-card__top"><span>停车次数</span>${icon('parking')}</div>
          <div class="summary-value">${summary.count}<small>次</small></div>
          <div class="summary-caption"><b>${active ? '1 个进行中' : '暂无进行中'}</b></div>
        </article>
        <article class="summary-card">
          <div class="summary-card__top"><span>平均时长</span>${icon('timer')}</div>
          <div class="summary-value">${humanDuration(summary.avgMinutes)}</div>
          <div class="summary-caption">每次停车平均用时</div>
        </article>
      </section>

      ${active ? `
        <div class="active-banner">
          <span class="active-banner__icon">${icon(activeCharging ? 'bolt' : 'parking')}</span>
          <div class="active-banner__copy">
            <strong>${esc(active.slot.code)} ${activeCharging ? '正在充电' : '正在停车'} · ${esc(active.vehicle.plate)}</strong>
            <span>${activeCharging ? `${num(active.powerKw, 0)} kW · 已充 ${num(active.energyKwh, 1)} kWh` : '标准车位 · 按停车时长计费'} · 预计费用 ¥${money(active.totalFee)}</span>
          </div>
          <span class="active-banner__timer" data-live-timer data-start="${esc(active.startedAt)}">${humanDuration(active.durationMinutes)}</span>
          <button type="button" class="btn btn--dark btn--sm" data-action="end-session" data-session-id="${active.id}">结束并结算</button>
        </div>
      ` : ''}

      <div class="sessions-layout">
        <div class="sessions-main">
          <section class="panel chart-panel chart-panel--sessions">
            <div class="chart-head">
              <div><span class="panel-kicker">ENERGY / LAST 7 DAYS</span><h2 class="panel-title">近 7 日充电量</h2></div>
              <div class="chart-total"><strong>${num(weeklyTotal, 1)}</strong><span>kWh TOTAL</span></div>
            </div>
            ${renderWeekChart(data.weekly)}
            <div class="chart-foot"><span>数据按本地时区统计</span><span>减少碳排放 <strong>${num(weeklyTotal * 0.501, 1)} kg</strong></span></div>
          </section>

          <section class="panel table-panel">
            <div class="panel-head">
              <div><span class="panel-kicker">CHARGING HISTORY</span><h2 class="panel-title">充电与停车账单</h2><p class="panel-sub">最近 60 条已完成记录</p></div>
            </div>
            ${data.history.length ? `
              <div class="table-scroll">
                <table class="data-table">
                  <thead><tr><th>车位 / 日期</th><th>车辆</th><th>时长</th><th>电量</th><th>费用</th><th>状态</th></tr></thead>
                  <tbody>
                    ${data.history.map((session) => `
                      <tr>
                        <td>
                          <div class="table-primary">
                            <span class="table-icon">${icon(session.slot.kind === 'parking' ? 'parking' : 'bolt')}</span>
                            <div><strong>${esc(session.slot.code)}</strong><span>${formatDateTime(session.startedAt)}</span></div>
                          </div>
                        </td>
                        <td><span class="table-mono">${esc(session.vehicle.plate)}</span></td>
                        <td><span class="table-mono">${humanDuration(session.durationMinutes)}</span></td>
                        <td><span class="table-mono">${num(session.energyKwh, 1)} kWh</span></td>
                        <td><span class="table-price">¥${money(session.totalFee)}</span></td>
                        <td><span class="table-pill">已完成</span></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            ` : `
              <div class="empty-state">
                <div class="empty-state__icon">${icon('receipt')}</div>
                <h3>还没有账单</h3>
                <p>完成第一次停车后，费用与充电数据会出现在这里。</p>
                <button type="button" class="btn btn--dark" data-action="nav" data-page="map">${icon('map')}去停车</button>
              </div>
            `}
          </section>
        </div>

        <aside class="res-side">
          <div class="insight-card">
            <span class="panel-kicker">YOUR IMPACT</span>
            <h3 style="margin-top:5px">绿色出行小结</h3>
            <p>每一度清洁电能，都在让城市轻一点。</p>
            <div class="insight-big"><strong>${num(summary.energy * 0.501, 1)}</strong><span>KG CO₂ 累计减排</span></div>
            <div class="insight-row"><span>累计充电量</span><b>${num(summary.energy, 1)} kWh</b></div>
            <div class="insight-row"><span>累计服务次数</span><b>${summary.count} 次</b></div>
            <div class="insight-row"><span>平均每次充电</span><b>${summary.count ? num(summary.energy / summary.count, 1) : '0'} kWh</b></div>
          </div>
          <div class="panel side-mini-panel">
            <div class="panel-head"><div><span class="panel-kicker">BILLING NOTE</span><h2 class="panel-title">计费说明</h2></div></div>
            <div class="mini-res-stat"><span>停车计费单位</span><strong>30 分钟</strong></div>
            <div class="mini-res-stat"><span>充电服务费</span><strong>¥1.50 / kWh</strong></div>
            <div class="mini-res-stat"><span>快充功率</span><strong>最高 120 kW</strong></div>
            <p style="margin-top:10px;color:var(--muted-2);font-size:8px;line-height:1.7">账单为演示数据。实际费率以现场公示和运营规则为准。</p>
          </div>
        </aside>
      </div>
    `;
  }

  // -----------------------------------------------------------------------
  // Vehicles
  // -----------------------------------------------------------------------

  function renderVehiclesPage() {
    const vehicles = state.vehiclesData?.vehicles || [];
    pageEl.innerHTML = `
      <div class="page-head">
        <div class="page-head__main">
          <div class="page-date">${icon('car')} ${formatFullDate()}<span class="date-rule"></span><span class="live-tag">${vehicles.length} / 5 辆</span></div>
          <h1 class="page-title">我的爱车<span class="title-dot">.</span></h1>
          <p class="page-subtitle">绑定车辆后即可入场停车。每辆车都可以单独预约与结算。</p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn--outline" data-action="refresh">${icon('refresh')}刷新</button>
          <button type="button" class="btn btn--lime" data-action="open-add-vehicle">${icon('plus')}绑定爱车</button>
        </div>
      </div>

      <div class="vehicle-summary">
        <span>已绑定 <strong>${vehicles.length}</strong> 辆车</span><span class="dot-divider"></span>
        <span>默认车辆 <strong>${esc(vehicles.find((vehicle) => vehicle.isPrimary)?.model || '未设置')}</strong></span>
        <span class="dot-divider"></span>
        <span>支持国标直流 / 交流接口</span>
        <span style="margin-left:auto;color:var(--muted-2)">最多可绑定 5 辆</span>
      </div>

      <div class="vehicle-grid">
        ${vehicles.map((vehicle, index) => renderVehicleCard(vehicle, index)).join('')}
        ${vehicles.length < 5 ? `
          <button type="button" class="vehicle-add" data-action="open-add-vehicle">
            <span class="vehicle-add__icon">${icon('plus')}</span>
            <h3>绑定新的爱车</h3>
            <p>添加车辆信息，开始充电与预约。</p>
          </button>
        ` : ''}
      </div>

      <p class="vehicle-note" style="margin-top:15px">车辆信息仅用于本地停车服务。进行中的订单需要结束后才能解绑。</p>
    `;
  }

  function renderVehicleCard(vehicle, index) {
    return `
      <article class="vehicle-card">
        <div class="vehicle-art">
          <span class="vehicle-badge">${vehicle.isPrimary ? '默认车辆' : `EV / ${pad(index + 1)}`}</span>
          <span class="vehicle-art__index">0${index + 1} / VOLT</span>
          ${vehicleCarArt(vehicle)}
        </div>
        <div class="vehicle-body">
          <div class="vehicle-heading">
            <div><h3>${esc(vehicle.model)}</h3><p>${vehicle.isPrimary ? '主用车辆 · ' : ''}已绑定 VoltPark</p></div>
            <span class="plate">${esc(vehicle.plate)}</span>
          </div>
          <div class="vehicle-specs">
            <div class="vehicle-spec"><span>电池容量</span><strong>${num(vehicle.batteryKwh, 1)} <small>kWh</small></strong></div>
            <div class="vehicle-spec"><span>充电接口</span><strong>${esc(vehicle.connector)}</strong></div>
          </div>
          <div class="vehicle-actions">
            <button type="button" class="btn ${vehicle.isPrimary ? 'btn--soft' : 'btn--outline'}" data-action="set-primary" data-vehicle-id="${vehicle.id}" ${vehicle.isPrimary ? 'disabled' : ''}>${vehicle.isPrimary ? '默认车辆' : '设为默认'}</button>
            <button type="button" class="btn btn--outline icon-only" data-action="delete-vehicle" data-vehicle-id="${vehicle.id}" aria-label="解绑 ${esc(vehicle.model)}">${icon('trash')}</button>
          </div>
        </div>
      </article>
    `;
  }

  function vehicleCarArt(vehicle) {
    return `
      <div class="vehicle-car" style="--car-color:${esc(safeColor(vehicle.color))}">
        <svg viewBox="0 0 320 140" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <ellipse cx="162" cy="119" rx="122" ry="10" fill="#172b1d" opacity=".12"/>
          <path d="M32 101c-8-1-13-6-13-14v-6c0-8 5-13 14-15l51-8 25-18c9-6 19-9 30-9h32c15 0 27 5 37 15l20 20 37 5c14 2 21 8 22 18l1 8c0 6-5 10-13 10H32Z" fill="var(--car-color)" stroke="#172a1f" stroke-opacity=".28" stroke-width="1.5"/>
          <path d="M111 52 132 34c5-4 11-6 18-6h31c10 0 19 4 26 11l16 15-112-2Z" fill="#1a3426" opacity=".84"/>
          <path d="M140 35c4-3 9-5 14-5h14l-13 18-31 2 16-15Z" fill="#dcece0" opacity=".55"/>
          <path d="M186 32c7 1 13 5 18 10l12 12-38-2 8-20Z" fill="#dcece0" opacity=".45"/>
          <path d="M36 83c34-9 66-12 121-11 40 0 85 3 128 13" stroke="#ffffff" stroke-opacity=".16" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M78 78c-5 1-8 5-9 10l-1 9M265 80c4 1 7 5 8 9l1 7" stroke="#0f1c14" stroke-opacity=".28" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M115 86h92" stroke="#0f1c14" stroke-opacity=".22" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M20 77h12M204 83h10" stroke="#efffd8" stroke-opacity=".65" stroke-width="2" stroke-linecap="round"/>
          <path d="M282 76h12v6h-12z" fill="#d9ff8d" opacity=".9"/>
          <circle cx="91" cy="100" r="20" fill="#132117"/>
          <circle cx="91" cy="100" r="10" fill="#7b8b7e"/>
          <circle cx="91" cy="100" r="4" fill="#d8e5d6" opacity=".7"/>
          <circle cx="253" cy="100" r="20" fill="#132117"/>
          <circle cx="253" cy="100" r="10" fill="#7b8b7e"/>
          <circle cx="253" cy="100" r="4" fill="#d8e5d6" opacity=".7"/>
          <path d="M43 105h27M274 105h15" stroke="#0d1a10" stroke-width="2" stroke-linecap="round" opacity=".3"/>
          <path d="M155 67h31c6 0 10 4 10 9H145c0-5 4-9 10-9Z" fill="#c8f96a" opacity=".23"/>
        </svg>
      </div>
    `;
  }

  // -----------------------------------------------------------------------
  // Admin
  // -----------------------------------------------------------------------

  function renderAdminPage() {
    const data = state.adminData;
    if (!data) return;
    const stats = data.stats;
    pageEl.innerHTML = `
      <div class="page-head">
        <div class="page-head__main">
          <div class="page-date">${icon('sliders')} ${formatFullDate()}<span class="date-rule"></span><span class="live-tag">运营视角</span></div>
          <h1 class="page-title">运营中心<span class="title-dot">.</span></h1>
          <p class="page-subtitle">查看场地实时状态、车位运营与订单情况。</p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn--outline" data-action="refresh">${icon('refresh')}刷新数据</button>
        </div>
      </div>

      <div class="admin-stats">
        ${adminStat('用户总数', stats.users, 'users', '位注册车主')}
        ${adminStat('绑定车辆', stats.vehicles, 'car', '辆电动车')}
        ${adminStat('实时占用率', `${stats.occupancyRate}%`, 'gauge', `${stats.activeSessions} 个进行中订单`)}
        ${adminStat('本月营收', `¥${money(stats.monthRevenue)}`, 'wallet', `${num(stats.monthEnergy, 1)} kWh 充电量`)}
      </div>

      <div class="admin-grid">
        <section class="panel admin-panel">
          <div class="panel-head">
            <div><span class="panel-kicker">ZONE HEALTH</span><h2 class="panel-title">区域运营状态</h2></div>
            <button type="button" class="panel-link" data-action="nav" data-page="map">员工视角地图 ${icon('chevronRight')}</button>
          </div>
          <div class="admin-zone-list">
            ${data.zones.map((zone) => {
              const usage = zone.total ? Math.round(((zone.occupied + zone.reserved) / Math.max(1, zone.total - zone.maintenance)) * 100) : 0;
              return `
                <div class="admin-zone">
                  <span class="admin-zone__badge">${esc(zone.id)}</span>
                  <div class="admin-zone__title"><strong>${esc(zone.name)}</strong><span>${zone.total} 个车位 · ${zone.available} 空闲 · ${zone.maintenance} 维护</span></div>
                  <span class="admin-zone__bar"><i style="width:${usage}%"></i></span>
                  <span class="admin-zone__pct">${usage}%</span>
                </div>
              `;
            }).join('')}
          </div>
          <div class="panel-head" style="margin-top:22px">
            <div><span class="panel-kicker">SLOT MANAGEMENT</span><h2 class="panel-title">车位状态管理</h2><p class="panel-sub">点击空闲或维护中的车位切换运营状态</p></div>
          </div>
          <div class="admin-slot-grid">
            ${data.slots.map(renderAdminSlot).join('')}
          </div>
          <div class="admin-legend"><span>● 可运营</span><span>● 使用中 / 有预约</span><span>● 维护中</span></div>
        </section>

        <aside class="res-side">
          <div class="panel admin-panel">
            <div class="panel-head">
              <div><span class="panel-kicker">LIVE NOW</span><h2 class="panel-title">在场车辆</h2><p class="panel-sub">${data.liveSessions.length} 个进行中订单</p></div>
              <span class="live-tag">实时</span>
            </div>
            <div class="admin-live">
              ${data.liveSessions.length ? data.liveSessions.map((session) => `
                <div class="live-session">
                  <span class="live-session__avatar">${esc((session.customer?.name || '车')[0])}</span>
                  <div class="live-session__copy"><strong>${esc(session.slot.code)} · ${esc(session.vehicle.plate)}</strong><span>${esc(session.customer?.name || '')} · ${num(session.energyKwh, 1)} kWh</span></div>
                  <span class="live-session__time">${humanDuration(session.durationMinutes)}</span>
                </div>
              `).join('') : '<div class="activity-empty">当前没有在场车辆</div>'}
            </div>
          </div>
          <div class="insight-card">
            <span class="panel-kicker">TODAY</span>
            <h3 style="margin-top:5px">今日运营速览</h3>
            <div class="insight-big"><strong>${stats.reservationsToday}</strong><span>今日预约（含已完成）</span></div>
            <div class="insight-row"><span>本月完成订单</span><b>${stats.monthSessions}</b></div>
            <div class="insight-row"><span>本月充电量</span><b>${num(stats.monthEnergy, 1)} kWh</b></div>
            <div class="insight-row"><span>平均每单营收</span><b>¥${stats.monthSessions ? money(stats.monthRevenue / stats.monthSessions) : '0.00'}</b></div>
          </div>
        </aside>
      </div>
    `;
  }

  function adminStat(label, value, iconName, caption) {
    return `
      <article class="summary-card">
        <div class="summary-card__top"><span>${esc(label)}</span>${icon(iconName)}</div>
        <div class="summary-value">${value}</div>
        <div class="summary-caption">${esc(caption)}</div>
      </article>
    `;
  }

  function renderAdminSlot(slot) {
    const busy = ['occupied', 'charging', 'reserved'].includes(slot.state);
    const maintenance = slot.state === 'maintenance';
    const disabled = busy || Boolean(slot.upcomingCount);
    const nextStatus = maintenance ? 'open' : 'maintenance';
    return `
      <button type="button" class="admin-slot${busy ? ' is-busy' : ''}${maintenance ? ' is-maintenance' : ''}"
        data-action="toggle-maintenance" data-slot-id="${slot.id}" data-status="${nextStatus}"
        ${disabled ? 'disabled' : ''} title="${esc(slot.code)} · ${SLOT_STATES[slot.state]?.label || ''}${busy ? '，使用中不可切换' : ''}">
        ${esc(slot.code)}
      </button>
    `;
  }

  // -----------------------------------------------------------------------
  // Modals: shared shell
  // -----------------------------------------------------------------------

  function openModal({ title, kicker = 'VOLTPARK', subtitle = '', content = '', wide = false, className = '' }) {
    closeModal({ restoreFocus: false });
    state.lastFocused = document.activeElement;
    state.modalOpen = true;
    modalRoot.innerHTML = `
      <div class="modal-backdrop" data-modal-backdrop>
        <section class="modal ${wide ? 'modal--wide' : ''} ${className}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <header class="modal__head">
            <div>
              <span class="modal__kicker">${esc(kicker)}</span>
              <h2 class="modal__title" id="modal-title">${esc(title)}</h2>
              ${subtitle ? `<p class="modal__sub">${esc(subtitle)}</p>` : ''}
            </div>
            <button type="button" class="modal__close" data-action="close-modal" aria-label="关闭">${icon('close')}</button>
          </header>
          <div class="modal__body">${content}</div>
        </section>
      </div>
    `;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => {
      const focusTarget = modalRoot.querySelector('input:not([type="hidden"]), select, textarea, button.btn--lime, button.btn--primary');
      focusTarget?.focus({ preventScroll: true });
    }, 60);
  }

  function closeModal({ restoreFocus = true } = {}) {
    if (!modalRoot) return;
    const wasOpen = state.modalOpen;
    modalRoot.innerHTML = '';
    state.modalOpen = false;
    document.body.style.overflow = '';
    if (wasOpen && restoreFocus && state.lastFocused?.isConnected) {
      state.lastFocused.focus({ preventScroll: true });
    }
    state.lastFocused = null;
  }

  function showModalError(form, message) {
    const error = form?.querySelector('[data-modal-error]');
    if (!error) {
      if (message) toast(message, 'error');
      return;
    }
    error.hidden = !message;
    error.innerHTML = message ? `${icon('alert')}<span>${esc(message)}</span>` : '';
  }

  function setFormBusy(form, busy) {
    const button = form?.querySelector('[type="submit"]');
    if (!button) return;
    if (busy) {
      button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `${icon('refresh', 'btn__spinner')}处理中…`;
    } else {
      button.disabled = false;
      if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
        delete button.dataset.originalHtml;
      }
    }
  }

  function modalErrorBlock() {
    return '<div class="form-error inline-error" data-modal-error hidden></div>';
  }

  // -----------------------------------------------------------------------
  // Modals: reservation
  // -----------------------------------------------------------------------

  async function openReservationModal(slotId = null) {
    try {
      const [vehicles, slotsData] = await Promise.all([ensureVehicles(), ensureSlots()]);
      if (!vehicles.length) {
        toast('请先绑定一辆爱车，再进行预约', 'info');
        openVehicleModal();
        return;
      }
      const visibleSlots = slotsData.slots.filter((slot) => !slot.maintenance && slot.state === 'available');
      if (!visibleSlots.length) {
        toast('当前没有可预约的空闲车位，请稍后再试', 'error');
        return;
      }
      let chosenId = Number(slotId) || Number(state.selectedSlotId);
      if (!visibleSlots.some((slot) => slot.id === chosenId)) {
        chosenId = visibleSlots[0].id;
      }

      const defaultStart = new Date(Date.now() + 60 * 60000);
      defaultStart.setSeconds(0, 0);
      defaultStart.setMinutes(Math.ceil(defaultStart.getMinutes() / 30) * 30);
      const minDate = dateInputValue(new Date());
      const maxDate = dateInputValue(new Date(Date.now() + 30 * 86400000));

      openModal({
        title: '预约一个车位',
        kicker: 'RESERVE YOUR SPOT',
        subtitle: '提前锁定充电位，开始前 15 分钟可签到。',
        content: `
          <form class="modal-form" data-form="reservation" novalidate>
            <div class="form-grid">
              <div class="field">
                <label for="res-vehicle">选择车辆</label>
                <select id="res-vehicle" name="vehicleId" required>
                  ${vehicles.map((vehicle) => `<option value="${vehicle.id}" ${vehicle.isPrimary ? 'selected' : ''}>${esc(vehicle.model)} · ${esc(vehicle.plate)}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label for="res-slot">选择车位</label>
                <select id="res-slot" name="slotId" required>
                  ${visibleSlots.map((slot) => `<option value="${slot.id}" ${slot.id === chosenId ? 'selected' : ''}>${esc(slot.code)} · ${esc(slot.kindLabel)}${slot.powerKw ? ` · ${num(slot.powerKw, 0)}kW` : ''}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="form-grid form-grid--3">
              <div class="field">
                <label for="res-date">日期</label>
                <div class="input-shell"><input id="res-date" name="date" type="date" min="${minDate}" max="${maxDate}" value="${dateInputValue(defaultStart)}" required></div>
              </div>
              <div class="field">
                <label for="res-time">开始时间</label>
                <div class="input-shell"><input id="res-time" name="time" type="time" step="1800" value="${timeInputValue(defaultStart)}" required></div>
              </div>
              <div class="field">
                <label for="res-duration">时长</label>
                <select id="res-duration" name="durationMinutes">
                  <option value="30">30 分钟</option>
                  <option value="60" selected>1 小时</option>
                  <option value="90">1.5 小时</option>
                  <option value="120">2 小时</option>
                  <option value="180">3 小时</option>
                  <option value="240">4 小时</option>
                  <option value="480">8 小时</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label for="res-note">备注 <span style="font-weight:400;color:var(--muted-2)">（可选）</span></label>
              <input id="res-note" name="note" type="text" maxlength="80" placeholder="例如：下班后取车" style="width:100%;height:44px;padding:0 11px;border:1px solid var(--line-strong);border-radius:10px;outline:none;background:#fff;font-size:11.5px">
            </div>
            <div class="reservation-summary" id="reservation-summary">
              <div><span>预计费用</span><strong data-summary-total>—</strong></div>
              <small data-summary-note>按 30 分钟停车 + 预计充电量估算</small>
            </div>
            <div class="form-error inline-error" data-modal-error hidden></div>
            <div class="modal-actions">
              <button type="button" class="btn btn--ghost" data-action="close-modal">取消</button>
              <button type="submit" class="btn btn--lime">${icon('calendarCheck')}确认预约</button>
            </div>
          </form>
        `
      });
      updateReservationSummary();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function updateReservationSummary() {
    const form = $('form[data-form="reservation"]');
    if (!form) return;
    const slotId = Number(form.slotId.value);
    const duration = Number(form.durationMinutes.value) || 60;
    const vehicleId = Number(form.vehicleId.value);
    const slot = state.slotsData?.slots.find((item) => item.id === slotId);
    const vehicle = state.vehiclesData?.vehicles.find((item) => item.id === vehicleId);
    const totalEl = $('[data-summary-total]');
    const noteEl = $('[data-summary-note]');
    if (!slot) return;
    const parking = Math.ceil(duration / 30) * 0.5 * Number(slot.pricePerHour || 0);
    let energy = 0;
    if (slot.powerKw && vehicle) {
      energy = Math.min((duration / 60) * Number(slot.powerKw) * 0.55, Number(vehicle.batteryKwh) * 0.8);
    }
    const total = parking + energy * 1.5;
    if (totalEl) totalEl.textContent = `¥${money(total)}`;
    if (noteEl) {
      noteEl.textContent = slot.powerKw
        ? `停车 ¥${money(parking)} + 预计充电 ${num(energy, 1)} kWh`
        : `停车 ¥${money(parking)} · 标准车位`;
    }
  }

  // -----------------------------------------------------------------------
  // Modals: start / end / check-in / cancellation
  // -----------------------------------------------------------------------

  async function openStartSessionModal(slotId) {
    try {
      const [vehicles, slotsData] = await Promise.all([ensureVehicles(), ensureSlots()]);
      if (!vehicles.length) {
        toast('请先绑定一辆爱车', 'info');
        openVehicleModal();
        return;
      }
      const slot = slotsData.slots.find((item) => item.id === slotId);
      if (!slot) { toast('车位不存在，请刷新页面', 'error'); return; }
      if (slot.state !== 'available') { toast('该车位当前不可用', 'error'); return; }
      if (slotsData.activeSession) {
        toast('你已有一个进行中的停车订单', 'info');
        openEndSessionModal(slotsData.activeSession);
        return;
      }
      openModal({
        title: '开始停车',
        kicker: 'START SESSION',
        subtitle: '确认后立即开始计时，车位会同步锁定。',
        content: `
          <form class="modal-form" data-form="start-session" novalidate>
            <input type="hidden" name="slotId" value="${slot.id}">
            <div class="reservation-summary">
              <div><span>${esc(slot.code)} · ${esc(slot.zoneName)}</span><strong>${slot.powerKw ? `${num(slot.powerKw, 0)} kW ${slot.kind === 'dc' ? '快充' : '慢充'}` : '标准车位'}</strong></div>
              <small>¥${num(slot.pricePerHour, 0)} / 小时</small>
            </div>
            <div class="field">
              <label for="start-vehicle">入场车辆</label>
              <select id="start-vehicle" name="vehicleId" required>
                ${vehicles.map((vehicle) => `<option value="${vehicle.id}" ${vehicle.isPrimary ? 'selected' : ''}>${esc(vehicle.model)} · ${esc(vehicle.plate)}</option>`).join('')}
              </select>
            </div>
            <p class="modal-grid-note">${slot.powerKw ? '入场后将自动开始充电。' : '入场后开始停车计时。'}停车费按 30 分钟计算，结束后统一结算。</p>
            <div class="form-error inline-error" data-modal-error hidden></div>
            <div class="modal-actions">
              <button type="button" class="btn btn--ghost" data-action="close-modal">再想想</button>
              <button type="submit" class="btn btn--lime">${icon('bolt')}立即开始</button>
            </div>
          </form>
        `
      });
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function findSession(sessionId) {
    return state.slotsData?.activeSession?.id === sessionId ? state.slotsData.activeSession
      : state.sessionsData?.activeSession?.id === sessionId ? state.sessionsData.activeSession
        : state.dashboard?.activeSession?.id === sessionId ? state.dashboard.activeSession
          : null;
  }

  function openEndSessionModal(session) {
    if (!session) { toast('找不到进行中的订单', 'error'); return; }
    const estimate = Number(session.totalFee || 0);
    openModal({
      title: '结束并结算',
      kicker: 'END SESSION',
      subtitle: `即将结束 ${session.slot.code} 的停车订单。`,
      content: `
        <form class="modal-form" data-form="end-session" novalidate>
          <input type="hidden" name="sessionId" value="${session.id}">
          <div class="reservation-summary">
            <div><span>${esc(session.vehicle.plate)} · ${esc(session.vehicle.model)}</span><strong>¥${money(estimate)}</strong></div>
            <small>预计结算金额</small>
          </div>
          <div class="receipt-box">
            <div class="receipt-row"><span>车位</span><strong>${esc(session.slot.code)}</strong></div>
            <div class="receipt-row"><span>停车时长</span><strong>${humanDuration(session.durationMinutes)}</strong></div>
            <div class="receipt-row"><span>充电量</span><strong>${num(session.energyKwh, 1)} kWh</strong></div>
            <div class="receipt-row"><span>停车费</span><strong>¥${money(session.parkingFee)}</strong></div>
            <div class="receipt-row"><span>充电服务费</span><strong>¥${money(session.energyFee)}</strong></div>
          </div>
          <p class="modal-grid-note">结束后车位将立即释放，最终金额以实际使用时长和电量计算。</p>
          <div class="form-error inline-error" data-modal-error hidden></div>
          <div class="modal-actions">
            <button type="button" class="btn btn--ghost" data-action="close-modal">继续充电</button>
            <button type="submit" class="btn btn--lime">${icon('receipt')}确认结算</button>
          </div>
        </form>
      `
    });
  }

  async function openCheckInModal(reservationId) {
    let reservation = state.reservationsData?.upcoming.find((item) => item.id === reservationId)
      || state.reservationsData?.active.find((item) => item.id === reservationId);
    if (!reservation) {
      try {
        const res = await api('/reservations');
        state.reservationsData = res;
        reservation = res.upcoming.find((item) => item.id === reservationId)
          || res.active.find((item) => item.id === reservationId);
      } catch (error) {
        toast(error.message, 'error');
        return;
      }
    }
    if (!reservation) { toast('预约不存在', 'error'); return; }
    openModal({
      title: '签到入场',
      kicker: 'CHECK IN',
      subtitle: '确认车辆已到达车位，签到后开始计时。',
      content: `
        <form class="modal-form" data-form="check-in" novalidate>
          <input type="hidden" name="reservationId" value="${reservation.id}">
          <div class="reservation-summary">
            <div><span>${esc(reservation.slot.code)} · ${formatRange(reservation.startAt, reservation.endAt)}</span><strong>${esc(reservation.vehicle.plate)}</strong></div>
            <small>${reservation.slot.powerKw ? `${num(reservation.slot.powerKw, 0)} kW 充电位` : '标准车位'}</small>
          </div>
          <div class="detail-block" style="margin-top:0;background:#f5f8ef">
            <div class="detail-block__label"><span>签到提示</span><strong>开始前 15 分钟</strong></div>
            <p>请确认车辆已停入车位。签到后计时开始，预约状态会变为进行中。</p>
          </div>
          <div class="form-error inline-error" data-modal-error hidden></div>
          <div class="modal-actions">
            <button type="button" class="btn btn--ghost" data-action="close-modal">取消</button>
            <button type="submit" class="btn btn--lime">${icon('check')}确认签到</button>
          </div>
        </form>
      `
    });
  }

  function openCancelReservationModal(reservationId) {
    const reservation = state.reservationsData?.upcoming.find((item) => item.id === reservationId);
    if (!reservation) return;
    openModal({
      title: '取消预约？',
      kicker: 'CANCEL RESERVATION',
      subtitle: '车位释放后，其他车主可以直接使用。',
      content: `
        <form class="modal-form" data-form="cancel-reservation" novalidate>
          <input type="hidden" name="reservationId" value="${reservation.id}">
          <div class="reservation-summary">
            <div><span>${esc(reservation.slot.code)} · ${formatRange(reservation.startAt, reservation.endAt)}</span><strong>${esc(reservation.vehicle.plate)}</strong></div>
            <small>${humanDuration(reservation.durationMinutes)}</small>
          </div>
          <p class="modal-grid-note">取消后不可恢复。你可以随时重新预约该车位。</p>
          <div class="form-error inline-error" data-modal-error hidden></div>
          <div class="modal-actions">
            <button type="button" class="btn btn--ghost" data-action="close-modal">保留预约</button>
            <button type="submit" class="btn btn--danger">${icon('x')}确认取消</button>
          </div>
        </form>
      `
    });
  }

  function openReceiptModal(session) {
    openModal({
      title: '结算完成',
      kicker: 'RECEIPT',
      subtitle: '这次停车已经结束，车位已释放。',
      className: 'modal--receipt',
      content: `
        <div class="receipt-head">
          <div class="receipt-check">${icon('check')}</div>
          <h3>谢谢使用 VoltPark</h3>
          <p>${esc(session.slot.code)} · ${esc(session.vehicle.plate)}</p>
        </div>
        <div class="receipt-box">
          <div class="receipt-row"><span>停车时长</span><strong>${humanDuration(session.durationMinutes)}</strong></div>
          <div class="receipt-row"><span>充电量</span><strong>${num(session.energyKwh, 1)} kWh</strong></div>
          <div class="receipt-row"><span>停车费</span><strong>¥${money(session.parkingFee)}</strong></div>
          <div class="receipt-row"><span>充电服务费</span><strong>¥${money(session.energyFee)}</strong></div>
          <div class="receipt-row"><span>减免 / 优惠</span><strong>¥0.00</strong></div>
        </div>
        <div class="receipt-total"><span>本次实付</span><strong>¥${money(session.totalFee)}</strong></div>
        <div class="receipt-actions">
          <button type="button" class="btn btn--outline" data-action="close-modal">关闭</button>
          <button type="button" class="btn btn--dark" data-action="view-sessions">${icon('receipt')}查看账单</button>
        </div>
      `
    });
  }

  // -----------------------------------------------------------------------
  // Modals: vehicles / profile / notifications / maintenance
  // -----------------------------------------------------------------------

  function openVehicleModal() {
    openModal({
      title: '绑定爱车',
      kicker: 'ADD YOUR EV',
      subtitle: '车辆信息仅保存在本机，用于停车服务。',
      content: `
        <form class="modal-form" data-form="add-vehicle" novalidate>
          <div class="form-grid">
            <div class="field">
              <label for="vehicle-plate">车牌号</label>
              <div class="input-shell"><input id="vehicle-plate" name="plate" type="text" placeholder="沪A·D88521" maxlength="10" required></div>
            </div>
            <div class="field">
              <label for="vehicle-model">车型</label>
              <div class="input-shell"><input id="vehicle-model" name="model" type="text" placeholder="例如：小鹏 G6" maxlength="40" required></div>
            </div>
          </div>
          <div class="form-grid">
            <div class="field">
              <label for="vehicle-battery">电池容量（kWh）</label>
              <div class="input-shell"><input id="vehicle-battery" name="batteryKwh" type="number" min="10" max="200" step="0.1" value="60" required></div>
            </div>
            <div class="field">
              <label for="vehicle-connector">充电接口</label>
              <select id="vehicle-connector" name="connector">
                <option value="国标直流">国标直流</option>
                <option value="国标交流">国标交流</option>
              </select>
            </div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;color:var(--muted);font-size:9.5px;cursor:pointer">
            <input type="checkbox" name="isPrimary" style="accent-color:var(--teal)"> 设为默认车辆
          </label>
          <p class="field-hint">车牌号支持新能源 7–8 位格式，例如 沪A·D88521。</p>
          <div class="form-error inline-error" data-modal-error hidden></div>
          <div class="modal-actions">
            <button type="button" class="btn btn--ghost" data-action="close-modal">取消</button>
            <button type="submit" class="btn btn--lime">${icon('plus')}完成绑定</button>
          </div>
        </form>
      `
    });
  }

  function openDeleteVehicleModal(vehicleId) {
    const vehicle = state.vehiclesData?.vehicles.find((item) => item.id === vehicleId);
    if (!vehicle) return;
    openModal({
      title: '解绑这辆车？',
      kicker: 'UNBIND VEHICLE',
      subtitle: '解绑后将无法再用该车辆停车或预约。',
      content: `
        <form class="modal-form" data-form="delete-vehicle">
          <input type="hidden" name="vehicleId" value="${vehicle.id}">
          <div class="reservation-summary">
            <div><span>${esc(vehicle.model)}</span><strong>${esc(vehicle.plate)}</strong></div>
            <small>${num(vehicle.batteryKwh, 1)} kWh</small>
          </div>
          <p class="modal-grid-note">解绑后车辆会从列表中移除，历史停车账单仍会保留。如果车辆有进行中的订单或预约，系统会拒绝解绑。</p>
          <div class="form-error inline-error" data-modal-error hidden></div>
          <div class="modal-actions">
            <button type="button" class="btn btn--ghost" data-action="close-modal">保留车辆</button>
            <button type="submit" class="btn btn--danger">${icon('trash')}确认解绑</button>
          </div>
        </form>
      `
    });
  }

  function openProfileModal() {
    if (!state.user) return;
    const user = state.user;
    openModal({
      title: '账户信息',
      kicker: 'YOUR ACCOUNT',
      subtitle: '所有数据保存在本机 SQLite 数据库中。',
      content: `
        <div class="modal-profile-head">
          <span class="avatar" style="background:${esc(safeColor(user.avatarColor))}">${esc(Array.from(user.name)[0] || 'V')}</span>
          <div><h3>${esc(user.name)}</h3><p>${esc(user.email)}</p></div>
        </div>
        <div class="profile-list">
          <div class="profile-row"><span>账户角色</span><strong>${user.role === 'admin' ? '运营管理员' : '车主账户'}</strong></div>
          <div class="profile-row"><span>登录方式</span><strong>邮箱 + 密码</strong></div>
          <div class="profile-row"><span>数据位置</span><strong>SQLite · 本机</strong></div>
          <div class="profile-row"><span>会话安全</span><strong>HttpOnly Cookie</strong></div>
          <div class="profile-row"><span>加入时间</span><strong>${formatDateTime(user.createdAt, { dateOnly: true })}</strong></div>
        </div>
        <div class="profile-actions">
          <button type="button" class="btn btn--outline" data-action="close-modal">关闭</button>
          <button type="button" class="btn btn--danger" data-action="logout">${icon('logout')}退出登录</button>
        </div>
      `
    });
  }

  async function openNotificationsModal() {
    let dashboard = state.dashboard;
    if (!dashboard) {
      try {
        dashboard = await api('/dashboard');
        state.dashboard = dashboard;
        updateGlobalSummary();
      } catch (error) {
        toast(error.message, 'error');
        return;
      }
    }
    const active = dashboard.activeSession;
    const upcoming = dashboard.upcomingReservation;
    const items = [];
    if (active) {
      const activeCharging = Number(active.powerKw) > 0;
      items.push({
        icon: activeCharging ? 'bolt' : 'parking',
        title: `${active.slot.code} ${activeCharging ? '充电' : '停车'}进行中`,
        description: `${active.vehicle.plate} · ${activeCharging ? `已充 ${num(active.energyKwh, 1)} kWh，` : '标准车位，'}预计 ¥${money(active.totalFee)}`,
        time: active.startedAt
      });
    }
    if (upcoming) {
      items.push({
        icon: 'calendarCheck',
        title: `预约提醒 · ${upcoming.slot.code}`,
        description: `${formatRange(upcoming.startAt, upcoming.endAt)} · ${upcoming.vehicle.plate}`,
        time: upcoming.startAt
      });
    }
    items.push(...(dashboard.activity || []).slice(0, 4).map((item) => ({
      icon: item.kind === 'reservation' ? 'calendarCheck' : item.kind === 'charging' ? 'bolt' : 'receipt',
      title: item.title,
      description: item.description,
      time: item.time
    })));
    openModal({
      title: '消息中心',
      kicker: 'NOTIFICATIONS',
      subtitle: '来自本地停车场的实时提醒。',
      content: items.length ? `
        <div class="notification-list">
          ${items.map((item) => `
            <div class="activity-item" style="padding-left:0;padding-right:0">
              <span class="activity-icon">${icon(item.icon)}</span>
              <div class="activity-copy"><strong>${esc(item.title)}</strong><span>${esc(item.description)}</span></div>
              <span class="activity-time">${relativeTime(item.time)}</span>
            </div>
          `).join('')}
        </div>
        <div class="modal-actions"><button type="button" class="btn btn--dark" data-action="close-modal">知道了</button></div>
      ` : `
        <div class="empty-state" style="min-height:190px">
          <div class="empty-state__icon">${icon('mailOpen')}</div>
          <h3>暂时没有新消息</h3>
          <p>开始停车或预约后，实时提醒会出现在这里。</p>
        </div>
      `
    });
  }

  function openMaintenanceModal(slotId, status) {
    const slot = state.slotsData?.slots.find((item) => item.id === slotId)
      || state.adminData?.slots.find((item) => item.id === slotId);
    if (!slot) return;
    const makingMaintenance = status === 'maintenance';
    openModal({
      title: makingMaintenance ? '设为维护车位？' : '恢复车位运营？',
      kicker: 'SLOT OPERATIONS',
      subtitle: `${slot.code} · ${slot.zoneName}`,
      content: `
        <form class="modal-form" data-form="toggle-maintenance">
          <input type="hidden" name="slotId" value="${slot.id}">
          <input type="hidden" name="status" value="${status}">
          <div class="reservation-summary">
            <div><span>${esc(slot.code)} · ${esc(slot.kindLabel)}</span><strong>${makingMaintenance ? '暂停使用' : '恢复使用'}</strong></div>
            <small>${slot.powerKw ? `${num(slot.powerKw, 0)} kW` : '标准车位'}</small>
          </div>
          <p class="modal-grid-note">${makingMaintenance ? '切换后该车位将无法被预约或开始停车。正在使用或有未来预约的车位不能设为维护。' : '恢复后车位会立即重新开放预约与停车。'}</p>
          <div class="form-error inline-error" data-modal-error hidden></div>
          <div class="modal-actions">
            <button type="button" class="btn btn--ghost" data-action="close-modal">取消</button>
            <button type="submit" class="btn ${makingMaintenance ? 'btn--danger' : 'btn--lime'}">${makingMaintenance ? icon('shield') + '确认维护' : icon('check') + '恢复运营'}</button>
          </div>
        </form>
      `
    });
  }

  // -----------------------------------------------------------------------
  // Form submission
  // -----------------------------------------------------------------------

  async function handleFormSubmit(event) {
    const form = event.target;
    if (form.id === 'auth-form') {
      await handleAuthSubmit(event);
      return;
    }
    const kind = form.dataset.form;
    if (!kind) return;
    event.preventDefault();
    showModalError(form, '');
    setFormBusy(form, true);
    const formData = new FormData(form);
    state.busy = true;

    try {
      if (kind === 'reservation') {
        const date = String(formData.get('date') || '');
        const time = String(formData.get('time') || '');
        const start = new Date(`${date}T${time}:00`);
        if (Number.isNaN(start.getTime())) {
          throw new ApiFailure('请选择有效的开始时间');
        }
        if (start.getTime() < Date.now() - 5 * 60000) {
          throw new ApiFailure('预约开始时间不能早于当前时间');
        }
        const payload = {
          slotId: Number(formData.get('slotId')),
          vehicleId: Number(formData.get('vehicleId')),
          startAt: start.toISOString(),
          durationMinutes: Number(formData.get('durationMinutes')),
          note: String(formData.get('note') || '').trim()
        };
        const result = await api('/reservations', { method: 'POST', body: payload });
        closeModal();
        toast(result.message || '车位预约成功');
        await goAndReload('reservations');
      } else if (kind === 'start-session') {
        const payload = {
          slotId: Number(formData.get('slotId')),
          vehicleId: Number(formData.get('vehicleId'))
        };
        const result = await api('/sessions/start', { method: 'POST', body: payload });
        closeModal();
        toast(result.message || '停车已开始');
        clearDataCache();
        await loadPage('map', { force: true, background: true });
        updateGlobalSummary();
      } else if (kind === 'end-session') {
        const sessionId = Number(formData.get('sessionId'));
        const result = await api(`/sessions/${sessionId}/end`, { method: 'POST' });
        closeModal();
        toast(result.message || '订单已结算');
        const currentPage = state.page;
        clearDataCache();
        if (currentPage === 'map') await loadPage('map', { force: true, background: true });
        else await loadPage(currentPage || 'dashboard', { force: true, background: true });
        openReceiptModal(result.session);
      } else if (kind === 'check-in') {
        const reservationId = Number(formData.get('reservationId'));
        const result = await api(`/reservations/${reservationId}/check-in`, { method: 'POST' });
        closeModal();
        toast(result.message || '签到成功');
        await goAndReload('sessions');
      } else if (kind === 'cancel-reservation') {
        const reservationId = Number(formData.get('reservationId'));
        const result = await api(`/reservations/${reservationId}/cancel`, { method: 'POST' });
        closeModal();
        toast(result.message || '预约已取消', 'info');
        await goAndReload('reservations');
      } else if (kind === 'add-vehicle') {
        const payload = {
          plate: String(formData.get('plate') || '').trim(),
          model: String(formData.get('model') || '').trim(),
          batteryKwh: Number(formData.get('batteryKwh')),
          connector: String(formData.get('connector') || ''),
          isPrimary: formData.get('isPrimary') === 'on'
        };
        const result = await api('/vehicles', { method: 'POST', body: payload });
        closeModal();
        toast(result.message || '爱车已绑定');
        state.vehiclesData = null;
        clearDataCache();
        if (state.page === 'vehicles') await loadPage('vehicles', { force: true });
        else if (state.page) await loadPage(state.page, { force: true, background: true });
      } else if (kind === 'delete-vehicle') {
        const vehicleId = Number(formData.get('vehicleId'));
        await api(`/vehicles/${vehicleId}`, { method: 'DELETE' });
        closeModal();
        toast('车辆已解绑', 'info');
        state.vehiclesData = null;
        clearDataCache();
        if (state.page === 'vehicles') await loadPage('vehicles', { force: true });
        else if (state.page) await loadPage(state.page, { force: true, background: true });
      } else if (kind === 'toggle-maintenance') {
        const slotId = Number(formData.get('slotId'));
        const status = String(formData.get('status'));
        const result = await api(`/admin/slots/${slotId}`, { method: 'PATCH', body: { status } });
        closeModal();
        toast(result.message || '车位状态已更新');
        await goAndReload('admin');
      }
    } catch (error) {
      showModalError(form, error.message || '操作没有完成');
    } finally {
      state.busy = false;
      setFormBusy(form, false);
    }
  }

  // -----------------------------------------------------------------------
  // Other actions
  // -----------------------------------------------------------------------

  async function setPrimaryVehicle(vehicleId) {
    try {
      const result = await api(`/vehicles/${vehicleId}`, { method: 'PATCH' });
      toast(result.message || '已设为默认车辆');
      state.vehiclesData = null;
      clearDataCache();
      await loadPage('vehicles', { force: true });
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function exportSessions() {
    const history = state.sessionsData?.history || [];
    if (!history.length) {
      toast('还没有可以导出的记录', 'info');
      return;
    }
    const header = ['日期', '车位', '车辆', '时长（分钟）', '电量（kWh）', '停车费（元）', '充电服务费（元）', '总费用（元）', '状态'];
    const lines = [header, ...history.map((session) => [
      formatDateTime(session.startedAt),
      session.slot.code,
      session.vehicle.plate,
      session.durationMinutes,
      session.energyKwh,
      session.parkingFee,
      session.energyFee,
      session.totalFee,
      '已完成'
    ])];
    const csv = '\uFEFF' + lines.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `voltpark-charging-${dateInputValue(new Date()).replace(/-/g, '')}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast(`已导出 ${history.length} 条记录`);
  }

  // -----------------------------------------------------------------------
  // Toast
  // -----------------------------------------------------------------------

  function toast(message, type = 'success') {
    if (!message) return;
    const item = document.createElement('div');
    item.className = `toast${type === 'error' ? ' toast--error' : type === 'info' ? ' toast--info' : ''}`;
    const iconName = type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check';
    item.innerHTML = `<span class="toast__icon">${icon(iconName)}</span><p>${esc(message)}</p>`;
    toastRoot.appendChild(item);
    window.setTimeout(() => {
      item.classList.add('is-leaving');
      window.setTimeout(() => item.remove(), 230);
    }, 3600);
  }

  // -----------------------------------------------------------------------
  // Event wiring
  // -----------------------------------------------------------------------

  function bindEvents() {
    document.addEventListener('submit', (event) => {
      if (event.defaultPrevented) return;
      if (event.target.id === 'auth-form') {
        event.preventDefault();
        handleAuthSubmit(event);
      } else if (event.target.matches('form[data-form]')) {
        event.preventDefault();
        handleFormSubmit(event);
      }
    });

    document.addEventListener('click', async (event) => {
      const authTab = event.target.closest('[data-auth-tab]');
      if (authTab) {
        event.preventDefault();
        setAuthMode(authTab.dataset.authTab);
        return;
      }

      const actionElement = event.target.closest('[data-action]');
      if (!actionElement) return;
      if (actionElement.disabled) return;
      const action = actionElement.dataset.action;
      if (!action) return;

      try {
        switch (action) {
          case 'nav':
            navigate(actionElement.dataset.page);
            break;
          case 'toggle-password': {
            const input = $('#auth-password');
            if (!input) break;
            const showing = input.type === 'text';
            input.type = showing ? 'password' : 'text';
            actionElement.setAttribute('aria-label', showing ? '显示密码' : '隐藏密码');
            actionElement.innerHTML = icon(showing ? 'eye' : 'eyeOff');
            break;
          }
          case 'fill-demo': {
            setAuthMode('login', { focus: false });
            const email = $('#auth-email');
            const password = $('#auth-password');
            if (email) email.value = 'demo@evpark.cn';
            if (password) password.value = 'Demo1234';
            setAuthError('');
            password?.focus();
            break;
          }
          case 'logout':
            await doLogout();
            break;
          case 'refresh': {
            actionElement.disabled = true;
            await loadPage(state.page, { force: true });
            actionElement.disabled = false;
            break;
          }
          case 'retry':
            await loadPage(state.page || 'dashboard', { force: true });
            break;
          case 'notifications':
            await openNotificationsModal();
            break;
          case 'open-profile':
            openProfileModal();
            break;
          case 'open-reserve':
            await openReservationModal(actionElement.dataset.slotId ? Number(actionElement.dataset.slotId) : null);
            break;
          case 'select-slot': {
            const slotId = Number(actionElement.dataset.slotId);
            state.selectedSlotId = slotId;
            if (state.page === 'map') {
              refreshMapContent();
              if (window.innerWidth <= 920) {
                $('#slot-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            } else {
              navigate('map');
            }
            break;
          }
          case 'filter': {
            const group = actionElement.dataset.filterGroup;
            const value = actionElement.dataset.filterValue;
            if (group === 'zone' || group === 'kind') {
              state.filters[group] = value;
              $$(`[data-filter-group="${group}"]`).forEach((button) => {
                button.classList.toggle('is-active', button.dataset.filterValue === value);
              });
              refreshMapContent();
            }
            break;
          }
          case 'start-session':
            await openStartSessionModal(Number(actionElement.dataset.slotId));
            break;
          case 'end-session': {
            const sessionId = Number(actionElement.dataset.sessionId);
            const session = findSession(sessionId);
            if (session) {
              openEndSessionModal(session);
            } else {
              try {
                const sessions = await api('/sessions');
                state.sessionsData = sessions;
                if (sessions.activeSession) openEndSessionModal(sessions.activeSession);
                else toast('没有找到进行中的订单', 'info');
              } catch (error) {
                toast(error.message, 'error');
              }
            }
            break;
          }
          case 'check-in':
            await openCheckInModal(Number(actionElement.dataset.reservationId));
            break;
          case 'cancel-reservation':
            openCancelReservationModal(Number(actionElement.dataset.reservationId));
            break;
          case 'res-tab':
            state.resTab = actionElement.dataset.tab;
            renderReservationsPage();
            break;
          case 'open-add-vehicle':
            openVehicleModal();
            break;
          case 'delete-vehicle':
            openDeleteVehicleModal(Number(actionElement.dataset.vehicleId));
            break;
          case 'set-primary':
            actionElement.disabled = true;
            await setPrimaryVehicle(Number(actionElement.dataset.vehicleId));
            break;
          case 'toggle-maintenance':
            openMaintenanceModal(Number(actionElement.dataset.slotId), actionElement.dataset.status);
            break;
          case 'export-sessions':
            exportSessions();
            break;
          case 'close-modal':
            closeModal();
            break;
          case 'view-sessions':
            closeModal();
            navigate('sessions');
            break;
          default:
            break;
        }
      } catch (error) {
        toast(error.message || '操作没有完成', 'error');
      }
    });

    document.addEventListener('input', (event) => {
      if (event.target.id === 'slot-search') {
        state.filters.query = event.target.value;
        refreshMapContent();
        return;
      }
      if (event.target.closest('form[data-form="reservation"]')) {
        updateReservationSummary();
      }
    });

    document.addEventListener('change', (event) => {
      if (event.target.closest('form[data-form="reservation"]')) {
        updateReservationSummary();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.modalOpen) {
        closeModal();
      }
    });

    modalRoot.addEventListener('click', (event) => {
      if (event.target.matches('[data-modal-backdrop]')) {
        closeModal();
      }
    });

    window.addEventListener('hashchange', () => {
      if (state.user) route();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.user) {
        const lastRefresh = Number(sessionStorage.getItem('voltpark-last-refresh') || 0);
        if (Date.now() - lastRefresh > 60000) {
          sessionStorage.setItem('voltpark-last-refresh', String(Date.now()));
          loadPage(state.page, { background: true });
        }
      }
    });
  }

  // Go.
  document.addEventListener('DOMContentLoaded', init);
})();
