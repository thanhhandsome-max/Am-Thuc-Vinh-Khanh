const defaultServerUrl = window.location.port === '3000'
  ? `${window.location.protocol}//${window.location.hostname}:5080`
  : (window.location.port === '5080' ? window.location.origin : `${window.location.protocol}//${window.location.hostname}:5080`);

const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const errorMessage = document.getElementById('error-message');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorMessage.innerText = '';

  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  try {
    const response = await fetch(`${defaultServerUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (response.ok) {
      const data = await response.json();
      localStorage.setItem('authToken', data.token);
      localStorage.setItem('userRole', data.user.role);
      localStorage.setItem('username', data.user.username);
      localStorage.setItem('userId', data.user.id);
      localStorage.setItem('deviceUniqueId', data.user.deviceUniqueId);

      // Redirect depending on user role — only Owner & Admin allowed here
      if (data.user.role === 'Admin') {
        window.location.href = 'admin.html';
      } else if (data.user.role === 'Owner') {
        window.location.href = 'owner.html';
      } else {
        // Public users should not use this login page
        localStorage.removeItem('authToken');
        localStorage.removeItem('userRole');
        localStorage.removeItem('username');
        localStorage.removeItem('userId');
        errorMessage.innerText = 'Trang đăng nhập này chỉ dành cho Chủ Quán và Quản trị viên. Khách vui lòng truy cập trang Bản đồ.';
      }
    } else {
      const text = await response.text();
      errorMessage.innerText = text || 'Đăng nhập thất bại.';
    }
  } catch (err) {
    console.error(err);
    errorMessage.innerText = 'Lỗi kết nối đến máy chủ.';
  }
});
