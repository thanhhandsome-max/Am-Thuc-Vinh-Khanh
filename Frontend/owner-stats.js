const defaultServerUrl = window.location.port === '3000'
  ? `${window.location.protocol}//${window.location.hostname}:5080`
  : (window.location.port === '5080' ? window.location.origin : `${window.location.protocol}//${window.location.hostname}:5080`);

const token = localStorage.getItem('authToken');
const role = localStorage.getItem('userRole');

if (!token || role !== 'Owner') {
  localStorage.clear();
  window.location.href = 'login.html';
}

const fromInput = document.getElementById('os-from-date');
const toInput = document.getElementById('os-to-date');
const applyBtn = document.getElementById('os-apply');
const refreshBtn = document.getElementById('os-refresh');
const statusDiv = document.getElementById('os-status');
const canvas = document.getElementById('os-visit-chart');
let osChart = null;
let ownerStall = null;

window.addEventListener('DOMContentLoaded', () => {
  initializeFilters();
  applyBtn?.addEventListener('click', () => { void loadAndRender(); });
  refreshBtn?.addEventListener('click', () => { void loadAndRender(); });
  fromInput?.addEventListener('change', () => applyBtn?.click());
  toInput?.addEventListener('change', () => applyBtn?.click());

  void initAndLoad();
});

function initializeFilters() {
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - 9);
  if (fromInput) fromInput.value = formatDateInputValue(from);
  if (toInput) toInput.value = formatDateInputValue(today);
}

function formatDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

async function initAndLoad() {
  try {
    // get owner's stall id
    const resp = await fetch(`${defaultServerUrl}/api/owner/pois`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!resp.ok) {
      statusDiv.innerText = 'Không lấy được thông tin quán.';
      return;
    }
    const stalls = await resp.json();
    if (!stalls || stalls.length === 0) {
      statusDiv.innerText = 'Bạn chưa có quán được đăng ký.';
      return;
    }
    ownerStall = stalls[0];
    statusDiv.innerText = `Quán: ${ownerStall.name} — ${ownerStall.address}`;
    await loadAndRender();
    // auto-refresh every 30s to keep chart fresh
    setInterval(() => { if (ownerStall) void loadAndRender(); }, 30000);
  } catch (err) {
    console.error('Init owner stats failed:', err);
    statusDiv.innerText = 'Lỗi khi khởi tạo biểu đồ.';
  }
}

async function loadAndRender() {
  if (!ownerStall) {
    statusDiv.innerText = 'Quán chưa sẵn sàng.';
    return;
  }
  const from = fromInput?.value || formatDateInputValue(new Date(Date.now() - 9*24*60*60*1000));
  const to = toInput?.value || formatDateInputValue(new Date());

  statusDiv.innerText = 'Đang tải dữ liệu...';
  try {
    const resp = await fetch(`${defaultServerUrl}/api/visits/stalls/${ownerStall.id}/daily?fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) {
      const text = await resp.text().catch(()=> '');
      statusDiv.innerText = `Lỗi tải dữ liệu: ${text || 'HTTP '+resp.status}`;
      return;
    }
    const data = await resp.json();
    renderChart(data, from, to);
    statusDiv.innerText = `Quán: ${ownerStall.name} — Hiển thị ${from} → ${to}`;
  } catch (err) {
    console.error('Load data failed:', err);
    statusDiv.innerText = 'Lỗi tải dữ liệu biểu đồ.';
  }
}

function renderChart(list, fromDate, toDate) {
  const labels = [];
  const counts = [];
  const dataMap = new Map((list||[]).map(i=>[formatDateInputValue(new Date(i.visitDate)), i.validVisitCount]));
  const start = new Date(fromDate);
  const end = new Date(toDate);
  for (const cur = new Date(start); cur <= end; cur.setDate(cur.getDate()+1)) {
    const k = formatDateInputValue(new Date(cur));
    labels.push(k);
    counts.push(dataMap.get(k) || 0);
  }

  if (!canvas) return;
  if (osChart) osChart.destroy();

  osChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Lượt ghé hợp lệ',
        data: counts,
        borderColor: '#FF7A00',
        backgroundColor: 'rgba(255,122,0,0.18)',
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: '#FF7A00',
        pointBorderColor: '#FFFFFF',
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
scales: {
    x: {
        ticks: {
            color: '#94A3B8',
            maxTicksLimit: 10,  // ← thêm dòng này
            autoSkip: true,
            maxRotation: 45,    // ← đổi từ 0 thành 45
            minRotation: 0      // ← thêm dòng này
        },
        grid: {
            color: 'rgba(148, 163, 184, 0.08)'
        }
    },
    y: {
        beginAtZero: true,
        ticks: {
            color: '#94A3B8',
            precision: 0
        },
        grid: {
            color: 'rgba(148, 163, 184, 0.08)'
        }
    }
}
    }
  });
}
