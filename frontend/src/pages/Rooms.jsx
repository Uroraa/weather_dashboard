import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Rooms() {
    const { isAuthenticated, apiFetch } = useAuth();
    const [rooms, setRooms] = useState([]);
    
    // Modals state
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    // Form states
    const [newName, setNewName] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [newLat, setNewLat] = useState('');
    const [newLng, setNewLng] = useState('');
    const [newWidth, setNewWidth] = useState('7');
    const [newLength, setNewLength] = useState('7');
    
    const [editId, setEditId] = useState('');
    const [editName, setEditName] = useState('');
    const [editDesc, setEditDesc] = useState('');
    const [editLat, setEditLat] = useState('');
    const [editLng, setEditLng] = useState('');
    const [editWidth, setEditWidth] = useState('');
    const [editLength, setEditLength] = useState('');

    const loadRooms = async () => {
        if (!isAuthenticated) return;
        try {
            const res = await apiFetch('/api/rooms');
            if (!res.ok) throw new Error();
            setRooms(await res.json());
        } catch (err) {
            console.error(err);
        }
    };

    useEffect(() => {
        loadRooms();
    }, [isAuthenticated]);

    const closeAddModal = () => {
        setIsAddModalOpen(false);
        setNewName('');
        setNewDesc('');
        setNewLat('');
        setNewLng('');
        setNewWidth('7');
        setNewLength('7');
    };

    const handleAddRoom = async (e) => {
        e.preventDefault();
        try {
            const body = { 
                name: newName, 
                description: newDesc,
                center_lat: parseFloat(newLat),
                center_lng: parseFloat(newLng),
                width_m: parseFloat(newWidth),
                length_m: parseFloat(newLength)
            };
            const res = await apiFetch('/api/rooms', {
                method: 'POST',
                body: JSON.stringify(body)
            });
            if (!res.ok) throw new Error("Failed to create room");
            closeAddModal();
            loadRooms();
        } catch(err) {
            alert(err.message);
        }
    };

    const openEditModal = (r) => {
        setEditId(r.id);
        setEditName(r.name);
        setEditDesc(r.description || '');
        setEditLat(r.center_lat);
        setEditLng(r.center_lng);
        setEditWidth(r.width_m);
        setEditLength(r.length_m);
        setIsEditModalOpen(true);
    };

    const handleEditRoom = async (e) => {
        e.preventDefault();
        try {
            const body = { 
                name: editName, 
                description: editDesc,
                center_lat: parseFloat(editLat),
                center_lng: parseFloat(editLng),
                width_m: parseFloat(editWidth),
                length_m: parseFloat(editLength)
            };
            const res = await apiFetch(`/api/rooms/${editId}`, {
                method: 'PUT',
                body: JSON.stringify(body)
            });
            if(!res.ok) throw new Error("Update failed");
            setIsEditModalOpen(false);
            loadRooms();
        } catch(err) { alert(err.message); }
    };

    const deleteRoom = async (id) => {
        if(!window.confirm("Are you sure you want to delete this room? Devices assigned to it will be unassigned.")) return;
        try {
            const res = await apiFetch(`/api/rooms/${id}`, { method: 'DELETE' });
            if(!res.ok) throw new Error("Delete failed");
            loadRooms();
        } catch(err) { alert(err.message); }
    };

    return (
        <>
            <div style={{ position: 'absolute', top: '15px', right: '120px', zIndex: 100 }}>
                {isAuthenticated && (
                    <button className="btn btn-primary" onClick={() => setIsAddModalOpen(true)}>
                        <i className="ph ph-plus"></i> Create Room
                    </button>
                )}
            </div>

            {!isAuthenticated ? (
                <div id="unauth-msg" className="card" style={{ marginTop: '2rem' }}>
                    <p className="text-danger"><i className="ph ph-warning-circle"></i> You must be logged in to manage rooms.</p>
                </div>
            ) : (
                <div id="rooms-grid" className="metrics-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', marginTop: '2rem' }}>
                    {rooms.map(r => (
                        <div className="card" key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <span style={{ fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <i className="ph ph-house"></i> {r.name}
                                </span>
                            </div>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{r.description || 'No description'}</p>
                            
                            <div style={{ background: '#f7fafc', border: '1px dashed #cbd5e0', padding: '0.75rem', borderRadius: '0.5rem', fontSize: '0.875rem', marginTop: '0.5rem' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                    <div><strong style={{ color: 'var(--text-muted)' }}>Center Lat:</strong> {r.center_lat}</div>
                                    <div><strong style={{ color: 'var(--text-muted)' }}>Center Lng:</strong> {r.center_lng}</div>
                                    <div style={{ gridColumn: 'span 2' }}><strong style={{ color: 'var(--text-muted)' }}>Size:</strong> {r.width_m}m (W) x {r.length_m}m (L)</div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto', borderTop: '1px solid #edf2f7', paddingTop: '1rem' }}>
                                <button className="btn btn-outline" style={{ flex: 1, padding: '0.4rem' }} onClick={() => openEditModal(r)}><i className="ph ph-pencil-simple"></i> Edit</button>
                                <button className="btn btn-danger" style={{ padding: '0.4rem' }} onClick={() => deleteRoom(r.id)} title="Delete Room"><i className="ph ph-trash"></i></button>
                            </div>
                        </div>
                    ))}
                    {rooms.length === 0 && (
                        <div className="card" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '3rem' }}>
                            <i className="ph ph-house" style={{ fontSize: '3rem', color: '#cbd5e0', marginBottom: '1rem' }}></i>
                            <h3 style={{ color: '#4a5568' }}>No Rooms Configured</h3>
                            <p style={{ color: '#718096', marginTop: '0.5rem' }}>Create a room to assign sensors and generate spatial forecasts.</p>
                        </div>
                    )}
                </div>
            )}

            {/* Add Room Modal */}
            <div className={`modal-overlay ${isAddModalOpen ? 'active' : ''}`}>
                <div className="modal-content">
                    <div className="modal-header">
                        <h3>Create New Room</h3>
                        <button className="close-btn" onClick={closeAddModal}><i className="ph ph-x"></i></button>
                    </div>
                    <form onSubmit={handleAddRoom}>
                        <div className="form-group">
                            <label>Room Name</label>
                            <input type="text" required placeholder="e.g. Server Room A" value={newName} onChange={e => setNewName(e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label>Description (Optional)</label>
                            <textarea rows="2" value={newDesc} onChange={e => setNewDesc(e.target.value)}></textarea>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div className="form-group">
                                <label>Center Latitude</label>
                                <input type="number" step="0.0000000001" required placeholder="e.g. 20.9076..." value={newLat} onChange={e => setNewLat(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>Center Longitude</label>
                                <input type="number" step="0.0000000001" required placeholder="e.g. 105.8533..." value={newLng} onChange={e => setNewLng(e.target.value)} />
                            </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div className="form-group">
                                <label>Width (X-axis, meters)</label>
                                <input type="number" step="0.5" min="1" required placeholder="e.g. 7" value={newWidth} onChange={e => setNewWidth(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>Length (Y-axis, meters)</label>
                                <input type="number" step="0.5" min="1" required placeholder="e.g. 7" value={newLength} onChange={e => setNewLength(e.target.value)} />
                            </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                            <button type="button" className="btn btn-outline" onClick={closeAddModal}>Cancel</button>
                            <button type="submit" className="btn btn-primary">Create Room</button>
                        </div>
                    </form>
                </div>
            </div>

            {/* Edit Room Modal */}
            <div className={`modal-overlay ${isEditModalOpen ? 'active' : ''}`}>
                <div className="modal-content">
                    <div className="modal-header">
                        <h3>Edit Room</h3>
                        <button className="close-btn" onClick={() => setIsEditModalOpen(false)}><i className="ph ph-x"></i></button>
                    </div>
                    <form onSubmit={handleEditRoom}>
                        <div className="form-group">
                            <label>Room Name</label>
                            <input type="text" required value={editName} onChange={e => setEditName(e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label>Description</label>
                            <textarea rows="2" value={editDesc} onChange={e => setEditDesc(e.target.value)}></textarea>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div className="form-group">
                                <label>Center Latitude</label>
                                <input type="number" step="0.0000000001" required value={editLat} onChange={e => setEditLat(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>Center Longitude</label>
                                <input type="number" step="0.0000000001" required value={editLng} onChange={e => setEditLng(e.target.value)} />
                            </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div className="form-group">
                                <label>Width (X-axis, meters)</label>
                                <input type="number" step="0.5" min="1" required value={editWidth} onChange={e => setEditWidth(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>Length (Y-axis, meters)</label>
                                <input type="number" step="0.5" min="1" required value={editLength} onChange={e => setEditLength(e.target.value)} />
                            </div>
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
