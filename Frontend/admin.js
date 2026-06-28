const defaultServerUrl = window.location.port === '3000'
  ? `${window.location.protocol}//${window.location.hostname}:5080`
  : (window.location.port === '5080' ? window.location.origin : `${window.location.protocol}//${window.location.hostname}:5080`);

const role = localStorage.getItem('userRole');
const username = localStorage.getItem('username');
const initialToken = localStorage.getItem('authToken');

// Authentication check
if (!initialToken || role !== 'Admin') {
  localStorage.clear();
  window.location.href = 'login.html';
}

function getAuthToken() {
  return localStorage.getItem('authToken') || '';
}

function getAuthHeaders() {
  return { 'Authorization': `Bearer ${getAuthToken()}` };
}

function handleAuthFailure(response) {
  if (response.status === 401 || response.status === 403) {
    localStorage.clear();
    window.location.href = 'login.html';
    return true;
  }
  return false;
}

let liveMap;
let mapStallsGroup = L.featureGroup();
let mapUsersGroup = L.featureGroup();
let activeTab = 'live-tracking';
let visitRankingData = [];
let selectedVisitStore = null;
let visitChart = null;

let allUsers = [];
let allStalls = [];

// Reject modal state
let modalActionType = ''; // 'registration' or 'submission'
let modalTargetId = null;

// UI Elements
const adminNameSpan = document.getElementById('admin-name');
const logoutBtn = document.getElementById('logout-btn');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

const metricStalls = document.getElementById('metric-stalls');
const metricUsers = document.getElementById('metric-users');
const metricOnline = document.getElementById('metric-online');

const registrationsTableBody = document.getElementById('registrations-table-body');
const submissionsTableBody = document.getElementById('submissions-table-body');
const dashboardContainer = document.getElementById('dashboard-container');
const telemetryTableBody = document.getElementById('telemetry-table-body');
const usersTableBody = document.getElementById('users-table-body');
const stallsTableBody = document.getElementById('stalls-table-body');
const visitChartCanvas = document.getElementById('visit-chart-canvas');
const visitChartTitle = document.getElementById('visit-chart-title');
const visitChartSubtitle = document.getElementById('visit-chart-subtitle');
const visitFromDateInput = document.getElementById('visit-from-date');
const visitToDateInput = document.getElementById('visit-to-date');
const visitFilterApplyBtn = document.getElementById('visit-filter-apply');

const noteModal = document.getElementById('note-modal');
const modalNoteText = document.getElementById('modal-note-text');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');

const usersSearchInput = document.getElementById('users-search-input');
const stallsSearchInput = document.getElementById('stalls-search-input');
const usersActiveFilter = document.getElementById('users-active-filter');
const stallsActiveFilter = document.getElementById('stalls-active-filter');
const detailModal = document.getElementById('detail-modal');
const detailModalTitle = document.getElementById('detail-modal-title');
const detailModalBody = document.getElementById('detail-modal-body');
const detailModalCloseBtn = document.getElementById('detail-modal-close-btn');

// Initialize Admin Portal
window.addEventListener('DOMContentLoaded', () => {
  adminNameSpan.innerText = `Admin: ${username}`;

  logoutBtn.addEventListener('click', () => {
    localStorage.clear();
    window.location.href = 'login.html';
  });

  const generateAllBtn = document.getElementById('generate-all-btn');
  generateAllBtn?.addEventListener('click', async () => {
    if (!confirm('Bạn có chắc chắn muốn bắt đầu tiến trình dịch thuật và sinh âm thanh (Edge-TTS) cho tất cả các quán ăn trong hệ thống không? Tiến trình này sẽ chạy ngầm trên máy chủ.')) return;
    generateAllBtn.disabled = true;
    generateAllBtn.innerText = 'Đang kích hoạt...';
    try {
      const response = await fetch(`${defaultServerUrl}/api/admin/localizations/generate-all`, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      if (response.ok) {
        alert('Đã kích hoạt tiến trình sinh âm thanh thuyết minh toàn bộ hệ thống thành công! Máy chủ đang thực hiện chạy ngầm.');
      } else {
        alert('Không thể kích hoạt tiến trình: ' + await response.text());
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi kết nối khi gửi yêu cầu.');
    } finally {
      generateAllBtn.disabled = false;
      generateAllBtn.innerText = '⚙️ Tạo toàn bộ Audio';
    }
  });

  // Wire Tab switching
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      activeTab = btn.getAttribute('data-tab');
      document.getElementById(activeTab).classList.add('active');

      if (activeTab === 'live-tracking' && liveMap) {
        // Redraw Leaflet map container fix
        setTimeout(() => liveMap.invalidateSize(), 100);
      }
    });
  });

  // Modal handlers
  modalCancelBtn.addEventListener('click', () => {
    noteModal.style.display = 'none';
    modalNoteText.value = '';
  });

  modalConfirmBtn.addEventListener('click', handleModalConfirm);

  initializeVisitFilters();
  visitFilterApplyBtn.addEventListener('click', () => {
    if (selectedVisitStore) {
      void loadSelectedStoreChart();
    }
  });
  visitFromDateInput?.addEventListener('change', () => {
    if (selectedVisitStore) {
      void loadSelectedStoreChart();
    }
  });
  visitToDateInput?.addEventListener('change', () => {
    if (selectedVisitStore) {
      void loadSelectedStoreChart();
    }
  });

  // Initialize Map
  initLiveMap();

  // Load Dashboard Data
  refreshDashboardData();

  // Set interval to update metrics and live tracking map coordinates
  setInterval(refreshDashboardData, 10000);

  // Detail Modal Close
  detailModalCloseBtn?.addEventListener('click', () => {
    detailModal.style.display = 'none';
  });

  // Users Search Input
  usersSearchInput?.addEventListener('input', filterAndRenderUsers);
  usersActiveFilter?.addEventListener('change', filterAndRenderUsers);

  // Stalls Search Input
  stallsSearchInput?.addEventListener('input', filterAndRenderStalls);
  stallsActiveFilter?.addEventListener('change', filterAndRenderStalls);
});

