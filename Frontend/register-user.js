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

const form = document.getElementById('register-user-form');
const errorMessage = document.getElementById('error-message');
const successMessage = document.getElementById('success-message');

function storeLoginSession(data, profile) {
  localStorage.removeItem('hasPaidAccess');
  localStorage.setItem('authToken', data.token);
  localStorage.setItem('userRole', data.user.role);
  localStorage.setItem('username', data.user.username);
  localStorage.setItem('userId', data.user.id);
  localStorage.setItem('deviceUniqueId', data.user.deviceUniqueId);
  if (profile) {
    localStorage.setItem('fullName', profile.fullName || '');
    localStorage.setItem('email', profile.email || '');
    localStorage.setItem('phoneNumber', profile.phoneNumber || '');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorMessage.innerText = '';
  successMessage.innerText = '';

  const payload = {
    username: document.getElementById('username').value.trim(),
    password: document.getElementById('password').value.trim(),
    fullName: document.getElementById('fullName').value.trim(),
    phoneNumber: document.getElementById('phoneNumber').value.trim(),
    email: document.getElementById('email').value.trim()
  };

  try {
    const response = await fetch(`${defaultServerUrl}/api/auth/register-public`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const loginResponse = await fetch(`${defaultServerUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: payload.username,
          password: payload.password
        })
      });

      if (!loginResponse.ok) {
        const loginError = await loginResponse.text();
        throw new Error(loginError || 'Đăng ký thành công nhưng không thể tự đăng nhập.');
      }

      const loginData = await loginResponse.json();
      storeLoginSession(loginData, payload);
      successMessage.innerText = 'Đăng ký thành công! Đang đăng nhập và chuyển về trang chủ...';
      form.reset();
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1200);
    } else {
      const errorText = await response.text();
      errorMessage.innerText = errorText || 'Đăng ký thất bại. Vui lòng kiểm tra lại.';
    }
  } catch (err) {
    console.error('Public registration error:', err);
    errorMessage.innerText = err.message || 'Lỗi kết nối máy chủ. Vui lòng kiểm tra lại mạng.';
  }
});
