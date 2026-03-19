// DOM Elements
const profileForm = document.getElementById('profile-form');
const securityForm = document.getElementById('security-form');
const addDeviceForm = document.getElementById('add-device-form');
const renameDeviceForm = document.getElementById('rename-device-form');

const profileAlert = document.getElementById('profile-alert');
const securityAlert = document.getElementById('security-alert');
const addDeviceAlert = document.getElementById('add-device-alert');

const accName = document.getElementById('acc-name');
const accEmail = document.getElementById('acc-email');

let allDevices = [];

document.addEventListener('DOMContentLoaded', async () => {
    if (!Auth.isAuthenticated()) {
        window.location.href = 'index.html';
        return;
    }

    const user = Auth.getUser();
    if (user) {
        accName.value = user.name;
        accEmail.value = user.email;
    }

    await loadDevices();
    
    // Attach form listeners
    profileForm.addEventListener('submit', handleProfileUpdate);
    securityForm.addEventListener('submit', handleSecurityUpdate);
    addDeviceForm.addEventListener('submit', handleAddDevice);
    renameDeviceForm.addEventListener('submit', handleRenameDevice);
});

async function handleProfileUpdate(e) {
    e.preventDefault();
    try {
        const payload = {
            name: accName.value,
            email: accEmail.value
        };
        const res = await apiFetch('/api/auth/me', {
            method: 'PUT',
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Failed to update profile');
        
        const usr = Auth.getUser();
        usr.name = payload.name;
        Auth.setToken(Auth.getToken(), usr);
        if (typeof refreshAuthUI === 'function') refreshAuthUI();

        profileAlert.innerText = 'Profile saved successfully!';
        profileAlert.style.display = 'block';
        setTimeout(() => profileAlert.style.display = 'none', 3000);
    } catch (err) {
        console.error(err);
        profileAlert.innerText = err.message;
        profileAlert.className = 'alert-box alert-error';
        profileAlert.style.display = 'block';
    }
}

async function handleSecurityUpdate(e) {
    e.preventDefault();
    const oldPwd = document.getElementById('acc-old-pwd').value;
    const newPwd = document.getElementById('acc-new-pwd').value;
    const confPwd = document.getElementById('acc-conf-pwd').value;

    if (newPwd !== confPwd) {
        securityAlert.innerText = 'New passwords do not match!';
        securityAlert.className = 'alert-box alert-error';
        securityAlert.style.display = 'block';
        return;
    }

    try {
        const payload = {
            currentPassword: oldPwd,
            newPassword: newPwd
        };
        const res = await apiFetch('/api/auth/password', {
            method: 'PUT',
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || 'Failed to update password');
        }

        securityAlert.innerText = 'Password updated successfully!';
        securityAlert.className = 'alert-box alert-success';
        securityAlert.style.background = '#c6f6d5';
        securityAlert.style.color = '#22543d';
        securityAlert.style.borderColor = '#9ae6b4';
        securityAlert.style.display = 'block';
        securityForm.reset();
        setTimeout(() => securityAlert.style.display = 'none', 3000);
    } catch (err) {
        securityAlert.innerText = err.message;
        securityAlert.className = 'alert-box alert-error';
        securityAlert.style.display = 'block';
    }
}

async function loadDevices() {
    try {
        const res = await apiFetch('/api/devices');
        if (!res.ok) throw new Error('Failed to load devices');
        allDevices = await res.json();
        
        renderDevicesList();
        renderNotificationsList();
    } catch (err) {
        console.error(err);
        document.getElementById('acc-devices-list').innerHTML = '<div style="color:var(--danger-color)">Error loading devices</div>';
    }
}

function renderDevicesList() {
    const listEl = document.getElementById('acc-devices-list');
    listEl.innerHTML = '';

    if (allDevices.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; padding:1rem; color:var(--text-muted);">No devices found</div>';
        return;
    }

    allDevices.forEach(d => {
        const item = document.createElement('div');
        item.className = 'list-item';
        
        item.innerHTML = `
            <div class="item-meta">
                <span class="item-title">${d.name}</span>
                <span class="item-subtitle">Added on ${new Date(d.created_at).toLocaleDateString()}</span>
            </div>
            <div style="display:flex; gap:0.5rem;">
                <button class="btn btn-outline" style="padding:0.3rem 0.6rem; font-size:0.875rem;" onclick="openRenameModal(${d.id}, '${d.name.replace(/'/g, "\\'")}')">Rename</button>
                <button class="btn btn-danger" style="padding:0.3rem 0.6rem; font-size:0.875rem;" onclick="deleteDevice(${d.id})"><i class="ph ph-trash"></i></button>
            </div>
        `;
        listEl.appendChild(item);
    });
}

function renderNotificationsList() {
    const listEl = document.getElementById('notification-toggles');
    listEl.innerHTML = '';

    if (allDevices.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; padding:1rem; color:var(--text-muted);">Configure devices first</div>';
        return;
    }

    allDevices.forEach(d => {
        const item = document.createElement('div');
        item.className = 'list-item';
        
        item.innerHTML = `
            <div class="item-meta" style="flex:1;">
                <span class="item-title">${d.name}</span>
                <span class="item-subtitle" style="font-family:monospace; background:#e2e8f0; padding:0.2rem 0.4rem; border-radius:4px; display:inline-block; margin-top:0.25rem;">
                    Key: ${d.api_key}
                    <i class="ph ph-copy" style="cursor:pointer; margin-left:0.5rem;" onclick="copyToClipboard('${d.api_key}')" title="Copy"></i>
                </span>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
                <span style="font-size:0.875rem; color:var(--text-muted);">Email Alerts</span>
                <label class="toggle-switch">
                    <input type="checkbox" ${d.notify_email ? 'checked' : ''} onchange="toggleNotify(${d.id}, this.checked)">
                    <span class="toggle-slider"></span>
                </label>
            </div>
        `;
        listEl.appendChild(item);
    });
}

// Device Actions
async function handleAddDevice(e) {
    e.preventDefault();
    const name = document.getElementById('new-dev-name').value;
    addDeviceAlert.style.display = 'none';

    try {
        const res = await apiFetch('/api/devices', {
            method: 'POST',
            body: JSON.stringify({ name })
        });
        if (!res.ok) throw new Error('Failed to create device');
        
        document.getElementById('new-dev-name').value = '';
        await loadDevices();
    } catch (err) {
        addDeviceAlert.innerText = err.message;
        addDeviceAlert.style.display = 'block';
    }
}

async function deleteDevice(id) {
    if (!confirm('Are you sure you want to delete this device? All related data will be lost forever.')) return;
    try {
        const res = await apiFetch(`/api/devices/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete');
        await loadDevices();
    } catch (err) {
        alert(err.message);
    }
}

function openRenameModal(id, currentName) {
    document.getElementById('rename-dev-id').value = id;
    document.getElementById('rename-dev-name').value = currentName;
    document.getElementById('rename-device-modal').classList.add('active');
}

async function handleRenameDevice(e) {
    e.preventDefault();
    const id = document.getElementById('rename-dev-id').value;
    const newName = document.getElementById('rename-dev-name').value;
    
    try {
        // Minimal update: just resend existing settings with new name?
        // Wait, the API PUT /api/devices/:id ONLY updates thresholds! It doesn't update name.
        // Let's check backend. If it doesn't support changing name, we skip it or mock it.
        // The instructions said "Actions: Add device, Delete device, Rename device." existing didn't support rename directly.
        // I will do a quick PUT /api/devices/:id/name if possible, but rules say DO NOT refactor backend.
        // If I can't hit a rename endpoint, I'll alert the user.
        alert('Rename device API route not available in the current backend API version.');
        document.getElementById('rename-device-modal').classList.remove('active');
    } catch (err) {
        alert(err.message);
    }
}

async function toggleNotify(id, checked) {
    const dev = allDevices.find(d => d.id === id);
    if (!dev) return;
    
    try {
        // Reuse existing endpoint to update thresholds and notify
        const payload = {
            temp_high: dev.temp_high,
            temp_low: dev.temp_low,
            hum_high: dev.hum_high,
            hum_low: dev.hum_low,
            notify_email: checked
        };
        const res = await apiFetch(`/api/devices/${id}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to update notifications');
        
        dev.notify_email = checked; // update local cache
    } catch (err) {
        alert(err.message);
        await loadDevices(); // revert UI on failure
    }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        alert('API Key copied to clipboard!');
    }).catch(err => {
        prompt("Copy API Key:", text);
    });
}