// Refresh all live dashboard statistics
async function refreshDashboardData() {
  await loadMetrics();

  if (activeTab === 'live-tracking') {
    await loadLiveUsersOnMap();
  } else if (activeTab === 'registrations') {
    await loadRegistrations();
  } else if (activeTab === 'submissions') {
    await loadSubmissions();
  } else if (activeTab === 'visits-dashboard') {
    await loadDashboardStats();
  } else if (activeTab === 'users-management') {
    await loadUsers();
  } else if (activeTab === 'stalls-management') {
    await loadAllStalls();
  } else if (activeTab === 'telemetry') {
    await loadTelemetryLogs();
  }
}

// Load top metrics cards
async function loadMetrics() {
  try {
    const response = await fetch(`${defaultServerUrl}/api/admin/metrics`, {
      headers: getAuthHeaders()
    });

    if (response.ok) {
      const data = await response.json();
      metricStalls.innerText = data.totalStalls;
      metricUsers.innerText = data.totalUsers;
      metricOnline.innerText = data.activeUsers;
    } else if (!handleAuthFailure(response)) {
      console.error('Load metrics failed:', response.status, await response.text().catch(() => ''));
    }
  } catch (err) {
    console.error('Load metrics failed:', err);
  }
}

// Initialize Leaflet Map for Admin Tracking
function initLiveMap() {
  const vinhKhanhCenter = [10.760124, 106.702958];
  liveMap = L.map('live-map', {
    zoomControl: true,
    attributionControl: false
  }).setView(vinhKhanhCenter, 16);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(liveMap);

  mapStallsGroup.addTo(liveMap);
  mapUsersGroup.addTo(liveMap);

  loadStallsOnMap();
}

// Draw static food stalls
async function loadStallsOnMap() {
  try {
    const response = await fetch(`${defaultServerUrl}/api/foodstalls`);
    if (response.ok) {
      const stalls = await response.json();
      mapStallsGroup.clearLayers();

      stalls.forEach(stall => {
        // Only show verified stalls to general visitor, but show all to Admin
        const orangeIcon = L.divIcon({
          html: `<div class="pin-marker" style="background: ${stall.isVerified ? '#FF7A00' : '#858585'}; width: 22px; height: 22px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); margin: -11px 0 0 -11px; border: 2px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.4);"></div>`,
          className: 'custom-stall-icon',
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });

        L.marker([stall.latitude, stall.longitude], { icon: orangeIcon })
          .bindPopup(`<b>${stall.name}</b><br>${stall.address}<br>Trạng thái: ${stall.isVerified ? 'Công khai' : 'Đang duyệt'}`)
          .addTo(mapStallsGroup);
      });
    }
  } catch (err) {
    console.error('Failed loading stalls on admin map:', err);
  }
}

// Draw active live users pulse pins
async function loadLiveUsersOnMap() {
  try {
    const response = await fetch(`${defaultServerUrl}/api/admin/active-users`, {
      headers: getAuthHeaders()
    });

    if (response.ok) {
      const users = await response.json();
      mapUsersGroup.clearLayers();

      users.forEach(user => {
        const blueRadarIcon = L.divIcon({
          html: `<div style="position: relative; width: 14px; height: 14px;">
                   <div style="background: #3b82f6; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white;"></div>
                   <div style="position: absolute; top: -5px; left: -5px; width: 24px; height: 24px; border-radius: 50%; border: 2px solid #3b82f6; opacity: 0.5; animation: pulse 1.6s infinite;"></div>
                 </div>`,
          className: 'custom-user-radar',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });

        const activeTime = new Date(user.lastActive).toLocaleTimeString();
        L.marker([user.latitude, user.longitude], { icon: blueRadarIcon })
          .bindPopup(`<b>Người dùng: ${user.username}</b><br>Vai trò: ${user.role}<br>Hoạt động lúc: ${activeTime}<br>Hành động cuối: <i>${user.lastAction}</i>`)
          .addTo(mapUsersGroup);
      });
    }
  } catch (err) {
    console.error('Failed drawing live users:', err);
  }
}

