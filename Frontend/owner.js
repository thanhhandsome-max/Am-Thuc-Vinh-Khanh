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

let token = localStorage.getItem('authToken');
const role = localStorage.getItem('userRole');
const username = localStorage.getItem('username');

// --- Menu Management Variables ---
let menuGrid;
let menuUploadBtn;
let menuUploadInput;
let menuUploadStatus;

// Authentication check
window.addEventListener('DOMContentLoaded', () => {
  const currentToken = localStorage.getItem('authToken');
  const currentRole = localStorage.getItem('userRole');
  
  if (currentToken && currentRole === 'Owner') {
    token = currentToken;
    loadStallDetails();

    // Bind Menu Management Elements
    menuGrid = document.getElementById('owner-menu-grid');
    menuUploadBtn = document.getElementById('menu-upload-btn');
    menuUploadInput = document.getElementById('menu-upload-input');
    menuUploadStatus = document.getElementById('menu-upload-status');

    if (menuUploadBtn && menuUploadInput) {
      menuUploadBtn.addEventListener('click', () => {
        if (!currentStall) {
          alert("Vui lòng đợi tải thông tin quán ăn.");
          return;
        }
        menuUploadInput.click();
      });

      menuUploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          alert('Vui lòng chọn file ảnh (JPG, PNG, WEBP).');
          menuUploadInput.value = '';
          return;
        }

        if (file.size > 5 * 1024 * 1024) { // 5MB limit
          alert('Dung lượng ảnh tối đa là 5MB.');
          menuUploadInput.value = '';
          return;
        }

        try {
          menuUploadStatus.innerText = 'Đang tải lên...';
          menuUploadBtn.disabled = true;

          const formData = new FormData();
          formData.append('file', file);

          const response = await fetch(`${defaultServerUrl}/api/owner/pois/${currentStall.id}/menu`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`
            },
            body: formData
          });

          if (response.ok) {
            menuUploadStatus.innerText = 'Tải lên thành công!';
            menuUploadStatus.style.color = '#10B981';
            setTimeout(() => menuUploadStatus.innerText = '', 3000);
            await loadStallDetails();
          } else {
            const errText = await response.text();
            menuUploadStatus.innerText = 'Lỗi tải lên.';
            menuUploadStatus.style.color = '#ef4444';
            console.error('Upload failed:', errText);
          }
        } catch (err) {
          console.error('Error uploading menu image:', err);
          menuUploadStatus.innerText = 'Lỗi mạng.';
          menuUploadStatus.style.color = '#ef4444';
        } finally {
          menuUploadBtn.disabled = false;
          menuUploadInput.value = '';
        }
      });
    }

  } else {
    // If not owner, clear and go to login
    localStorage.removeItem('authToken');
    localStorage.removeItem('userRole');
    window.location.href = 'login.html';
  }
});

function renderOwnerMenuImages(images) {
  if (!menuGrid) return;
  menuGrid.innerHTML = '';
  
  if (!images || images.length === 0) {
    menuGrid.innerHTML = '<div style="grid-column: 1 / -1; color: var(--text-gray); font-size: 13px; font-style: italic;">Chưa có ảnh Menu nào.</div>';
    return;
  }

  images.forEach(img => {
    let displayUrl = img.imageUrl;
    if (displayUrl && !displayUrl.startsWith('http')) {
      if (displayUrl.startsWith('/menus')) {
        displayUrl = `${defaultServerUrl}/images${displayUrl}`;
      } else {
        displayUrl = `${defaultServerUrl}/images/${displayUrl.replace(/^\/+/, '')}`;
      }
    }

    const div = document.createElement('div');
    div.style.position = 'relative';
    div.style.paddingTop = '100%';
    div.style.borderRadius = '8px';
    div.style.overflow = 'hidden';
    div.style.border = '1px solid var(--border-color)';
    div.style.background = '#2c2c3e';

    const imgEl = document.createElement('img');
    imgEl.src = displayUrl;
    imgEl.style.position = 'absolute';
    imgEl.style.top = '0';
    imgEl.style.left = '0';
    imgEl.style.width = '100%';
    imgEl.style.height = '100%';
    imgEl.style.objectFit = 'cover';

    const deleteBtn = document.createElement('button');
    deleteBtn.innerHTML = '✕';
    deleteBtn.title = "Xóa ảnh này";
    deleteBtn.style.position = 'absolute';
    deleteBtn.style.top = '4px';
    deleteBtn.style.right = '4px';
    deleteBtn.style.background = 'rgba(239, 68, 68, 0.9)';
    deleteBtn.style.color = '#fff';
    deleteBtn.style.border = 'none';
    deleteBtn.style.borderRadius = '50%';
    deleteBtn.style.width = '24px';
    deleteBtn.style.height = '24px';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.style.display = 'flex';
    deleteBtn.style.alignItems = 'center';
    deleteBtn.style.justifyContent = 'center';
    deleteBtn.style.fontSize = '12px';

    deleteBtn.onclick = async () => {
      if (confirm('Bạn có chắc chắn muốn xóa ảnh này?')) {
        await deleteMenuImage(img.id);
      }
    };

    div.appendChild(imgEl);
    div.appendChild(deleteBtn);
    menuGrid.appendChild(div);
  });
}

async function deleteMenuImage(imageId) {
  try {
    const response = await fetch(`${defaultServerUrl}/api/owner/pois/${currentStall.id}/menu/${imageId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      // Reload the stall details to refresh images
      await loadStallDetails();
    } else {
      alert('Xóa ảnh thất bại. Vui lòng thử lại.');
    }
  } catch (err) {
    console.error('Error deleting image:', err);
    alert('Lỗi mạng khi xóa ảnh.');
  }
}

let ownerMap;
let stallMarker = null;
let currentStall = null;


// UI Elements
const ownerNameSpan = document.getElementById('owner-name');
const logoutBtn = document.getElementById('logout-btn');
const notifyBell = document.getElementById('notify-bell');
const notifyCount = document.getElementById('notify-count');
const notifyList = document.getElementById('notify-list');
const notificationsContent = document.getElementById('notifications-content');

const stallForm = document.getElementById('stall-form');
const stallNameInput = document.getElementById('stallName');
const stallAddressInput = document.getElementById('stallAddress');
const latInput = document.getElementById('latitude');
const lngInput = document.getElementById('longitude');
const descInput = document.getElementById('description');
const stallStatusSpan = document.getElementById('stall-status');
const submitFeedback = document.getElementById('submit-feedback');

const aiQuotaSpan = document.getElementById('ai-quota');
const aiEnhanceBtn = document.getElementById('ai-enhance-btn');
const aiResponseDiv = document.getElementById('ai-response');
const aiApplyBtn = document.getElementById('ai-apply-btn');
const aiStatusText = document.getElementById('ai-status-text');

// Profile Form Elements
const profileForm = document.getElementById('profile-form');
const profileUsernameInput = document.getElementById('profileUsername');
const profileFullnameInput = document.getElementById('profileFullname');
const profilePhoneInput = document.getElementById('profilePhone');
const profileEmailInput = document.getElementById('profileEmail');
const profileStatusSpan = document.getElementById('profile-status');
const profileFeedback = document.getElementById('profile-feedback');

// Init details on load
window.addEventListener('DOMContentLoaded', () => {
  ownerNameSpan.innerText = `Chủ quán: ${username}`;

  // Wire notification toggle
  notifyBell.addEventListener('click', (e) => {
    e.stopPropagation();
    notifyList.style.display = notifyList.style.display === 'block' ? 'none' : 'block';
  });

  document.addEventListener('click', () => {
    notifyList.style.display = 'none';
  });

  logoutBtn.addEventListener('click', () => {
    localStorage.clear();
    window.location.href = 'login.html';
  });

  loadStallDetails();
  loadNotifications();
  loadAiUsage();
  loadOwnerProfile();

  aiEnhanceBtn.addEventListener('click', enhanceDescription);
  aiApplyBtn.addEventListener('click', applyAiDescription);
  
  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      profileFeedback.innerText = '';
      profileFeedback.style.color = 'inherit';

      const payload = {
        fullName: profileFullnameInput.value.trim(),
        phoneNumber: profilePhoneInput.value.trim(),
        email: profileEmailInput.value.trim()
      };

      try {
        const response = await fetch(`${defaultServerUrl}/api/owner/profile`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          profileFeedback.innerText = 'Gửi yêu cầu đổi thông tin thành công. Chờ Admin phê duyệt.';
          profileFeedback.style.color = '#10B981';
          await loadOwnerProfile();
        } else {
          const errText = await response.text();
          profileFeedback.innerText = errText || 'Cập nhật thất bại.';
          profileFeedback.style.color = '#ff3333';
        }
      } catch (err) {
        console.error('Update profile failed:', err);
        profileFeedback.innerText = 'Lỗi kết nối máy chủ.';
        profileFeedback.style.color = '#ff3333';
      }
    });
  }
  // Tab switching (Owner page): mirror admin tab behavior
  const tabButtons = document.querySelectorAll('.owner-tabs .tab-btn');
  const ownerMainContent = document.querySelector('main.owner-layout');
  const ownerStatsContent = document.getElementById('owner-stats');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tab = btn.getAttribute('data-tab');
      if (tab === 'owner-main') {
        if (ownerMainContent) ownerMainContent.style.display = 'grid';
        if (ownerStatsContent) ownerStatsContent.style.display = 'none';
      } else if (tab === 'owner-stats') {
        if (ownerMainContent) ownerMainContent.style.display = 'none';
        if (ownerStatsContent) ownerStatsContent.style.display = 'block';
        // refresh iframe if present
        const iframe = document.getElementById('owner-stats-iframe');
        if (iframe) {
          iframe.contentWindow?.location?.reload?.();
        }
      }
    });
  });
});

