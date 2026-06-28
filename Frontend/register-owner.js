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

let mapSelect;
let clickMarker = null;

const latInput = document.getElementById('latitude');
const lngInput = document.getElementById('longitude');
const registerForm = document.getElementById('register-form');
const errorMessage = document.getElementById('error-message');
const successMessage = document.getElementById('success-message');

// Initialize Map
function initMapSelect() {
  const vinhKhanhCenter = [10.760124, 106.702958];
  
  mapSelect = L.map('map-select', {
    zoomControl: true,
    attributionControl: false
  }).setView(vinhKhanhCenter, 16);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(mapSelect);

  // Default coordinate selection
  updateCoordinates(vinhKhanhCenter[0], vinhKhanhCenter[1]);

  mapSelect.on('click', (e) => {
    updateCoordinates(e.latlng.lat, e.latlng.lng);
  });
}

function updateCoordinates(lat, lng) {
  latInput.value = lat.toFixed(6);
  lngInput.value = lng.toFixed(6);

  if (clickMarker) {
    clickMarker.setLatLng([lat, lng]);
  } else {
    // Standard marker or custom orange CSS marker
    clickMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        html: `<div class="pin-marker" style="background: #FF7A00; width: 20px; height: 20px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); margin: -10px 0 0 -10px; border: 2px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>`,
        className: 'custom-click-icon',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      })
    }).addTo(mapSelect);
  }
}

// Initialize map select on load
window.addEventListener('DOMContentLoaded', () => {
  initMapSelect();
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorMessage.innerText = '';
  successMessage.innerText = '';

  const formData = new FormData();
  formData.append('username', document.getElementById('username').value.trim());
  formData.append('password', document.getElementById('password').value.trim());
  formData.append('fullName', document.getElementById('fullname').value.trim());
  formData.append('cccd', document.getElementById('cccd').value.trim());
  formData.append('phoneNumber', document.getElementById('phone').value.trim());
  formData.append('email', document.getElementById('email').value.trim());
  formData.append('stallName', document.getElementById('stallName').value.trim());
  formData.append('stallAddress', document.getElementById('stallAddress').value.trim());
  formData.append('latitude', parseFloat(latInput.value));
  formData.append('longitude', parseFloat(lngInput.value));
  formData.append('description', document.getElementById('description').value.trim());

  const menuFileInput = document.getElementById('menuImages');
  if (menuFileInput && menuFileInput.files && menuFileInput.files.length > 0) {
    for (let i = 0; i < menuFileInput.files.length; i++) {
      formData.append('menuImages', menuFileInput.files[i]);
    }
  }

  try {
    const response = await fetch(`${defaultServerUrl}/api/auth/register-owner`, {
      method: 'POST',
      body: formData
    });

    if (response.ok) {
      successMessage.innerText = 'Đăng ký thành công! Đơn đăng ký của bạn đang chờ Admin phê duyệt. Trình duyệt đang chuyển hướng...';
      registerForm.reset();
      
      setTimeout(() => {
        window.location.href = 'login.html';
      }, 3000);
    } else {
      const errorText = await response.text();
      errorMessage.innerText = errorText || 'Đăng ký thất bại. Vui lòng kiểm tra lại.';
    }
  } catch (err) {
    console.error('Registration error:', err);
    errorMessage.innerText = 'Lỗi kết nối máy chủ. Vui lòng kiểm tra lại kết nối mạng.';
  }
});