// Load registrations
async function loadRegistrations() {
  try {
    const response = await fetch(`${defaultServerUrl}/api/admin/registrations`, {
      headers: getAuthHeaders()
    });

    if (response.ok) {
      const list = await response.json();
      if (list.length === 0) {
        registrationsTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-gray);">Không có hồ sơ đăng ký chủ quán nào.</td></tr>`;
        return;
      }

      registrationsTableBody.innerHTML = list.map(r => {
        let actionCell = `<span style="color: var(--text-gray); font-weight: 600;">${r.status === 'Approved' ? 'Đã duyệt' : 'Đã từ chối'}</span>`;
        if (r.status === 'Pending') {
          actionCell = `
            <button class="action-btn approve" onclick="approveRegistration('${r.id}')">Duyệt</button>
            <button class="action-btn reject" onclick="openRejectModal('registration', '${r.id}')">Từ chối</button>
          `;
        }

        return `
          <tr>
            <td><b>${r.fullName}</b></td>
            <td>${r.username}</td>
            <td><code>${r.cccd}</code></td>
            <td>${new Date(r.createdAt).toLocaleString()}</td>
            <td style="color: ${r.status === 'Pending' ? '#F59E0B' : (r.status === 'Approved' ? '#10B981' : '#EF4444')}; font-weight: bold;">${r.status}</td>
            <td>${actionCell}</td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Load registrations failed:', err);
  }
}

// Load stall and profile submissions
async function loadSubmissions() {
  try {
    const response = await fetch(`${defaultServerUrl}/api/admin/submissions`, {
      headers: getAuthHeaders()
    });

    if (handleAuthFailure(response)) return;

    if (response.ok) {
      const list = await response.json();
      if (list.length === 0) {
        submissionsTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-gray);">Không có yêu cầu thay đổi nào đang chờ phê duyệt.</td></tr>`;
        return;
      }

      submissionsTableBody.innerHTML = list.map(s => {
        const isStall = s.type === "Stall";
        const badge = isStall 
          ? `<span class="badge" style="padding:2px 4px;border-radius:4px;font-size:10px;background:#3b82f6;color:#fff;margin-left:4px;">Cửa hàng</span>`
          : `<span class="badge" style="padding:2px 4px;border-radius:4px;font-size:10px;background:#8b5cf6;color:#fff;margin-left:4px;">Chủ quán</span>`;
        const latLon = isStall ? `<code>${s.latitude.toFixed(6)}, ${s.longitude.toFixed(6)}</code>` : `-`;
        const approveHandler = isStall ? `approveSubmission('${s.id}')` : `approveProfileChange('${s.id}')`;
        const rejectHandler = isStall ? `openRejectModal('submission', '${s.id}')` : `openRejectModal('profile', '${s.id}')`;

        return `
        <tr>
          <td><b>${escapeHtml(s.name)}</b> ${badge}</td>
          <td>${escapeHtml(s.address)}</td>
          <td>${latLon}</td>
          <td><div style="max-height: 80px; overflow-y: auto; max-width: 350px; white-space: pre-wrap; font-size: 12px; color: var(--text-gray);">${escapeHtml(s.originalHistory)}</div></td>
          <td style="color: #F59E0B; font-weight: bold;">Chờ duyệt</td>
          <td>
            <div style="display:flex;gap:6px;">
              <button class="action-btn" onclick="viewSubmissionDetails('${s.id}', '${s.type}')" style="background:#512bd4;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;">Chi tiết</button>
              <button class="action-btn approve" onclick="${approveHandler}">Duyệt</button>
              <button class="action-btn reject" onclick="${rejectHandler}">Từ chối</button>
            </div>
          </td>
        </tr>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Load submissions failed:', err);
  }
}

window.approveProfileChange = async (id) => {
  if (!confirm('Bạn có chắc chắn muốn phê duyệt các thay đổi thông tin cá nhân của chủ quán này?')) return;
  try {
    const response = await fetch(`${defaultServerUrl}/api/admin/users/${id}/approve-profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify('Yêu cầu thay đổi thông tin cá nhân được phê duyệt.')
    });

    if (handleAuthFailure(response)) return;

    if (response.ok) {
      alert('Đã duyệt thay đổi thông tin cá nhân của chủ quán thành công.');
      refreshDashboardData();
    } else {
      alert('Phê duyệt thất bại.');
    }
  } catch (err) {
    console.error('Approve profile failed:', err);
    alert('Lỗi mạng khi phê duyệt thông tin chủ quán.');
  }
};

window.viewSubmissionDetails = async (id, type) => {
  if (type === 'Stall') {
    try {
      const response = await fetch(`${defaultServerUrl}/api/admin/stalls/${id}/detail`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        
        let menuHtml = '';
        if (data.menuImages && data.menuImages.length > 0) {
          menuHtml = `
            <div style="margin-top: 15px;">
              <b>Hình ảnh thực đơn (Menu):</b>
              <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px;">
                ${data.menuImages.map(img => {
                  let url = img.imageUrl;
                  if (!url.startsWith('http')) {
                    url = url.startsWith('/menus') ? `${defaultServerUrl}/images${url}` : `${defaultServerUrl}/images/${url.replace(/^\/+/, '')}`;
                  }
                  return `<img src="${url}" style="width: 100px; height: 100px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border-color);" />`;
                }).join('')}
              </div>
            </div>
          `;
        } else {
          menuHtml = '<div style="margin-top: 15px; color: var(--text-gray);">Chưa cập nhật thực đơn.</div>';
        }

        const bodyHtml = `
          <div style="display: flex; flex-direction: column; gap: 12px;">
            <div><b>Tên quán ăn:</b> ${escapeHtml(data.name)}</div>
            <div><b>Địa chỉ:</b> ${escapeHtml(data.address)}</div>
            <div><b>Vị trí:</b> <code>${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}</code></div>
            <div><b>Lịch sử / Giới thiệu thuyết minh:</b></div>
            <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); white-space: pre-wrap; font-size: 12px; line-height: 1.5;">${escapeHtml(data.originalHistory)}</div>
            ${menuHtml}
          </div>
        `;
        
        detailModalTitle.innerText = `Duyệt Thông Tin Quán: ${data.name}`;
        detailModalBody.innerHTML = bodyHtml;
        detailModal.style.display = 'flex';
      }
    } catch (err) {
      console.error(err);
    }
  } else if (type === 'Profile') {
    try {
      const response = await fetch(`${defaultServerUrl}/api/admin/users/${id}/detail`, {
        headers: getAuthHeaders()
      });
      if (response.ok) {
        const data = await response.json();
        
        const bodyHtml = `
          <div style="display: flex; flex-direction: column; gap: 15px;">
            <div><b>Tài khoản chủ quán:</b> <code>${escapeHtml(data.username)}</code></div>
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px;">
              <thead>
                <tr style="border-bottom: 1px solid var(--border-color); text-align: left;">
                  <th style="padding: 8px;">Thông tin</th>
                  <th style="padding: 8px;">Hiện tại</th>
                  <th style="padding: 8px; color: var(--primary-color);">Yêu cầu mới</th>
                </tr>
              </thead>
              <tbody>
                <tr style="border-bottom: 1px dotted rgba(255,255,255,0.1);">
                  <td style="padding: 8px; font-weight: bold;">Họ và Tên</td>
                  <td style="padding: 8px;">${escapeHtml(data.fullName || '-')}</td>
                  <td style="padding: 8px; color: #ff9d42; font-weight: bold;">${escapeHtml(data.pendingFullName || '-')}</td>
                </tr>
                <tr style="border-bottom: 1px dotted rgba(255,255,255,0.1);">
                  <td style="padding: 8px; font-weight: bold;">Số điện thoại</td>
                  <td style="padding: 8px;">${escapeHtml(data.phoneNumber || '-')}</td>
                  <td style="padding: 8px; color: #ff9d42; font-weight: bold;">${escapeHtml(data.pendingPhoneNumber || '-')}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; font-weight: bold;">Email</td>
                  <td style="padding: 8px;">${escapeHtml(data.email || '-')}</td>
                  <td style="padding: 8px; color: #ff9d42; font-weight: bold;">${escapeHtml(data.pendingEmail || '-')}</td>
                </tr>
              </tbody>
            </table>
          </div>
        `;
        
        detailModalTitle.innerText = `Duyệt Hồ Sơ Chủ Quán: ${data.username}`;
        detailModalBody.innerHTML = bodyHtml;
        detailModal.style.display = 'flex';
      }
    } catch (err) {
      console.error(err);
    }
  }
};

// Load visit dashboard stats
async function loadDashboardStats() {
  try {
    const response = await fetch(`${defaultServerUrl}/api/visits/dashboard`, {
      headers: getAuthHeaders()
    });

    if (response.ok) {
      const list = await response.json();

      if (!list || list.length === 0) {
        dashboardContainer.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-gray);">Chưa có lượt ghé thăm hợp lệ nào.</td></tr>`;
        visitRankingData = [];
        clearVisitChart('Chưa có dữ liệu để hiển thị.');
        return;
      }

      visitRankingData = list;
      renderVisitRanking(list);

      if (!selectedVisitStore || !list.some(item => item.foodStallId === selectedVisitStore.id)) {
        selectedVisitStore = {
          id: list[0].foodStallId,
          name: list[0].name,
          address: list[0].address
        };
      }

      syncSelectedVisitRow();
      await loadSelectedStoreChart();
    } else if (handleAuthFailure(response)) {
      return;
    } else {
      const errorText = await response.text().catch(() => '');
      console.error('Load dashboard stats failed:', response.status, errorText);
      dashboardContainer.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #ef4444;">Không tải được thống kê lượt ghé thăm. ${errorText || `HTTP ${response.status}`}</td></tr>`;
    }
  } catch (err) {
    console.error('Load dashboard stats failed:', err);
    if (dashboardContainer) {
      dashboardContainer.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #ef4444;">Lỗi tải thống kê lượt ghé thăm.</td></tr>`;
    }
  }
}