// Load food stall details
async function loadStallDetails() {
  try {
    const response = await fetch(`${defaultServerUrl}/api/owner/pois`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      const stalls = await response.json();
      if (stalls && stalls.length > 0) {
        currentStall = stalls[0]; // Active owner stall

        stallNameInput.value = currentStall.name;
        stallAddressInput.value = currentStall.address;
        latInput.value = currentStall.latitude.toFixed(6);
        lngInput.value = currentStall.longitude.toFixed(6);
        descInput.value = currentStall.originalHistory;

        // Render status badge
        updateStatusBadge(currentStall.isVerified, currentStall.adminNote);

        // Init Map
        initOwnerMap(currentStall.latitude, currentStall.longitude);
        // Render Menu Images
        renderOwnerMenuImages(currentStall.menuImages || []);
      } else {
        stallStatusSpan.innerText = 'Chưa có quán ăn';
        stallStatusSpan.style.background = '#3e3e50';
        initOwnerMap(10.760124, 106.702958);
      }
    }
  } catch (err) {
    console.error('Error loading stall:', err);
  }
}

async function loadOwnerProfile() {
  if (!profileUsernameInput) return;
  try {
    const response = await fetch(`${defaultServerUrl}/api/auth/me`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      const user = await response.json();
      profileUsernameInput.value = user.username || '';

      if (user.pendingProfile) {
        profileFullnameInput.value = user.pendingProfile.fullName || '';
        profilePhoneInput.value = user.pendingProfile.phoneNumber || '';
        profileEmailInput.value = user.pendingProfile.email || '';

        profileStatusSpan.innerText = 'Chờ duyệt hồ sơ';
        profileStatusSpan.style.background = '#F59E0B';
        profileStatusSpan.style.color = '#ffffff';
      } else {
        profileFullnameInput.value = user.fullName || '';
        profilePhoneInput.value = user.phoneNumber || '';
        profileEmailInput.value = user.email || '';

        profileStatusSpan.innerText = 'Đã kích hoạt';
        profileStatusSpan.style.background = '#10B981';
        profileStatusSpan.style.color = '#ffffff';
      }
    }
  } catch (err) {
    console.error('Error loading owner profile:', err);
  }
}

