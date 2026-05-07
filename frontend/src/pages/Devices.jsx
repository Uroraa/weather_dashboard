import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useConnection } from '../context/ConnectionContext';
import { io } from 'socket.io-client';
import { Link } from 'react-router-dom';

export default function Devices() {
    const { isAuthenticated, user, apiFetch, token } = useAuth();
    const { markDeviceOnline, markDeviceOffline, getDeviceStatus } = useConnection();
    const [devices, setDevices] = useState([]);
    
    // Modals state
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    
    // Form states
    const [newDevName, setNewDevName] = useState('');
    const [newDevDesc, setNewDevDesc] = useState('');
    
    const [editDevId, setEditDevId] = useState('');
    const [editTempHigh, setEditTempHigh] = useState('');
    const [editTempLow, setEditTempLow] = useState('');
    const [editHumHigh, setEditHumHigh] = useState('');
    const [editHumLow, setEditHumLow] = useState('');
    const [editEmailNotify, setEditEmailNotify] = useState(false);
    const [editX, setEditX] = useState('');
    const [editY, setEditY] = useState('');

    const socketRef = useRef(null);

    const loadMyDevices = async () => {
        if (!isAuthenticated) return;
        try {
            const res = await apiFetch('/api/devices');
            if (!res.ok) throw new Error();
            const data = await res.json();
            
            // Determine initial online/offline state for each device using last_reading
            // Same 60s window logic that was already working correctly
            data.forEach(d => {
                const isOnline = d.last_reading && (Date.now() - new Date(d.last_reading).getTime() < 10000);
                if (isOnline) {
                    // Mark online in shared context — source unknown from DB, socket will correct it
                    markDeviceOnline(d.id.toString(), 'sensor');
                } else {
                    markDeviceOffline(d.id.toString());
                }
            });
            setDevices(data);
        } catch (err) {
            console.error(err);
        }
    };

    useEffect(() => {
        loadMyDevices();
        
        if (isAuthenticated) {
            socketRef.current = io('/');
            socketRef.current.on('connect', () => {
                if(token) socketRef.current.emit('authenticate', token);
            });
            socketRef.current.on('new_reading', (r) => {
                // Update shared context with real-time source info
                markDeviceOnline(r.device_id.toString(), r.source);
            });
        }
        
        return () => {
            if (socketRef.current) socketRef.current.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, token]);

    const handleAddDevice = async (e) => {
        e.preventDefault();
        try {
            const res = await apiFetch('/api/devices', {
                method: 'POST',
                body: JSON.stringify({ name: newDevName, description: newDevDesc })
            });
            if(!res.ok) throw new Error("Failed to add device");
            setIsAddModalOpen(false);
            setNewDevName('');
            setNewDevDesc('');
            loadMyDevices();
        } catch(err) {
            alert(err.message);
        }
    };

    const handleEditDevice = async (e) => {
        e.preventDefault();
        const payload = {
            temp_high: editTempHigh || null,
            temp_low: editTempLow || null,
            hum_high: editHumHigh || null,
            hum_low: editHumLow || null,
            notify_email: editEmailNotify,
            x: editX !== '' ? parseFloat(editX) : null,
            y: editY !== '' ? parseFloat(editY) : null,
        };

        try {
            const res = await apiFetch(`/api/devices/${editDevId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            if(!res.ok) throw new Error("Update failed");
            setIsEditModalOpen(false);
            loadMyDevices();
        } catch(err) { alert(err.message); }
    };

    const deleteDevice = async (id) => {
        if(!window.confirm("Are you sure you want to delete this device? This will erase all its history.")) return;
        try {
            const res = await apiFetch(`/api/devices/${id}`, { method: 'DELETE' });
            if(!res.ok) throw new Error("Delete failed");
            loadMyDevices();
        } catch(err) { alert(err.message); }
    };

    const openEditModal = (d) => {
        setEditDevId(d.id);
        setEditTempHigh(d.temp_high ?? '');
        setEditTempLow(d.temp_low ?? '');
        setEditHumHigh(d.hum_high ?? '');
        setEditHumLow(d.hum_low ?? '');
        setEditEmailNotify(!!d.notify_email);
        setEditX(d.x ?? '');
        setEditY(d.y ?? '');
        setIsEditModalOpen(true);
    };

    const copyKey = (key) => {
        navigator.clipboard.writeText(key);
        alert("API Key copied to clipboard!");
    };

    return (
        <>
            <div style={{ position: 'absolute', top: '15px', right: '120px', zIndex: 100 }}>
                {isAuthenticated && (
                    <button className="btn btn-primary" onClick={() => setIsAddModalOpen(true)}>
                        <i className="ph ph-plus"></i> Add Device
                    </button>
                )}
            </div>

            {!isAuthenticated ? (
                <div id="unauth-msg" className="card" style={{ marginTop: '2rem' }}>
                    <p className="text-danger"><i className="ph ph-warning-circle"></i> You must be logged in to manage your devices.</p>
                </div>
            ) : (
                <div id="devices-grid" className="metrics-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', marginTop: '2rem' }}>
                    {devices.map(d => {
                        const devStatus = getDeviceStatus(d.id.toString());
                        const isOnline = devStatus === 'online' || devStatus === 'mock';
                        return (
                            <div className="card device-card" key={d.id} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div className="device-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <span className="device-title" style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <i className="ph ph-cpu"></i> {d.name}
                                        {d.notify_email && <span style={{ fontSize: '0.75rem', background: '#38a169', color: 'white', padding: '0.1rem 0.4rem', borderRadius: '1rem' }}>Email On</span>}
                                        {isOnline ? 
                                            <span style={{ fontSize: '0.75rem', background: '#c6f6d5', color: '#22543d', padding: '0.1rem 0.4rem', borderRadius: '1rem', marginLeft: '0.5rem' }}>Online</span> : 
                                            <span style={{ fontSize: '0.75rem', background: '#e2e8f0', color: '#4a5568', padding: '0.1rem 0.4rem', borderRadius: '1rem', marginLeft: '0.5rem' }}>Offline</span>
                                        }
                                        {user?.role === 'admin' && d.owner_name && <span style={{ fontSize: '0.75rem', color: '#718096', marginLeft: '0.5rem' }}>Owner: {d.owner_name}</span>}
                                    </span>
                                </div>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{d.description || 'No description'}</p>
                                
                                <div style={{ marginTop: '0.5rem' }}>
                                    <label style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>API Key (Secret)</label>
                                    <div className="api-key-box" style={{ background: '#f7fafc', border: '1px dashed #cbd5e0', padding: '0.5rem', borderRadius: '0.5rem', fontFamily: 'monospace', fontSize: '0.875rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', wordBreak: 'break-all' }}>
                                        <span>{d.api_key}</span>
                                        <button className="btn-copy" style={{ background: 'none', border: 'none', color: 'var(--primary-color)', cursor: 'pointer', padding: '0.2rem', marginLeft: '0.5rem' }} onClick={() => copyKey(d.api_key)} title="Copy Key"><i className="ph ph-copy"></i></button>
                                    </div>
                                </div>

                                <div className="device-actions" style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto', borderTop: '1px solid #edf2f7', paddingTop: '1rem' }}>
                                    <Link to={`/device?id=${d.id}`} className="btn btn-outline" style={{ flex: 1, justifyContent: 'center', padding: '0.4rem' }}><i className="ph ph-chart-bar"></i> <span>Details</span></Link>
                                    <button className="btn btn-outline" style={{ flex: 1, padding: '0.4rem' }} onClick={() => openEditModal(d)}><i className="ph ph-gear"></i> Settings</button>
                                    <button className="btn btn-danger" style={{ padding: '0.4rem' }} onClick={() => deleteDevice(d.id)} title="Delete Device"><i className="ph ph-trash"></i></button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Add Device Modal */}
            <div className={`modal-overlay ${isAddModalOpen ? 'active' : ''}`}>
                <div className="modal-content">
                    <div className="modal-header">
                        <h3>Add New Device</h3>
                        <button className="close-btn" onClick={() => setIsAddModalOpen(false)}><i className="ph ph-x"></i></button>
                    </div>
                    <form onSubmit={handleAddDevice}>
                        <div className="form-group">
                            <label>Device Name</label>
                            <input type="text" required placeholder="e.g. Living Room Sensor" value={newDevName} onChange={e => setNewDevName(e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label>Description (Optional)</label>
                            <textarea rows="3" value={newDevDesc} onChange={e => setNewDevDesc(e.target.value)}></textarea>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                            <button type="button" className="btn btn-outline" onClick={() => setIsAddModalOpen(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary">Create Device</button>
                        </div>
                    </form>
                </div>
            </div>

            {/* Edit Settings Modal */}
            <div className={`modal-overlay ${isEditModalOpen ? 'active' : ''}`}>
                <div className="modal-content">
                    <div className="modal-header">
                        <h3>Edit Settings</h3>
                        <button className="close-btn" onClick={() => setIsEditModalOpen(false)}><i className="ph ph-x"></i></button>
                    </div>
                    <form onSubmit={handleEditDevice}>
                        <h4 style={{ marginBottom: '0.5rem' }}>Alert Thresholds</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div className="form-group">
                                <label>Temp High (°C)</label>
                                <input type="number" step="0.1" placeholder="e.g. 30" value={editTempHigh} onChange={e => setEditTempHigh(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>Temp Low (°C)</label>
                                <input type="number" step="0.1" value={editTempLow} onChange={e => setEditTempLow(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>Humidity High (%)</label>
                                <input type="number" step="1" value={editHumHigh} onChange={e => setEditHumHigh(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>Humidity Low (%)</label>
                                <input type="number" step="1" value={editHumLow} onChange={e => setEditHumLow(e.target.value)} />
                            </div>
                        </div>

                        <h4 style={{ marginBottom: '0.5rem', marginTop: '1rem' }}>Vị trí không gian (Spatial)</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div className="form-group">
                                <label>X (m)</label>
                                <input type="number" step="0.1" placeholder="e.g. 1.5" value={editX} onChange={e => setEditX(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>Y (m)</label>
                                <input type="number" step="0.1" placeholder="e.g. 3.0" value={editY} onChange={e => setEditY(e.target.value)} />
                            </div>
                        </div>

                        <div className="form-group" style={{ marginTop: '1rem' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                <input type="checkbox" style={{ width: 'auto' }} checked={editEmailNotify} onChange={e => setEditEmailNotify(e.target.checked)} />
                                Send me Email Alerts for this device
                            </label>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                            <button type="button" className="btn btn-outline" onClick={() => setIsEditModalOpen(false)}>Cancel</button>
                            <button type="submit" className="btn btn-primary">Save Changes</button>
                        </div>
                    </form>
                </div>
            </div>
        </>
    );
}