function initializeVisitFilters() {
  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(today.getDate() - 9);

  if (visitFromDateInput) {
    visitFromDateInput.value = formatDateInputValue(fromDate);
  }
  if (visitToDateInput) {
    visitToDateInput.value = formatDateInputValue(today);
  }
}

function renderVisitRanking(list) {
  dashboardContainer.innerHTML = list.map((item, index) => `
    <tr class="visit-ranking-row" data-stall-id="${item.foodStallId}" data-stall-name="${escapeHtml(item.name)}" data-stall-address="${escapeHtml(item.address)}">
      <td><b>#${index + 1}</b></td>
      <td>
        <div style="font-weight: 700; color: var(--text-white);">${item.name}</div>
        <div style="font-size: 11px; color: var(--text-gray); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.address}</div>
      </td>
      <td style="color: var(--primary-color); font-weight: 700; text-align: center;">${item.validVisitCount}</td>
    </tr>
  `).join('');

  dashboardContainer.querySelectorAll('.visit-ranking-row').forEach(row => {
    row.addEventListener('click', () => {
      selectedVisitStore = {
        id: row.dataset.stallId,
        name: row.dataset.stallName,
        address: row.dataset.stallAddress
      };
      syncSelectedVisitRow();
      void loadSelectedStoreChart();
    });
  });
}

function syncSelectedVisitRow() {
  dashboardContainer.querySelectorAll('.visit-ranking-row').forEach(row => {
    row.classList.toggle('active', row.dataset.stallId === selectedVisitStore?.id);
  });
}

async function loadSelectedStoreChart() {
  if (!selectedVisitStore) {
    clearVisitChart('Chọn một quán trong bảng xếp hạng để xem biểu đồ.');
    return;
  }

  const fromDate = visitFromDateInput?.value || formatDateInputValue(new Date(Date.now() - 9 * 24 * 60 * 60 * 1000));
  const toDate = visitToDateInput?.value || formatDateInputValue(new Date());

  visitChartTitle.innerText = selectedVisitStore.name;
  visitChartSubtitle.innerText = `${selectedVisitStore.address}`;

  try {
    const response = await fetch(`${defaultServerUrl}/api/visits/stalls/${selectedVisitStore.id}/daily?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`, {
      headers: getAuthHeaders()
    });

    if (response.ok) {
      const list = await response.json();
      renderVisitChart(list, fromDate, toDate);
    } else if (handleAuthFailure(response)) {
      return;
    } else {
      const errorText = await response.text().catch(() => '');
      clearVisitChart(`Không tải được biểu đồ: ${errorText || `HTTP ${response.status}`}`);
    }
  } catch (err) {
    console.error('Load selected store chart failed:', err);
    clearVisitChart('Lỗi tải biểu đồ thống kê.');
  }
}