function updateStatusBadge(isVerified, note) {
  if (isVerified) {
    stallStatusSpan.innerText = 'Đang hoạt động (Công khai)';
    stallStatusSpan.style.background = '#10B981';
    stallStatusSpan.style.color = '#ffffff';
    stallStatusSpan.title = note || '';
  } else {
    stallStatusSpan.innerText = 'Chờ duyệt / Ẩn';
    stallStatusSpan.style.background = '#F59E0B';
    stallStatusSpan.style.color = '#ffffff';
    stallStatusSpan.title = note || 'Đang chờ quản trị viên phê duyệt.';
  }
}

// Initialize map select/drag coordinates
function initOwnerMap(lat, lng) {
  if (ownerMap) {
    ownerMap.setView([lat, lng], 16);
    if (stallMarker) {
      stallMarker.setLatLng([lat, lng]);
    }
    return;
  }

  ownerMap = L.map('owner-map', {
    zoomControl: true,
    attributionControl: false
  }).setView([lat, lng], 16);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(ownerMap);

  stallMarker = L.marker([lat, lng], {
    draggable: true,
    icon: L.divIcon({
      html: `<div class="pin-marker" style="background: #FF7A00; width: 22px; height: 22px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); margin: -11px 0 0 -11px; border: 2px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>`,
      className: 'custom-drag-icon',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    })
  }).addTo(ownerMap);

  // Update input on drag end
  stallMarker.on('dragend', () => {
    const position = stallMarker.getLatLng();
    latInput.value = position.lat.toFixed(6);
    lngInput.value = position.lng.toFixed(6);
  });

  ownerMap.on('click', (e) => {
    stallMarker.setLatLng(e.latlng);
    latInput.value = e.latlng.lat.toFixed(6);
    lngInput.value = e.latlng.lng.toFixed(6);
  });
}

