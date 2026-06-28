const defaultServerUrl = (() => {
  if (window.location.protocol === 'file:') {
    return 'http://localhost:5080';
  }
  if (window.location.port === '5080' || window.location.port === '7089') {
    return window.location.origin;
  }
  if ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port === '5241') {
    return `${window.location.protocol}//${window.location.hostname}:5080`;
  }
  if (window.location.port === '3000' || window.location.port === '4173' || window.location.port === '4200') {
    return `${window.location.protocol}//${window.location.hostname}:5080`;
  }
  if (window.location.protocol === 'https:') {
    return `${window.location.protocol}//${window.location.hostname}:7089`;
  }
  return `${window.location.protocol}//${window.location.hostname}:5080`;
})();

const interactiveSelectors = [
  '#sync-btn',
  '#sim-walk-btn',
  '#lang-picker',
  '#chat-input',
  '#chat-send-btn',
  '#play-audio-btn',
  '#gps-switch',
  '#stall-search-input',
  '#stall-search-type',
  '#stall-search-btn'
];

let gateOverlay;
let pollTimer;
let fetchPatched = false;
let paymentGateReadyPromise = null;

function isProtectedApiPath(pathname) {
  return pathname.startsWith('/api/foodstalls')
    || pathname.startsWith('/api/ai')
    || pathname.startsWith('/api/chat')
    || pathname.startsWith('/api/owner')
    || pathname.startsWith('/api/admin/heartbeat')
    || pathname.startsWith('/api/admin/visit-summary')
    || pathname.startsWith('/api/test');
}

function isAccessUnlocked() {
  const token = getSessionToken();
  if (!token) {
    return false;
  }

  const role = getUserRole();
  if (role === 'admin' || role === 'owner') {
    return true;
  }

  return localStorage.getItem('hasPaidAccess') === 'true';
}

function shouldBlockRequest(resource) {
  if (isAccessUnlocked()) {
    return false;
  }

  const requestUrl = typeof resource === 'string' ? resource : resource?.url || resource?.href || '';
  if (!requestUrl) {
    return false;
  }

  // ALLOW AUTH ENDPOINTS TO PASS THROUGH
  if (requestUrl.includes('/api/auth/device-login') || requestUrl.includes('/api/auth/login') || requestUrl.includes('/api/auth/me')) {
    return false;
  }

  const token = getSessionToken();
  if (!token) {
    return true;
  }

  try {
    const parsedUrl = new URL(requestUrl, window.location.origin);
    return isProtectedApiPath(parsedUrl.pathname);
  } catch {
    return false;
  }
}

function installFetchGate() {
  if (fetchPatched || typeof window.fetch !== 'function') {
    return;
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (resource, init) => {
    if (shouldBlockRequest(resource)) {
      return new Response(JSON.stringify({ message: 'Thanh toán thành công để mở khóa chức năng này.' }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return originalFetch(resource, init);
  };

  fetchPatched = true;
}

function ensureGateOverlay() {
  if (gateOverlay) {
    return gateOverlay;
  }

  gateOverlay = document.createElement('div');
  gateOverlay.id = 'payment-gate-overlay';
  gateOverlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:3000',
    'display:none',
    'align-items:center',
    'justify-content:center',
    'padding:24px',
    'background:rgba(3,7,18,0.82)',
    'backdrop-filter:blur(8px)'
  ].join(';');

  gateOverlay.innerHTML = `
    <div style="max-width:520px;width:100%;background:linear-gradient(180deg,#111827,#0f172a);color:#fff;border:1px solid rgba(255,255,255,0.08);border-radius:20px;box-shadow:0 24px 80px rgba(0,0,0,0.45);padding:24px;">
      <div style="font-size:14px;color:#fbbf24;text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px;">Paywall</div>
      <h2 style="margin:0 0 12px;font-size:26px;line-height:1.2;">Thanh toán để mở khóa toàn bộ chức năng</h2>
      <p id="payment-gate-message" style="margin:0 0 16px;color:#d1d5db;line-height:1.6;">
        Bạn vẫn có thể xem giao diện, nhưng cần thanh toán VNPAY thành công để sử dụng các chức năng chính.
      </p>
      <div id="payment-gate-status" style="margin-bottom:18px;font-size:14px;color:#cbd5e1;">Đang kiểm tra trạng thái thanh toán...</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button id="payment-gate-pay-btn" class="btn" style="background:#f59e0b;color:#111827;border:none;padding:10px 16px;border-radius:10px;cursor:pointer;font-weight:700;">Thanh toán VNPAY</button>
        <button id="payment-gate-refresh-btn" class="btn" style="background:#334155;color:#fff;border:none;padding:10px 16px;border-radius:10px;cursor:pointer;">Kiểm tra lại</button>
      </div>
    </div>
  `;

  document.body.appendChild(gateOverlay);

  gateOverlay.querySelector('#payment-gate-pay-btn').addEventListener('click', handlePaymentClick);
  gateOverlay.querySelector('#payment-gate-refresh-btn').addEventListener('click', checkPaymentStatus);

  return gateOverlay;
}

function getSessionToken() {
  return localStorage.getItem('authToken') || '';
}

function getUserRole() {
  return String(localStorage.getItem('userRole') || '').toLowerCase();
}

function getDeviceId() {
  let deviceId = localStorage.getItem('deviceId');
  if (!deviceId) {
    deviceId = 'DEV-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
    localStorage.setItem('deviceId', deviceId);
  }
  return deviceId;
}

function clearInvalidSession() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('userRole');
  localStorage.removeItem('hasPaidAccess');
}

function setControlsDisabled(disabled) {
  interactiveSelectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      element.disabled = disabled;
      element.style.pointerEvents = disabled ? 'none' : '';
      element.style.opacity = disabled ? '0.55' : '';
    });
  });
}