function renderVisitChart(list, fromDate, toDate) {
  const labels = [];
  const counts = [];
  const dataMap = new Map((list || []).map(item => [formatDateInputValue(new Date(item.visitDate)), item.validVisitCount]));

  const start = new Date(fromDate);
  const end = new Date(toDate);

  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const key = formatDateInputValue(cursor);
    labels.push(key);
    counts.push(dataMap.get(key) || 0);
  }

  if (!visitChartCanvas) return;

  if (visitChart) {
    visitChart.destroy();
  }

  visitChart = new Chart(visitChartCanvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Lượt ghé hợp lệ',
        data: counts,
        borderColor: '#FF7A00',
        backgroundColor: 'rgba(255, 122, 0, 0.18)',
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
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: context => ` ${context.parsed.y} lượt ghé`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#94A3B8',
            maxRotation: 0,
            autoSkip: true
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

function clearVisitChart(message) {
  if (visitChart) {
    visitChart.destroy();
    visitChart = null;
  }

  if (visitChartTitle) {
    visitChartTitle.innerText = 'Chọn một quán để xem biểu đồ';
  }
  if (visitChartSubtitle) {
    visitChartSubtitle.innerText = message;
  }

  if (visitChartCanvas) {
    const context = visitChartCanvas.getContext('2d');
    if (context) {
      context.clearRect(0, 0, visitChartCanvas.width, visitChartCanvas.height);
    }
  }
}

function formatDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Load telemetry audit logs
async function loadTelemetryLogs() {
  try {
    const response = await fetch(`${defaultServerUrl}/api/admin/telemetry`, {
      headers: getAuthHeaders()
    });

    if (response.ok) {
      const logs = await response.json();
      if (logs.length === 0) {
        telemetryTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-gray);">Nhật ký hoạt động trống.</td></tr>`;
        return;
      }

      telemetryTableBody.innerHTML = logs.map(l => `
        <tr>
          <td>${new Date(l.timestamp).toLocaleString()}</td>
          <td><b>${l.username}</b></td>
          <td><span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.05);">${l.role}</span></td>
          <td><code>${l.action}</code></td>
          <td>${l.latitude.toFixed(6)}, ${l.longitude.toFixed(6)}</td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Load telemetry failed:', err);
  }
}

// Approve action handlers
window.approveRegistration = async (id) => {
  if (!confirm('Bạn có chắc chắn muốn phê duyệt hồ sơ chủ quán này?')) return;
  try {
    const response = await fetch(`${defaultServerUrl}/api/admin/registrations/${id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify('Đăng ký chủ quán đã được phê duyệt thành công.')
    });

    if (response.ok) {
      alert('Đã phê duyệt chủ quán thành công.');
      refreshDashboardData();
      loadStallsOnMap();
    }
  } catch (err) {
    console.error('Approve registration failed:', err);
  }
};

window.approveSubmission = async (id) => {
  if (!confirm('Phê duyệt bài thuyết minh này và phát hành lên ứng dụng?')) return;
  try {
    const response = await fetch(`${defaultServerUrl}/api/admin/submissions/${id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify('Thuyết minh được duyệt thành công.')
    });

    if (response.ok) {
      alert('Đã duyệt thuyết minh thành công. Tiến trình Edge-TTS tạo âm thanh đã được kích hoạt chạy ngầm.');
      refreshDashboardData();
      loadStallsOnMap();
    }
  } catch (err) {
    console.error('Approve submission failed:', err);
  }
};

// Open reject modal dialog
window.openRejectModal = (type, id) => {
  modalActionType = type;
  modalTargetId = id;
  modalNoteText.value = '';
  noteModal.style.display = 'flex';
};

// Confirm reject note submission
async function handleModalConfirm() {
  const note = modalNoteText.value.trim();
  if (!note) {
    alert('Vui lòng nhập lý do từ chối.');
    return;
  }

  const id = modalTargetId;
  let url = '';

  if (modalActionType === 'registration') {
    url = `${defaultServerUrl}/api/admin/registrations/${id}/reject`;
  } else if (modalActionType === 'submission') {
    url = `${defaultServerUrl}/api/admin/submissions/${id}/reject`;
  } else if (modalActionType === 'profile') {
    url = `${defaultServerUrl}/api/admin/users/${id}/reject-profile`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify(note)
    });

    if (response.ok) {
      alert('Từ chối thành công.');
      noteModal.style.display = 'none';
      refreshDashboardData();
      loadStallsOnMap();
    } else {
      alert('Từ chối thất bại.');
    }
  } catch (err) {
    console.error('Reject failed:', err);
  }
}

// --- Users Management ---
async function loadUsers() {
  if (!usersTableBody) return;
  try {
    const response = await fetch(`${defaultServerUrl}/api/admin/users`, {
      headers: getAuthHeaders()
    });

    if (handleAuthFailure(response)) return;

    if (response.ok) {
      allUsers = await response.json();
      filterAndRenderUsers();
    }
  } catch (err) {
    console.error('Load users failed:', err);
    usersTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#ef4444;">Lỗi tải dữ liệu người dùng.</td></tr>';
  }
}

function filterAndRenderUsers() {
  const query = usersSearchInput ? usersSearchInput.value.toLowerCase().trim() : '';
  const filterVal = usersActiveFilter ? usersActiveFilter.value : 'all';

  const filtered = allUsers.filter(u => {
    const matchesSearch = !query ||
      (u.username && u.username.toLowerCase().includes(query)) ||
      (u.fullName && u.fullName.toLowerCase().includes(query)) ||
      (u.email && u.email.toLowerCase().includes(query)) ||
      (u.phoneNumber && u.phoneNumber.toLowerCase().includes(query));

    const isActive = u.isActive !== false;
    let matchesFilter = true;
    if (filterVal === 'active') {
      matchesFilter = isActive;
    } else if (filterVal === 'inactive') {
      matchesFilter = !isActive;
    }

    return matchesSearch && matchesFilter;
  });

  renderUsersList(filtered);
}

function renderUsersList(users) {
  if (!usersTableBody) return;
  usersTableBody.innerHTML = '';

  if (users.length === 0) {
    usersTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-gray);">Không tìm thấy tài khoản nào.</td></tr>';
    return;
  }

  users.forEach(u => {
    const tr = document.createElement('tr');
    const lastActiveDate = u.lastActive ? new Date(u.lastActive).toLocaleString('vi-VN') : '-';
    
    const statusText = `
      <div style="font-size:11px;">${u.isVerified ? '<span style="color:#00ff66;">✓ Đã duyệt</span>' : '<span style="color:#ff9d42;">⏳ Chờ duyệt</span>'}</div>
      <div style="font-size:11px;margin-top:2px;">${u.isActive ? '<span style="color:#00ff66;">● Hoạt động</span>' : '<span style="color:#ef4444;">■ Ngưng HĐ</span>'}</div>
    `;

    const activeBtnText = u.isActive ? 'Ngưng HĐ' : 'Kích hoạt';
    const activeBtnBg = u.isActive ? '#64748b' : '#10b981';

    tr.innerHTML = `
      <td><b>${escapeHtml(u.username)}</b></td>
      <td>${escapeHtml(u.fullName || '-')}</td>
      <td><span class="badge" style="padding:2px 6px;border-radius:4px;font-size:11px;background:${u.role === 'Owner' ? '#8b5cf6' : '#6b7280'};color:#fff;">${u.role}</span></td>
      <td>${escapeHtml(u.phoneNumber || '-')}</td>
      <td>${escapeHtml(u.email || '-')}</td>
      <td>${statusText}</td>
      <td>${lastActiveDate}</td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn" onclick="viewUserDetails('${u.id}')" style="background:#512bd4;font-size:11px;padding:4px 8px;border-radius:4px;color:#fff;cursor:pointer;">Chi tiết</button>
          <button class="btn" onclick="toggleUserActive('${u.id}')" style="background:${activeBtnBg};font-size:11px;padding:4px 8px;border-radius:4px;color:#fff;cursor:pointer;">${activeBtnText}</button>
          <button class="btn btn-danger" onclick="deleteUser('${u.id}')" style="background:#ef4444;font-size:11px;padding:4px 8px;border-radius:4px;">Xóa</button>
        </div>
      </td>
    `;
    usersTableBody.appendChild(tr);
  });
}

window.toggleUserActive = async (id) => {
  const user = allUsers.find(u => u.id === id);
  const isCurrentlyActive = user ? user.isActive !== false : true;

  if (isCurrentlyActive) {
    const stallNames = user && user.stallNames && user.stallNames.length > 0 
      ? user.stallNames.join(', ') 
      : '';
    const stallWarning = stallNames 
      ? ` cửa hàng (${stallNames})` 
      : ' cửa hàng của họ';

    if (!confirm(`Nếu ngưng hoạt động tài khoản này thì${stallWarning} cũng sẽ bị ngưng hoạt động theo. Bạn có đồng ý tiếp tục?`)) {
      return;
    }
  }

  try {
    const response = await fetch(`${defaultServerUrl}/api/admin/users/${id}/toggle-active`, {
      method: 'POST',
      headers: getAuthHeaders()
    });

    if (handleAuthFailure(response)) return;

    if (response.ok) {
      const data = await response.json();
      alert(data.isActive ? 'Tài khoản đã được hoạt động trở lại.' : 'Tài khoản đã ngưng hoạt động thành công.');
      refreshDashboardData();
    } else {
      alert('Thay đổi trạng thái tài khoản thất bại.');
    }
  } catch (err) {
    console.error('Toggle user active failed:', err);
    alert('Lỗi mạng khi thay đổi trạng thái tài khoản.');
  }
};

window.deleteUser = async (id) => {
  const user = allUsers.find(u => u.id === id);
  const stallNames = (user && user.stallNames && user.stallNames.length > 0) 
    ? user.stallNames.join(', ') 
    : '';

  let confirmMsg = 'Bạn có chắc chắn muốn xóa tài khoản người dùng này? Hành động này sẽ xóa vĩnh viễn các thông tin liên quan của họ.';
  if (stallNames) {
    confirmMsg = `Tài khoản này đang là chủ của các cửa hàng sau: ${stallNames}. Bạn cần phải xóa các cửa hàng này trước khi xóa tài khoản. Bạn có chắc chắn muốn tiếp tục thử xóa không?`;
  }

  if (!confirm(confirmMsg)) return;
  try {
    const response = await fetch(`${defaultServerUrl}/api/admin/users/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });

    if (handleAuthFailure(response)) return;

    if (response.ok) {
      alert('Xóa tài khoản thành công.');
      refreshDashboardData();
    } else {
      const errText = await response.text();
      alert('Không thể xóa tài khoản: ' + errText);
    }
  } catch (err) {
    console.error('Delete user failed:', err);
    alert('Lỗi kết nối khi xóa tài khoản.');
  }
};

