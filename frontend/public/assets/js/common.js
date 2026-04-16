// Application State & Auth Management
const Auth = {
    getToken: () => localStorage.getItem('accessToken'),
    getUser: () => {
        const user = localStorage.getItem('user');
        return user ? JSON.parse(user) : null;
    },
    setToken: (token, user) => {
        localStorage.setItem('accessToken', token);
        localStorage.setItem('user', JSON.stringify(user));
    },
    logout: () => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('user');
        window.location.href = 'index.html';
    },
    isAuthenticated: () => !!localStorage.getItem('accessToken')
};

// Common API Fetch wrapper that injects JWT token
async function apiFetch(url, options = {}) {
    const token = Auth.getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        const response = await fetch(url, { ...options, headers });
        return response;
    } catch (error) {
        console.error('API Fetch Error:', error);
        throw error;
    }
}

function injectAccountDropdown() {
    const topbarRight = document.querySelector('.topbar-right');
    if (!topbarRight) return;

    // Clear old auth buttons if they exist
    const oldAuthBtn = document.getElementById('auth-btn');
    if (oldAuthBtn) oldAuthBtn.remove();
    const oldUserProfile = document.getElementById('user-profile-btn');
    if (oldUserProfile) oldUserProfile.remove();

    // Inject avatar button with Green background
    const avatarHTML = `
        <div class="user-profile" id="user-profile-btn" title="Account" style="position:relative; z-index:100; cursor:pointer;">
            <div class="avatar" id="user-avatar" style="transition:transform 0.2s; margin-right:1rem; box-shadow:0 2px 4px rgba(0,0,0,0.1); background:var(--success-color); color:white;"><i class="ph ph-user"></i></div>
        </div>
    `;
    topbarRight.insertAdjacentHTML('afterbegin', avatarHTML);

    // Inject dropdown modal to body
    const dropHTML = `
<div class="account-dropdown" id="account-dropdown">
    <div id="unauth-dropdown-view">
        <div class="tab-group" style="display:flex; border-bottom:1px solid #edf2f7; margin-bottom:1rem;">
            <div class="tab active" id="tab-btn-login" onclick="window.switchAuthTab('login')" style="flex:1; text-align:center; padding:1rem; cursor:pointer; font-weight:600; border-bottom:2px solid var(--primary-color); color:var(--primary-color);">Login</div>
            <div class="tab" id="tab-btn-register" onclick="window.switchAuthTab('register')" style="flex:1; text-align:center; padding:1rem; cursor:pointer; font-weight:600; border-bottom:2px solid transparent; color:var(--text-muted);">Register</div>
        </div>
        <div style="padding:0 1.5rem 1.5rem;">
            <div id="login-form-view">
                <div id="login-error" class="alert-box alert-error" style="display:none; padding:0.5rem; margin-bottom:1rem; font-size:0.875rem;"></div>
                <form onsubmit="window.handleLoginDrop(event)">
                    <div class="form-group">
                        <label style="font-size:0.875rem;">Email Address</label>
                        <input type="email" id="login-email-drop" required value="user@example.com">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.875rem;">Password</label>
                        <input type="password" id="login-password-drop" required value="User123!">
                    </div>
                    <button type="submit" class="btn btn-primary" style="width:100%; justify-content:center;">Sign In</button>
                </form>
            </div>
            <div id="register-form-view" style="display:none;">
                <div id="register-error" class="alert-box alert-error" style="display:none; padding:0.5rem; margin-bottom:1rem; font-size:0.875rem;"></div>
                <form onsubmit="window.handleRegisterDrop(event)">
                    <div class="form-group">
                        <label style="font-size:0.875rem;">Full Name</label>
                        <input type="text" id="reg-name-drop" required>
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.875rem;">Email Address</label>
                        <input type="email" id="reg-email-drop" required>
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.875rem;">Password</label>
                        <input type="password" id="reg-password-drop" required>
                    </div>
                    <button type="submit" class="btn btn-primary" style="width:100%; justify-content:center;">Create Account</button>
                </form>
            </div>
        </div>
    </div>
    
    <div id="auth-dropdown-view" style="display:none;">
        <div style="padding: 1.5rem; border-bottom: 1px solid #edf2f7; text-align:center;">
            <div style="width:48px; height:48px; background:var(--success-color); color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:1.5rem; margin:0 auto 0.5rem; font-weight:700;" id="drop-avatar-lg">U</div>
            <div style="font-weight:700; font-size:1.1rem;" id="drop-name">User Name</div>
            <div style="color:var(--text-muted); font-size:0.875rem;" id="drop-email">user@email.com</div>
        </div>
        <div style="padding: 1rem;">
            <a href="account.html" class="btn btn-outline" style="width:100%; justify-content:center; margin-bottom:0.5rem;">Edit Profile</a>
            <button class="btn btn-outline" style="width:100%; justify-content:center; color:var(--danger-color);" onclick="Auth.logout()"><i class="ph ph-sign-out"></i> Sign Out</button>
        </div>
    </div>
</div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', dropHTML);
    const dropEl = document.getElementById('account-dropdown');
    const avatarBtn = document.getElementById('user-profile-btn');
    const userAvatar = document.getElementById('user-avatar');
    
    avatarBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = avatarBtn.getBoundingClientRect();
        dropEl.style.top = (rect.bottom + 15) + 'px';
        dropEl.style.left = (rect.right - 320) + 'px'; 
        dropEl.classList.toggle('active');
        if (dropEl.classList.contains('active')) {
            userAvatar.style.transform = 'scale(1.1)';
        } else {
            userAvatar.style.transform = 'scale(1)';
        }
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!dropEl.contains(e.target) && !avatarBtn.contains(e.target)) {
            dropEl.classList.remove('active');
            if (userAvatar) userAvatar.style.transform = 'scale(1)';
        }
    });
}

// Window functions for the dropdown
window.switchAuthTab = function(tab) {
    document.getElementById('tab-btn-login').style.borderBottomColor = 'transparent';
    document.getElementById('tab-btn-login').style.color = 'var(--text-muted)';
    document.getElementById('tab-btn-register').style.borderBottomColor = 'transparent';
    document.getElementById('tab-btn-register').style.color = 'var(--text-muted)';
    
    document.getElementById('login-form-view').style.display = 'none';
    document.getElementById('register-form-view').style.display = 'none';
    
    if (tab === 'login') {
        document.getElementById('tab-btn-login').style.borderBottomColor = 'var(--primary-color)';
        document.getElementById('tab-btn-login').style.color = 'var(--primary-color)';
        document.getElementById('login-form-view').style.display = 'block';
    } else {
        document.getElementById('tab-btn-register').style.borderBottomColor = 'var(--primary-color)';
        document.getElementById('tab-btn-register').style.color = 'var(--primary-color)';
        document.getElementById('register-form-view').style.display = 'block';
    }
}

window.handleLoginDrop = async function(e) {
    e.preventDefault();
    const errBox = document.getElementById('login-error');
    errBox.style.display = 'none';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: document.getElementById('login-email-drop').value,
                password: document.getElementById('login-password-drop').value
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');

        Auth.setToken(data.accessToken, data.user);
        window.location.reload(); // Refresh to apply auth state
    } catch (err) {
        errBox.innerText = err.message;
        errBox.style.display = 'block';
    }
}

window.handleRegisterDrop = async function(e) {
    e.preventDefault();
    const errBox = document.getElementById('register-error');
    errBox.style.display = 'none';

    try {
        const payload = {
            name: document.getElementById('reg-name-drop').value,
            email: document.getElementById('reg-email-drop').value,
            password: document.getElementById('reg-password-drop').value
        };

        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed');

        document.getElementById('login-email-drop').value = payload.email;
        document.getElementById('login-password-drop').value = payload.password;
        window.switchAuthTab('login');
        window.handleLoginDrop({ preventDefault: ()=>{} });
    } catch (err) {
        errBox.innerText = err.message;
        errBox.style.display = 'block';
    }
}

// UI Utilities
function initUI() {
    // Inject Dropdown
    injectAccountDropdown();

    // Drawer Toggle
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');
    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            if (sidebar.style.transform === 'translateX(0px)') {
                sidebar.style.transform = 'translateX(-100%)';
            } else {
                sidebar.style.transform = 'translateX(0px)';
            }
        });
    }

    // Set Active State for Drawer nav
    const currentPath = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
        if (el.getAttribute('href') === currentPath) {
            el.classList.add('active');
        }
    });

    // Setup Auth UI Elements
    refreshAuthUI();
}

function refreshAuthUI() {
    const user = Auth.getUser();
    
    // Auth Dropdown Views
    const unauthView = document.getElementById('unauth-dropdown-view');
    const authView = document.getElementById('auth-dropdown-view');
    const userAvatar = document.getElementById('user-avatar');
    
    if (user) {
        if (unauthView) unauthView.style.display = 'none';
        if (authView) authView.style.display = 'block';
        
        if (userAvatar) {
            userAvatar.innerText = user.name ? user.name.charAt(0).toUpperCase() : 'U';
            userAvatar.style.background = 'var(--success-color)';
        }
        
        const dropName = document.getElementById('drop-name');
        const dropEmail = document.getElementById('drop-email');
        const dropAvatarLg = document.getElementById('drop-avatar-lg');
        
        if (dropName) dropName.innerText = user.name;
        if (dropEmail) dropEmail.innerText = user.email;
        if (dropAvatarLg) dropAvatarLg.innerText = user.name ? user.name.charAt(0).toUpperCase() : 'U';

        // Show/Hide Admin Nav globally
        const adminNav = document.getElementById('admin-nav');
        if (adminNav) {
            adminNav.style.display = user.role === 'admin' ? 'flex' : 'none';
        }
    } else {
        if (unauthView) unauthView.style.display = 'block';
        if (authView) authView.style.display = 'none';
        
        if (userAvatar) {
            userAvatar.innerHTML = '<i class="ph ph-user"></i>';
            userAvatar.style.background = 'var(--text-muted)';
        }
    }
}

// Setup global listener for init
document.addEventListener('DOMContentLoaded', initUI);
