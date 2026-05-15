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
    const [pendingDevices, setPendingDevices] = useState([]);
    const [selectedMac, setSelectedMac] = useState('');
    
    const [editDevId, setEditDevId] = useState('');
    const [editTempHigh, setEditTempHigh] = useState('');
    const [editTempLow, setEditTempLow] = useState('');
    const [editHumHigh, setEditHumHigh] = useState('');
    const [editHumLow, setEditHumLow] = useState('');
    const [editEmailNotify, setEditEmailNotify] = useState(false);
    const [editX, setEditX] = useState('');
    const [editY, setEditY] = useState('');
    const [editLat, setEditLat] = useState('');
    const [editLng, setEditLng] = useState('');

    const [editRoomId, setEditRoomId] = useState('');
    const [rooms, setRooms] = useState([]);

    const getRoomBounds = (roomId) => {
        if (!roomId) return null;
        const room = rooms.find(r => r.id === parseInt(roomId));
        if (!room) return null;
        const lat_deg_per_m = 1 / 111320;
        const lng_deg_per_m = 1 / (111320 * Math.cos(room.center_lat * Math.PI / 180));
        const halfWidth = room.width_m / 2;
        const halfLength = room.length_m / 2;

        return {
            minLat: room.center_lat - halfLength * lat_deg_per_m,
            maxLat: room.center_lat + halfLength * lat_deg_per_m,
            minLng: room.center_lng - halfWidth * lng_deg_per_m,
            maxLng: room.center_lng + halfWidth * lng_deg_per_m,
            width: room.width_m,
            length: room.length_m
        };
    };

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
            
            // Also fetch rooms
            const roomsRes = await apiFetch('/api/rooms');
            if (roomsRes.ok) {
                setRooms(await roomsRes.json());
            }
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

    const openAddModal = async () => {
        setIsAddModalOpen(true);
        await refreshPending();
    };

    const refreshPending = async () => {
        try {
            const res = await apiFetch('/api/devices/pending');
            if (res.ok) setPendingDevices(await res.json());
        } catch (_) {}
    };

    const closeAddModal = () => {
        setIsAddModalOpen(false);
        setNewDevName('');
        setNewDevDesc('');
        setSelectedMac('');
        setPendingDevices([]);
    };

    const handleAddDevice = async (e) => {
        e.preventDefault();
        try {
            const body = { name: newDevName, description: newDevDesc };
            if (selectedMac) body.mac_address = selectedMac;
            const res = await apiFetch('/api/devices', {
                method: 'POST',
                body: JSON.stringify(body)
            });
            if (!res.ok) throw new Error("Failed to add device");
            closeAddModal();
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
                body: JSON.stringify({
                    ...payload,
                    lat: editLat !== '' ? parseFloat(editLat) : null,
                    lng: editLng !== '' ? parseFloat(editLng) : null,
                    room_id: editRoomId ? parseInt(editRoomId) : null,
                })
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
        setEditLat(d.lat ?? '');
        setEditLng(d.lng ?? '');
        setEditRoomId(d.room_id ?? '');
        setIsEditModalOpen(true);
    };

    const handleXChange = (val) => {
        setEditX(val);
        if (val === '') { setEditLng(''); return; }
        const bounds = getRoomBounds(editRoomId);
        if (!bounds) return;
        const x = parseFloat(val);
        const lng = bounds.minLng + (x / bounds.width) * (bounds.maxLng - bounds.minLng);
        setEditLng(lng.toFixed(10));
    };

    const handleYChange = (val) => {
        setEditY(val);
        if (val === '') { setEditLat(''); return; }
        const bounds = getRoomBounds(editRoomId);
        if (!bounds) return;
        const y = parseFloat(val);
        const lat = bounds.minLat + (y / bounds.length) * (bounds.maxLat - bounds.minLat);
        setEditLat(lat.toFixed(10));
    };

    const handleLatChange = (val) => {
        setEditLat(val);
        if (val === '') { setEditY(''); return; }
        const bounds = getRoomBounds(editRoomId);
        if (!bounds) return;
        const lat = parseFloat(val);
        const y = ((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * bounds.length;
        setEditY(y.toFixed(2));
    };

    const handleLngChange = (val) => {
        setEditLng(val);
        if (val === '') { setEditX(''); return; }
        const bounds = getRoomBounds(editRoomId);
        if (!bounds) return;
        const lng = parseFloat(val);
        const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * bounds.width;
        setEditX(x.toFixed(2));
    };

    const copyKey = (key) => {
        navigator.clipboard.writeText(key);
        alert("API Key copied to clipboard!");
    };

    return (
        <>
            <div style={{ position: 'absolute', top: '15px', right: '120px', zIndex: 100 }}>
                {isAuthenticated && (
                    <button className="btn btn-primary" onClick={openAddModal}>
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
                        <button className="close-btn" onClick={closeAddModal}><i className="ph ph-x"></i></button>
                    </div>
                    <form onSubmit={handleAddDevice}>
                        <div className="form-group">
                            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>Detected Devices <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(waiting for registration)</span></span>
                                <button type="button" onClick={refreshPending} style={{ background: 'none', border: '1px solid #cbd5e0', borderRadius: '0.375rem', padding: '0.15rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer', color: 'var(--text-muted)' }}>↻ Refresh</button>
                            </label>
                            {pendingDevices.length === 0 ? (
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>No devices detected yet. Make sure the ESP32 is powered on, then click Refresh.</p>
                            ) : (
                                <>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                                        {pendingDevices.map(p => (
                                            <div
                                                key={p.mac_address}
                                                onClick={() => setSelectedMac(selectedMac === p.mac_address ? '' : p.mac_address)}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                                                    padding: '0.5rem 0.75rem', borderRadius: '0.5rem', cursor: 'pointer',
                                                    border: `2px solid ${selectedMac === p.mac_address ? 'var(--primary-color)' : '#e2e8f0'}`,
                                                    background: selectedMac === p.mac_address ? '#ebf8ff' : '#f7fafc',
                                                }}
                                            >
                                                <i className="ph ph-cpu" style={{ fontSize: '1.25rem', color: selectedMac === p.mac_address ? 'var(--primary-color)' : '#718096' }}></i>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 600 }}>{p.mac_address}</div>
                                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.chip_model || 'ESP32'}{p.firmware_version ? ` · v${p.firmware_version}` : ''}</div>
                                                </div>
                                                {selectedMac === p.mac_address && <i className="ph ph-check-circle" style={{ color: 'var(--primary-color)', fontSize: '1.1rem' }}></i>}
                                            </div>
                                        ))}
                                    </div>
                                    {selectedMac
                                        ? <p style={{ fontSize: '0.75rem', color: '#38a169', marginTop: '0.5rem' }}><i className="ph ph-check"></i> Selected — device will configure automatically after creation.</p>
                                        : <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Select a device above to configure it automatically, or leave unselected.</p>
                                    }
                                </>
                            )}
                        </div>
                        <div className="form-group">
                            <label>Device Name</label>
                            <input type="text" required placeholder="e.g. Living Room Sensor" value={newDevName} onChange={e => setNewDevName(e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label>Description (Optional)</label>
                            <textarea rows="3" value={newDevDesc} onChange={e => setNewDevDesc(e.target.value)}></textarea>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                            <button type="button" className="btn btn-outline" onClick={closeAddModal}>Cancel</button>
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
                        
                        <h4 style={{ marginBottom: '0.5rem', marginTop: '1rem' }}>Room Assignment</h4>
                        <div className="form-group">
                            <label>Assigned Room</label>
                            <select value={editRoomId} onChange={e => setEditRoomId(e.target.value)}>
                                <option value="">-- No Room --</option>
                                {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                        </div>

                        <h4 style={{ marginBottom: '0.5rem', marginTop: '1rem' }}>Position (x / y)</h4>
                        {editRoomId ? (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div className="form-group">
                                    <label>X (m)</label>
                                    <input type="number" min="0" max={getRoomBounds(editRoomId)?.width} step="0.01" placeholder="e.g. 1.5" value={editX} onChange={e => handleXChange(e.target.value)} />
                                </div>
                                <div className="form-group">
                                    <label>Y (m)</label>
                                    <input type="number" min="0" max={getRoomBounds(editRoomId)?.length} step="0.01" placeholder="e.g. 3.0" value={editY} onChange={e => handleYChange(e.target.value)} />
                                </div>
                            </div>
                        ) : (
                            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Select a room first to enable local coordinates.</p>
                        )}

                        <h4 style={{ marginBottom: '0.5rem', marginTop: '1rem' }}>Geographic Coordinates (Lat/Lng)</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div className="form-group">
                                <label>Latitude</label>
                                <input type="number" step="0.0000000001" placeholder="e.g. 20.9076..." value={editLat} onChange={e => handleLatChange(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>Longitude</label>
                                <input type="number" step="0.0000000001" placeholder="e.g. 105.8533..." value={editLng} onChange={e => handleLngChange(e.target.value)} />
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