// --- Stalls Management ---
async function loadAllStalls() {
  if (!stallsTableBody) return;
  try {
    const response = await fetch(`${defaultServerUrl}/api/admin/stalls`, {
      headers: getAuthHeaders()
    });

    if (handleAuthFailure(response)) return;

    if (response.ok) {
      allStalls = await response.json();
      filterAndRenderStalls();
    }
  } catch (err) {
    console.error('Load stalls failed:', err);
    stallsTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#ef4444;">Lỗi tải dữ liệu quán ăn.</td></tr>';
  }
}

function filterAndRenderStalls() {
  const query = stallsSearchInput ? stallsSearchInput.value.toLowerCase().trim() : '';
  const filterVal = stallsActiveFilter ? stallsActiveFilter.value : 'all';

  const filtered = allStalls.filter(s => {
    const matchesSearch = !query ||
      (s.name && s.name.toLowerCase().includes(query)) ||
      (s.address && s.address.toLowerCase().includes(query)) ||
      (s.ownerUsername && s.ownerUsername.toLowerCase().includes(query));

    const isActive = s.isActive !== false;
    let matchesFilter = true;
    if (filterVal === 'active') {
      matchesFilter = isActive;
    } else if (filterVal === 'inactive') {
      matchesFilter = !isActive;
    }

    return matchesSearch && matchesFilter;
  });

  renderStallsList(filtered);
}

function renderStallsList(stalls) {
  if (!stallsTableBody) return;
  stallsTableBody.innerHTML = '';

  if (stalls.length === 0) {
    stallsTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-gray);">Không tìm thấy quán ăn nào.</td></tr>';
    return;
  }

  stalls.forEach(s => {
    const tr = document.createElement('tr');
    
    const statusText = `
      <div style="font-size:11px;">${s.isVerified ? '<span style="color:#00ff66;">✓ Đã duyệt</span>' : '<span style="color:#ff9d42;">⏳ Chờ duyệt</span>'}</div>
      <div style="font-size:11px;margin-top:2px;">${s.isActive ? '<span style="color:#00ff66;">● Hoạt động</span>' : '<span style="color:#ef4444;">■ Ngưng HĐ</span>'}</div>
    `;

    const activeBtnText = s.isActive ? 'Ngưng HĐ' : 'Kích hoạt';
    const activeBtnBg = s.isActive ? '#64748b' : '#10b981';

    tr.innerHTML = `
      <td><b>${escapeHtml(s.name)}</b></td>
      <td>${escapeHtml(s.address)}</td>
      <td>${s.latitude.toFixed(6)}</td>
      <td>${s.longitude.toFixed(6)}</td>
      <td>${escapeHtml(s.ownerUsername)}</td>
      <td>${statusText}</td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn" onclick="viewStallDetails('${s.id}')" style="background:#512bd4;font-size:11px;padding:4px 8px;border-radius:4px;color:#fff;cursor:pointer;">Chi tiết</button>
          <button class="btn" onclick="toggleStallActive('${s.id}')" style="background:${activeBtnBg};font-size:11px;padding:4px 8px;border-radius:4px;color:#fff;cursor:pointer;">${activeBtnText}</button>
          <button class="btn btn-danger" onclick="deleteStall('${s.id}')" style="background:#ef4444;font-size:11px;padding:4px 8px;border-radius:4px;">Xóa</button>
        </div>
      </td>
    `;
    stallsTableBody.appendChild(tr);
  });
}