function setGateVisible(visible, message, statusText) {
  const overlay = ensureGateOverlay();
  const messageNode = overlay.querySelector('#payment-gate-message');
  const statusNode = overlay.querySelector('#payment-gate-status');

  if (messageNode && message) {
    messageNode.innerText = message;
  }

  if (statusNode && statusText) {
    statusNode.innerText = statusText;
  }

  overlay.style.display = visible ? 'flex' : 'none';
  setControlsDisabled(visible);
}

async function fetchPaymentStatus() {
  const token = getSessionToken();
  if (!token) {
    return { authenticated: false };
  }

  const response = await fetch(`${defaultServerUrl}/api/payments/status`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    if (response.status === 401) {
      return { authenticated: false, unauthorized: true };
    }

    throw new Error(await response.text());
  }

  return await response.json();
}

async function checkPaymentStatus() {
  const role = getUserRole();
  const token = getSessionToken();

  if (!token || role === 'admin' || role === 'owner') {
    setGateVisible(false);
    return;
  }

  try {
    const status = await fetchPaymentStatus();

    if (status.unauthorized) {
      clearInvalidSession();
      // Force a reload so it re-fetches device token on next start
      window.location.reload();
      return;
    }

    const hasPaidAccess = Boolean(status.hasPaidAccess);

    if (hasPaidAccess) {
      localStorage.setItem('hasPaidAccess', 'true');
      setGateVisible(false);
      if (pollTimer) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
      return;
    }

    localStorage.removeItem('hasPaidAccess');
    setGateVisible(
      true,
      `Tài khoản ${status.username || ''} cần thanh toán ${Number(status.paymentAmountVnd || 0).toLocaleString('vi-VN')} VND để mở khóa chức năng.`,
      'Đã sẵn sàng tạo mã thanh toán VNPAY.'
    );
  } catch (error) {
    setGateVisible(true, 'Không thể kiểm tra trạng thái thanh toán. Vui lòng thử lại sau.', String(error?.message || 'Lỗi không xác định'));
  }
}

async function handlePaymentClick() {
  const token = getSessionToken();
  if (!token) {
    setGateVisible(true, 'Đang khởi tạo tài khoản thiết bị...', 'Vui lòng chờ...');
    return;
  }

  const statusNode = ensureGateOverlay().querySelector('#payment-gate-status');
  if (statusNode) {
    statusNode.innerText = 'Đang tạo liên kết thanh toán...';
  }

  try {
    const returnUrl = encodeURIComponent(window.location.href);
    const response = await fetch(`${defaultServerUrl}/api/payments/create?returnUrl=${returnUrl}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        clearInvalidSession();
        window.location.reload();
        return;
      }

      throw new Error(await response.text());
    }

    const data = await response.json();
    if (!data.paymentUrl) {
      if (statusNode) {
        statusNode.innerText = 'Tài khoản đã được mở khóa hoặc không cần thanh toán.';
      }
      await checkPaymentStatus();
      return;
    }

    window.location.href = data.paymentUrl;
  } catch (error) {
    if (statusNode) {
      statusNode.innerText = error?.message || 'Không thể tạo mã thanh toán.';
    }
  }
}

function startPaymentPolling() {
  if (pollTimer) {
    return;
  }

  pollTimer = window.setInterval(() => {
    checkPaymentStatus().catch(() => {});
  }, 8000);
}

async function initPaymentGate() {
  installFetchGate();

  const role = getUserRole();
  
  if (role === 'admin' || role === 'owner') {
    return;
  }

  // Auto Device Login
  try {
    const deviceId = getDeviceId();
    const response = await fetch(`${defaultServerUrl}/api/auth/device-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.token) {
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('userRole', data.user.role);
        if (data.user.hasPaidAccess) {
          localStorage.setItem('hasPaidAccess', 'true');
        } else {
          localStorage.removeItem('hasPaidAccess');
        }
      }
    } else {
      setGateVisible(true, 'Lỗi kết nối máy chủ', 'Không thể kết nối Backend. Vui lòng bật lại Backend (dotnet run).');
      return;
    }
  } catch (err) {
    console.error('Device login failed:', err);
    setGateVisible(true, 'Lỗi kết nối máy chủ', 'Vui lòng kiểm tra xem Backend đã bật chưa (dotnet run).');
    return;
  }

  setGateVisible(true, 'Đang kiểm tra trạng thái thanh toán...', 'Nếu thanh toán đã xong, trang sẽ tự mở khóa khi xác thực xong.');
  await checkPaymentStatus();
  startPaymentPolling();
  window.refreshPaymentGate = () => checkPaymentStatus();
}

window.addEventListener('pageshow', () => {
  if (typeof window.refreshPaymentGate === 'function') {
    window.refreshPaymentGate().catch(() => {});
  }
});

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && typeof window.refreshPaymentGate === 'function') {
    window.refreshPaymentGate().catch(() => {});
  }
});

let gateResolve;
paymentGateReadyPromise = new Promise(resolve => { gateResolve = resolve; });
window.paymentGateReadyPromise = paymentGateReadyPromise;

async function executeInitPaymentGate() {
  await initPaymentGate();
  gateResolve();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', executeInitPaymentGate);
} else {
  executeInitPaymentGate();
}