// Update Food Stall Form Submit
stallForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitFeedback.innerText = '';
  submitFeedback.style.color = 'inherit';

  if (!currentStall) {
    submitFeedback.innerText = 'Lỗi: Không tìm thấy quán ăn của bạn.';
    submitFeedback.style.color = '#ff3333';
    return;
  }

  const payload = {
    id: currentStall.id,
    name: stallNameInput.value.trim(),
    address: stallAddressInput.value.trim(),
    latitude: parseFloat(latInput.value),
    longitude: parseFloat(lngInput.value),
    originalHistory: descInput.value.trim()
  };

  try {
    const response = await fetch(`${defaultServerUrl}/api/owner/pois/${currentStall.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      submitFeedback.innerText = 'Cập nhật thành công. Đang chờ Admin phê duyệt để hiển thị lên bản đồ.';
      submitFeedback.style.color = '#10B981';

      currentStall.isVerified = false;
      currentStall.name = payload.name;
      currentStall.address = payload.address;
      currentStall.latitude = payload.latitude;
      currentStall.longitude = payload.longitude;
      currentStall.originalHistory = payload.originalHistory;
      updateStatusBadge(false, 'Chờ duyệt thuyết minh mới.');
    } else {
      const errText = await response.text();
      submitFeedback.innerText = errText || 'Cập nhật thất bại.';
      submitFeedback.style.color = '#ff3333';
    }
  } catch (err) {
    console.error('Update POI failed:', err);
    submitFeedback.innerText = 'Lỗi kết nối máy chủ.';
    submitFeedback.style.color = '#ff3333';
  }
});

// Load owner notifications
async function loadNotifications() {
  try {
    const response = await fetch(`${defaultServerUrl}/api/owner/notifications`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      const list = await response.json();

      const unreadCount = list.filter(n => !n.isRead).length;
      if (unreadCount > 0) {
        notifyCount.innerText = unreadCount;
        notifyCount.style.display = 'block';
      } else {
        notifyCount.style.display = 'none';
      }

      if (list && list.length > 0) {
        notificationsContent.innerHTML = list.map(n => `
          <div class="notify-item" style="${n.isRead ? '' : 'background: rgba(255,122,0,0.05); font-weight: 600;'}">
            <div>${n.message}</div>
            <span class="time">${new Date(n.createdAt).toLocaleString()}</span>
          </div>
        `).join('');
      } else {
        notificationsContent.innerHTML = `<div class="notify-item" style="color: var(--text-gray); text-align: center;">Không có thông báo nào.</div>`;
      }
    }
  } catch (err) {
    console.error('Fetch notifications failed:', err);
  }
}

// Load AI quota remaining
async function loadAiUsage() {
  try {
    const response = await fetch(`${defaultServerUrl}/api/ai/usage`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      const usage = await response.json();
      const count = usage.count;
      const limit = usage.limit;

      aiQuotaSpan.innerText = `Hôm nay đã dùng: ${count}/${limit} lượt`;
      if (count >= limit) {
        aiEnhanceBtn.disabled = true;
        aiEnhanceBtn.style.opacity = '0.5';
      }
    }
  } catch (err) {
    console.warn('Load AI quota failed:', err);
  }
}

// Call AI Advisor API
async function enhanceDescription() {
  const currentDesc = descInput.value.trim();
  if (!currentDesc) {
    alert('Vui lòng nhập mô tả thuyết minh hiện tại để AI có dữ liệu tối ưu.');
    return;
  }

  aiStatusText.innerText = 'Đang gọi trợ lý AI Gemini (Tối đa 30s)...';
  aiResponseDiv.innerText = 'Đang tối ưu hóa thuyết minh của bạn...';
  aiEnhanceBtn.disabled = true;
  aiApplyBtn.style.display = 'none';

  try {
    const response = await fetch(`${defaultServerUrl}/api/ai/enhance-description`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ description: currentDesc })
    });

    if (response.ok) {
      const data = await response.json();
      aiResponseDiv.innerText = data.enhancedText;
      aiStatusText.innerText = 'Tối ưu hóa thành công!';
      aiApplyBtn.style.display = 'inline-block';

      // Update quota
      loadAiUsage();
    } else {
      const errText = await response.text();
      aiResponseDiv.innerText = errText || 'Tối ưu hóa thất bại.';
      aiStatusText.innerText = 'Lỗi gọi AI.';
    }
  } catch (err) {
    console.error('AI call failed:', err);
    aiResponseDiv.innerText = 'Quá thời gian kết nối AI (30 giây) hoặc lỗi mạng.';
    aiStatusText.innerText = 'Lỗi kết nối AI.';
  } finally {
    aiEnhanceBtn.disabled = false;
  }
}

function applyAiDescription() {
  const aiText = aiResponseDiv.innerText.trim();
  if (aiText && !aiText.startsWith('Kết quả') && !aiText.startsWith('Tối ưu hóa thất bại')) {
    descInput.value = aiText;
    aiApplyBtn.style.display = 'none';
    aiStatusText.innerText = 'Đã áp dụng mô tả AI vào bài viết gốc!';
  }
}
// owner chart functions removed — stats page moved to owner-stats.html