window.toggleStallActive = async (id) => {
  try {
    const response = await fetch(`${defaultServerUrl}/api/admin/stalls/${id}/toggle-active`, {
      method: 'POST',
      headers: getAuthHeaders()
    });

    if (handleAuthFailure(response)) return;

    if (response.ok) {
      const data = await response.json();
      alert(data.isActive ? 'Quán ăn đã được hoạt động trở lại.' : 'Quán ăn đã ngưng hoạt động thành công.');
      refreshDashboardData();
    } else {
      alert('Thay đổi trạng thái quán ăn thất bại.');
    }
  } catch (err) {
    console.error('Toggle stall active failed:', err);
    alert('Lỗi mạng khi thay đổi trạng thái quán ăn.');
  }
};

window.deleteStall = async (id) => {
  if (!confirm('Bạn có chắc chắn muốn xóa địa điểm quán ăn này? Hành động này sẽ xóa vĩnh viễn các bản dịch, audio, và lượt ghé liên quan.')) return;
  try {
    const response = await fetch(`${defaultServerUrl}/api/admin/stalls/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });

    if (handleAuthFailure(response)) return;

    if (response.ok) {
      alert('Xóa địa điểm quán ăn thành công.');
      refreshDashboardData();
    } else {
      const errText = await response.text();
      alert('Không thể xóa địa điểm: ' + errText);
    }
  } catch (err) {
    console.error('Delete stall failed:', err);
    alert('Lỗi kết nối khi xóa địa điểm.');
  }
};

window.viewUserDetails = async (id) => {
  if (!detailModal || !detailModalTitle || !detailModalBody) return;

  detailModalTitle.innerText = "Chi Tiết Tài Khoản Chủ Quán";
  detailModalBody.innerHTML = '<div style="text-align:center;color:var(--text-gray);padding:20px;">Đang tải chi tiết...</div>';
  detailModal.style.display = 'flex';

  try {
    const response = await fetch(`${defaultServerUrl}/api/admin/users/${id}/detail`, {
      headers: getAuthHeaders()
    });

    if (handleAuthFailure(response)) return;

    if (response.ok) {
      const data = await response.json();

      let regInfo = '<div style="color:var(--text-gray);">Không có thông tin đăng ký CCCD.</div>';
      if (data.registration) {
        regInfo = `
          <div style="background:rgba(255,255,255,0.03);padding:12px;border:1px solid var(--border-color);border-radius:8px;margin-top:5px;">
            <p style="margin-bottom:6px;"><b>Số CCCD:</b> <code>${escapeHtml(data.registration.cccd || 'Không tìm thấy')}</code></p>
            <p style="margin-bottom:6px;"><b>Ngày đăng ký:</b> ${new Date(data.registration.createdAt).toLocaleString('vi-VN')}</p>
            <p style="margin-bottom:6px;"><b>Trạng thái duyệt:</b> <span style="color:${data.registration.status === 'Approved' ? '#00ff66' : '#ff3333'};font-weight:bold;">${data.registration.status}</span></p>
            <p style="margin-bottom:0;"><b>Ghi chú Admin:</b> <i>${escapeHtml(data.registration.adminNote || 'Không có')}</i></p>
          </div>
        `;
      }

      let stallsInfo = '<div style="color:var(--text-gray);padding:5px 0;">Không có quán ăn nào thuộc sở hữu.</div>';
      if (data.stalls && data.stalls.length > 0) {
        stallsInfo = `
          <ul style="padding-left:20px;margin-top:5px;margin-bottom:0;">
            ${data.stalls.map(s => `
              <li style="margin-bottom:6px;">
                <b>${escapeHtml(s.name)}</b> - ${escapeHtml(s.address)} 
                (${s.isVerified ? '<span style="color:#00ff66;">Đã duyệt</span>' : '<span style="color:#ff9d42;">Chờ duyệt</span>'})
              </li>
            `).join('')}
          </ul>
        `;
      }

      const activeTime = data.lastActive ? new Date(data.lastActive).toLocaleString('vi-VN') : '-';

      detailModalBody.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:20px;background:rgba(255,255,255,0.02);padding:15px;border-radius:8px;border:1px solid var(--border-color);">
          <div>
            <p style="margin-bottom:8px;"><b>Tên đăng nhập:</b> ${escapeHtml(data.username)}</p>
            <p style="margin-bottom:8px;"><b>Họ và Tên:</b> ${escapeHtml(data.fullName || '-')}</p>
            <p style="margin-bottom:8px;"><b>Vai trò:</b> <span style="background:#8b5cf6;padding:2px 6px;border-radius:4px;font-size:11px;color:#fff;">${data.role}</span></p>
            <p style="margin-bottom:0;"><b>Hoạt động cuối:</b> ${activeTime}</p>
          </div>
          <div>
            <p style="margin-bottom:8px;"><b>Số điện thoại:</b> ${escapeHtml(data.phoneNumber || '-')}</p>
            <p style="margin-bottom:8px;"><b>Email:</b> ${escapeHtml(data.email || '-')}</p>
            <p style="margin-bottom:8px;"><b>Trạng thái:</b> ${data.isVerified ? '<span style="color:#00ff66;">Đã kích hoạt</span>' : '<span style="color:#ff3333;">Chưa kích hoạt</span>'}</p>
            <p style="margin-bottom:0;"><b>Thanh toán:</b> ${data.hasPaidAccess ? '<span style="color:#00ff66;">Đã thanh toán</span>' : '<span style="color:var(--text-gray);">Chưa thanh toán</span>'}</p>
          </div>
        </div>
        
        <div style="margin-bottom:20px;">
          <h4 style="color:var(--primary-color);font-size:14px;margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:4px;">Thông Tin Hồ Sơ Đăng Ký</h4>
          ${regInfo}
        </div>

        <div>
          <h4 style="color:var(--primary-color);font-size:14px;margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:4px;">Danh Sách Quán Ăn Sở Hữu</h4>
          ${stallsInfo}
        </div>
      `;
    } else {
      const errText = await response.text();
      detailModalBody.innerHTML = `<div style="color:#ef4444;text-align:center;padding:20px;">Lỗi: ${escapeHtml(errText)}</div>`;
    }
  } catch (err) {
    console.error('Fetch user detail failed:', err);
    detailModalBody.innerHTML = '<div style="color:#ef4444;text-align:center;padding:20px;">Lỗi kết nối máy chủ.</div>';
  }
};

