import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Account() {
    const { isAuthenticated, user, apiFetch, login } = useAuth();

    // Profile form
    const [accName, setAccName] = useState('');
    const [accEmail, setAccEmail] = useState('');
    const [profileAlert, setProfileAlert] = useState({ show: false, msg: '', type: '' });

    // Security form
    const [oldPwd, setOldPwd] = useState('');
    const [newPwd, setNewPwd] = useState('');
    const [confPwd, setConfPwd] = useState('');
    const [securityAlert, setSecurityAlert] = useState({ show: false, msg: '', type: '' });

    // Devices & Add Device
    const [devices, setDevices] = useState([]);
    const [loadingDevices, setLoadingDevices] = useState(true);
    const [newDevName, setNewDevName] = useState('');
    const [addDeviceAlert, setAddDeviceAlert] = useState({ show: false, msg: '' });

    // Modals
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    const [renameDevId, setRenameDevId] = useState('');
    const [renameDevName, setRenameDevName] = useState('');

    useEffect(() => {
        if (user) {
            setAccName(user.name || '');
            setAccEmail(user.email || '');
        }
        loadDevices();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, isAuthenticated]);

    const loadDevices = async () => {
        if (!isAuthenticated) return;
        try {
            setLoadingDevices(true);
            const res = await apiFetch('/api/devices');
            if (!res.ok) throw new Error('Failed to load devices');
            const data = await res.json();
            setDevices(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoadingDevices(false);
        }
    };

    const handleProfileUpdate = async (e) => {
        e.preventDefault();
        try {
            const payload = { name: accName, email: accEmail };
            const res = await apiFetch('/api/auth/me', {
                method: 'PUT',
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error('Failed to update profile');
            
            const updatedUser = { ...user, ...payload };
            login(localStorage.getItem('accessToken'), updatedUser);

            setProfileAlert({ show: true, msg: 'Profile saved successfully!', type: 'success' });
            setTimeout(() => setProfileAlert({ show: false, msg: '', type: '' }), 3000);
        } catch (err) {
            setProfileAlert({ show: true, msg: err.message, type: 'error' });
        }
    };

    const handleSecurityUpdate = async (e) => {
        e.preventDefault();
        if (newPwd !== confPwd) {
            setSecurityAlert({ show: true, msg: 'New passwords do not match!', type: 'error' });
            return;
        }

        try {
            const res = await apiFetch('/api/auth/password', {
                method: 'PUT',
                body: JSON.stringify({ currentPassword: oldPwd, newPassword: newPwd })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to update password');
            }

            setSecurityAlert({ show: true, msg: 'Password updated successfully!', type: 'success' });
            setOldPwd(''); setNewPwd(''); setConfPwd('');
            setTimeout(() => setSecurityAlert({ show: false, msg: '', type: '' }), 3000);
        } catch (err) {
            setSecurityAlert({ show: true, msg: err.message, type: 'error' });
        }
    };

    const handleAddDevice = async (e) => {
        e.preventDefault();
        setAddDeviceAlert({ show: false, msg: '' });

        try {
            const res = await apiFetch('/api/devices', {
                method: 'POST',
                body: JSON.stringify({ name: newDevName })
            });
            if (!res.ok) throw new Error('Failed to create device');
            
            setNewDevName('');
            await loadDevices();
        } catch (err) {
            setAddDeviceAlert({ show: true, msg: err.message });
        }
    };

    const deleteDevice = async (id) => {
        if (!window.confirm('Are you sure you want to delete this device? All related data will be lost forever.')) return;
        try {
            const res = await apiFetch(`/api/devices/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete');
            await loadDevices();
        } catch (err) {
            alert(err.message);
        }
    };

    const openRenameModal = (id, currentName) => {
        setRenameDevId(id);
        setRenameDevName(currentName);
        setIsRenameModalOpen(true);
    };

    const handleRenameDevice = async (e) => {
        e.preventDefault();
        alert('Rename device API route not available in the current backend API version.');
        setIsRenameModalOpen(false);
    };

    const toggleNotify = async (id, checked) => {
        const dev = devices.find(d => d.id === id);
        if (!dev) return;
        
        try {
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
            
            setDevices(prev => prev.map(d => d.id === id ? { ...d, notify_email: checked } : d));
        } catch (err) {
            alert(err.message);
            await loadDevices();
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text).then(() => {
            alert('API Key copied to clipboard!');
        }).catch(err => {
            const p = window.prompt("Copy API Key:", text);
        });
    };

    if (!isAuthenticated) {
        return (
            <div id="unauth-msg" className="card" style={{ marginTop: '2rem' }}>
                <p className="text-danger"><i className="ph ph-warning-circle"></i> You must be logged in.</p>
            </div>
        );
    }

    return (
        <>
            <div className="account-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '2rem', marginTop: '2rem' }}>
                {/* Left Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    
                    {/* Profile Card */}
                    <div className="card">
                        <div className="card-header" style={{ marginBottom: '1.5rem' }}>
                            <i className="ph ph-user"></i>
                            <span>Profile Information</span>
                        </div>
                        {profileAlert.show && (
                            <div className={profileAlert.type === 'success' ? 'alert-box alert-success' : 'alert-box alert-error'} style={profileAlert.type === 'success' ? { background: '#c6f6d5', color: '#22543d', borderColor: '#9ae6b4', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem' } : { padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem' }}>
                                {profileAlert.msg}
                            </div>
                        )}
                        <form onSubmit={handleProfileUpdate}>
                            <div className="form-group">
                                <label>Email Address</label>
                                <input type="email" required title="Update your registered email" value={accEmail} onChange={e => setAccEmail(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>Full Name</label>
                                <input type="text" required value={accName} onChange={e => setAccName(e.target.value)} />
                            </div>
                            <button type="submit" className="btn btn-primary mt-2">Save Profile</button>
                        </form>
                    </div>

                    {/* Security Card */}
                    <div className="card">
                        <div className="card-header" style={{ marginBottom: '1.5rem' }}>
                            <i className="ph ph-lock-key"></i>
                            <span>Security</span>
                        </div>
                        {securityAlert.show && (
                            <div className={securityAlert.type === 'success' ? 'alert-box alert-success' : 'alert-box alert-error'} style={securityAlert.type === 'success' ? { background: '#c6f6d5', color: '#22543d', borderColor: '#9ae6b4', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem' } : { padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem' }}>
                                {securityAlert.msg}
                            </div>
                        )}
                        <form onSubmit={handleSecurityUpdate}>
                            <div className="form-group">
                                <label>Current Password</label>
                                <input type="password" required value={oldPwd} onChange={e => setOldPwd(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>New Password</label>
                                <input type="password" required minLength="6" value={newPwd} onChange={e => setNewPwd(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>Confirm Password</label>
                                <input type="password" required minLength="6" value={confPwd} onChange={e => setConfPwd(e.target.value)} />
                            </div>
                            <button type="submit" className="btn btn-primary mt-2">Update Password</button>
                        </form>
                    </div>
                </div>

                {/* Right Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    
                    {/* Devices Card */}
                    <div className="card">
                        <div className="card-header" style={{ marginBottom: '1.5rem' }}>
                            <i className="ph ph-devices"></i>
                            <span>My Devices</span>
                        </div>
                        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.875rem' }}>Manage your active sensor hardware components.</p>
                        
                        <div style={{ marginBottom: '1.5rem' }}>
                            {loadingDevices ? (
                                <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)' }}>Loading devices...</div>
                            ) : devices.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)' }}>No devices found</div>
                            ) : (
                                devices.map(d => (
                                    <div className="list-item" key={d.id} style={{ padding: '1.25rem 0', borderBottom: '1px solid #edf2f7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div className="item-meta" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                            <span className="item-title" style={{ fontWeight: 600, color: 'var(--text-main)' }}>{d.name}</span>
                                            <span className="item-subtitle" style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Added on {new Date(d.created_at).toLocaleDateString()}</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button className="btn btn-outline" style={{ padding: '0.3rem 0.6rem', fontSize: '0.875rem' }} onClick={() => openRenameModal(d.id, d.name)}>Rename</button>
                                            <button className="btn btn-danger" style={{ padding: '0.3rem 0.6rem', fontSize: '0.875rem' }} onClick={() => deleteDevice(d.id)}><i className="ph ph-trash"></i></button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        
                        <div style={{ borderTop: '1px solid #edf2f7', paddingTop: '1.5rem' }}>
                            <h4 style={{ marginBottom: '1rem', fontSize: '1rem' }}>Add New Device</h4>
                            {addDeviceAlert.show && (
                                <div className="alert-box alert-error" style={{ padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem' }}>{addDeviceAlert.msg}</div>
                            )}
                            <form onSubmit={handleAddDevice} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
                                <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                                    <label style={{ fontSize: '0.875rem' }}>Device Name</label>
                                    <input type="text" required placeholder="Living Room Sensor" value={newDevName} onChange={e => setNewDevName(e.target.value)} />
                                </div>
                                <button type="submit" className="btn btn-primary" style={{ height: '42px' }}><i className="ph ph-plus"></i> Add</button>
                            </form>
                        </div>
                    </div>

                    {/* Notifications & API Keys */}
                    <div className="card">
                        <div className="card-header" style={{ marginBottom: '1.5rem' }}>
                            <i className="ph ph-bell-ringing"></i>
                            <span>Device Options</span>
                        </div>
                        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.875rem' }}>Toggle email alerts per device and view API Keys.</p>
                        
                        <div>
                            {loadingDevices ? (
                                <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)' }}>Loading settings...</div>
                            ) : devices.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)' }}>Configure devices first</div>
                            ) : (
                                devices.map(d => (
                                    <div className="list-item" key={d.id} style={{ padding: '1.25rem 0', borderBottom: '1px solid #edf2f7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div className="item-meta" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                            <span className="item-title" style={{ fontWeight: 600, color: 'var(--text-main)' }}>{d.name}</span>
                                            <span className="item-subtitle" style={{ fontFamily: 'monospace', background: '#e2e8f0', padding: '0.2rem 0.4rem', borderRadius: '4px', display: 'inline-block', marginTop: '0.25rem' }}>
                                                Key: {d.api_key}
                                                <i className="ph ph-copy" style={{ cursor: 'pointer', marginLeft: '0.5rem' }} onClick={() => copyToClipboard(d.api_key)} title="Copy"></i>
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Email Alerts</span>
                                            <label className="toggle-switch" style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px' }}>
                                                <input type="checkbox" checked={d.notify_email} onChange={e => toggleNotify(d.id, e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                                                <span className="toggle-slider" style={{ position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: d.notify_email ? 'var(--success-color)' : '#cbd5e0', transition: '.4s', borderRadius: '34px' }}>
                                                    <span style={{ position: 'absolute', content: '""', height: '18px', width: '18px', left: '3px', bottom: '3px', backgroundColor: 'white', transition: '.4s', borderRadius: '50%', transform: d.notify_email ? 'translateX(20px)' : 'none' }}></span>
                                                </span>
                                            </label>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                </div>
            </div>

            {/* Modals for Devices inline editing */}
            <div className={`modal-overlay ${isRenameModalOpen ? 'active' : ''}`}>
                <div className="modal-content">
                    <div className="modal-header">
                        <h3>Rename Device</h3>
                        <button className="close-btn" onClick={() => setIsRenameModalOpen(false)}>&times;</button>
                    </div>
                    <form onSubmit={handleRenameDevice}>
                        <div className="form-group">
                            <label>New Name</label>
                            <input type="text" required value={renameDevName} onChange={e => setRenameDevName(e.target.value)} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                            <button type="button" className="btn btn-outline" onClick={() => setIsRenameModalOpen(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary">Rename</button>
                        </div>
                    </form>
                </div>
            </div>
        </>
    );
}