window.viewStallDetails = async (id) => {
  if (!detailModal || !detailModalTitle || !detailModalBody) return;

  detailModalTitle.innerText = "Chi Tiết Quán Ăn";
  detailModalBody.innerHTML = '<div style="text-align:center;color:var(--text-gray);padding:20px;">Đang tải chi tiết...</div>';
  detailModal.style.display = 'flex';

  try {
    const response = await fetch(`${defaultServerUrl}/api/admin/stalls/${id}/detail`, {
      headers: getAuthHeaders()
    });

    if (handleAuthFailure(response)) return;

    if (response.ok) {
      const data = await response.json();

      let locsInfo = '<div style="color:var(--text-gray);">Chưa có bản dịch nào.</div>';
      if (data.localizations && data.localizations.length > 0) {
        locsInfo = `
          <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 6px;">
            ${data.localizations.map(l => {
              const langName = l.languageCode.toUpperCase() === 'VI' ? 'Tiếng Việt' :
                               l.languageCode.toUpperCase() === 'EN' ? 'English' :
                               l.languageCode.toUpperCase() === 'JA' ? '日本語' :
                               l.languageCode.toUpperCase() === 'KO' ? '한국어' :
                               l.languageCode.toUpperCase() === 'ZH' ? '中文' : l.languageCode.toUpperCase();
              
              const audioPlayerHtml = l.audioUrl 
                ? `<audio controls src="${l.audioUrl.startsWith('http') ? l.audioUrl : (defaultServerUrl + l.audioUrl)}" style="width: 100%; max-width: 280px; height: 32px; margin-top: 4px;"></audio>` 
                : `<span style="color: var(--text-gray); font-size: 11px;">(Chưa có file thuyết minh âm thanh)</span>`;
                
              return `
                <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 6px;">
                  <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 4px;">
                    <strong style="color: var(--primary-color); font-size: 12px;">🌍 ${langName}</strong>
                  </div>
                  <div style="font-size: 12px; color: #ddd; white-space: pre-wrap; line-height: 1.4; max-height: 80px; overflow-y: auto; background: rgba(0,0,0,0.2); padding: 6px; border-radius: 4px;">${escapeHtml(l.translatedText || '(Chưa dịch)')}</div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    ${audioPlayerHtml}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
      }

      let imagesInfo = '<div style="color:var(--text-gray);padding:5px 0;">Không có ảnh thực đơn.</div>';
      if (data.menuImages && data.menuImages.length > 0) {
        imagesInfo = `
          <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(90px, 1fr));gap:10px;margin-top:5px;">
            ${data.menuImages.map(img => `
              <div style="position:relative;border:1px solid var(--border-color);border-radius:6px;overflow:hidden;aspect-ratio:1;">
                <img src="${escapeHtml(img.imageUrl)}" style="width:100%;height:100%;object-fit:cover;">
                ${img.isMainImage ? '<span style="position:absolute;top:2px;left:2px;background:#FF7A00;font-size:8px;padding:1px 3px;border-radius:3px;color:#fff;">Chính</span>' : ''}
              </div>
            `).join('')}
          </div>
        `;
      }

      detailModalBody.innerHTML = `
        <div style="margin-bottom:15px;background:rgba(255,255,255,0.02);padding:15px;border-radius:8px;border:1px solid var(--border-color);">
          <p style="margin-bottom:8px;"><b>Tên quán ăn:</b> <span style="font-size:15px;font-weight:bold;color:var(--primary-color);">${escapeHtml(data.name)}</span></p>
          <p style="margin-bottom:8px;"><b>Địa chỉ:</b> ${escapeHtml(data.address)}</p>
          <p style="margin-bottom:8px;"><b>Vị trí GPS:</b> <code>${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}</code></p>
          <p style="margin-bottom:8px;"><b>Chủ sở hữu:</b> <b>${escapeHtml(data.ownerUsername)}</b></p>
          <p style="margin-bottom:8px;"><b>Trạng thái:</b> ${data.isVerified ? '<span style="color:#00ff66;font-weight:bold;">Đã duyệt công khai</span>' : '<span style="color:#ff9d42;font-weight:bold;">Đang chờ duyệt</span>'}</p>
          <p style="margin-bottom:0;"><b>Ghi chú nội bộ Admin:</b> <i>${escapeHtml(data.adminNote || 'Không có')}</i></p>
        </div>

        <div style="margin-bottom:15px;">
          <h4 style="color:var(--primary-color);font-size:13px;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:4px;">Thuyết Minh Nguồn (Tiếng Việt)</h4>
          <div style="background:rgba(255,255,255,0.03);padding:10px;border-radius:6px;border:1px solid var(--border-color);max-height:120px;overflow-y:auto;white-space:pre-wrap;font-size:12px;color:var(--text-gray);">${escapeHtml(data.originalHistory || 'Chưa cập nhật thuyết minh.')}</div>
        </div>

        <div style="margin-bottom:15px;">
          <h4 style="color:var(--primary-color);font-size:13px;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:4px;">Các Bản Dịch Đa Ngôn Ngữ</h4>
          <div style="padding-top:4px;">${locsInfo}</div>
        </div>

        <div>
          <h4 style="color:var(--primary-color);font-size:13px;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:4px;">Hình Ảnh Thực Đơn & Cửa Hàng</h4>
          ${imagesInfo}
        </div>
      `;
    } else {
      const errText = await response.text();
      detailModalBody.innerHTML = `<div style="color:#ef4444;text-align:center;padding:20px;">Lỗi: ${escapeHtml(errText)}</div>`;
    }
  } catch (err) {
    console.error('Fetch stall detail failed:', err);
    detailModalBody.innerHTML = '<div style="color:#ef4444;text-align:center;padding:20px;">Lỗi kết nối máy chủ.</div>';
  }
};
