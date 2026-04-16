import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Admin() {
    const { isAuthenticated, user, apiFetch } = useAuth();

    const [allUsers, setAllUsers] = useState([]);
    const [allDevices, setAllDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    
    // Pagination for users
    const [usersPage, setUsersPage] = useState(1);
    const [usersPageSize, setUsersPageSize] = useState(5);

    const loadAdminData = async () => {
        if (!isAuthenticated || user?.role !== 'admin') {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const [usersRes, devRes] = await Promise.all([
                apiFetch('/api/users'),
                apiFetch('/api/devices')
            ]);

            if (usersRes.ok) {
                const usersData = await usersRes.json();
                setAllUsers(usersData);
            }
            if (devRes.ok) {
                const devsData = await devRes.json();
                const sorted = devsData.sort((a,b) => a.id - b.id);
                setAllDevices(sorted);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAdminData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, user]);

    const toggleRole = async (id, currentRole) => {
        const newRole = currentRole === 'admin' ? 'user' : 'admin';
        if(!window.confirm(`Change role to ${newRole}?`)) return;
        try {
            await apiFetch(`/api/users/${id}/role`, { method: 'PUT', body: JSON.stringify({role: newRole}) });
            loadAdminData();
        } catch(e){}
    };

    const deleteUser = async (id) => {
        if(!window.confirm("Are you sure? This will delete the user and ALL their devices/data permanently.")) return;
        try {
            await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
            loadAdminData();
        } catch(e){}
    };

    const deleteDev = async (id) => {
        if(!window.confirm("Delete this device for its owner?")) return;
        try {
            await apiFetch(`/api/devices/${id}`, { method: 'DELETE' });
            loadAdminData();
        } catch(e){}
    };

    if (!isAuthenticated || user?.role !== 'admin') {
        return (
            <div id="unauth-msg" className="card" style={{ marginTop: '2rem' }}>
                <p className="text-danger"><i className="ph ph-warning-circle"></i> Access Denied. Admin privileges required.</p>
            </div>
        );
    }

    const startIdx = (usersPage - 1) * usersPageSize;
    const paginatedUsers = allUsers.slice(startIdx, startIdx + usersPageSize);
    const totalPages = Math.max(1, Math.ceil(allUsers.length / usersPageSize));

    return (
        <div id="admin-content" style={{ marginTop: '2rem' }}>
            {loading ? <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Loading Admin Data...</div> : (
                <>
                    <div className="card" style={{ marginBottom: '2rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3 style={{ margin: 0 }}><i className="ph ph-users"></i> User Management</h3>
                            <div>
                                <label style={{ fontSize: '0.875rem', marginRight: '0.5rem' }}>Rows:</label>
                                <select 
                                    value={usersPageSize} 
                                    onChange={e => { setUsersPageSize(Number(e.target.value)); setUsersPage(1); }} 
                                    style={{ padding: '0.25rem', borderRadius: '4px', border: '1px solid #e2e8f0' }}
                                >
                                    <option value="5">5</option>
                                    <option value="10">10</option>
                                    <option value="15">15</option>
                                </select>
                            </div>
                        </div>
                        <div className="table-wrapper">
                            <table>
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Name</th>
                                        <th>Email</th>
                                        <th>Role</th>
                                        <th>Created</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedUsers.map(u => (
                                        <tr key={u.id}>
                                            <td>{u.id}</td>
                                            <td>{u.name}</td>
                                            <td>{u.email}</td>
                                            <td><span className="badge" style={{ padding: '0.2rem 0.5rem', borderRadius: '1rem', fontSize: '0.75rem', fontWeight: 600, background: u.role === 'admin' ? '#fed7d7' : '#edf2f7', color: u.role === 'admin' ? '#c53030' : '#4a5568' }}>{u.role}</span></td>
                                            <td>{new Date(u.created_at).toLocaleDateString()}</td>
                                            <td>
                                                <button 
                                                    className="btn btn-outline" 
                                                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', borderColor: '#e2e8f0', opacity: u.role === 'admin' ? 0.3 : 1, cursor: u.role === 'admin' ? 'not-allowed' : 'pointer', marginRight: '0.5rem' }} 
                                                    disabled={u.role === 'admin'} 
                                                    title={u.role === 'admin' ? 'Cannot change admin role' : ''}
                                                    onClick={() => toggleRole(u.id, u.role)}
                                                >
                                                    Toggle Role
                                                </button>
                                                <button className="btn btn-danger" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => deleteUser(u.id)}><i className="ph ph-trash"></i></button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
                            <button className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.875rem' }} disabled={usersPage <= 1} onClick={() => setUsersPage(p => p - 1)}>Prev</button>
                            <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Page {usersPage} of {totalPages}</span>
                            <button className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.875rem' }} disabled={usersPage >= totalPages} onClick={() => setUsersPage(p => p + 1)}>Next</button>
                        </div>
                    </div>

                    <div className="card">
                        <h3 style={{ marginBottom: '1rem' }}><i className="ph ph-devices"></i> All System Devices</h3>
                        <div className="table-wrapper">
                            <table>
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Device Name</th>
                                        <th>Owner</th>
                                        <th>API Key</th>
                                        <th>Created</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {allDevices.map(d => (
                                        <tr key={d.id}>
                                            <td>{d.id}</td>
                                            <td>{d.name}</td>
                                            <td>{d.owner_name}</td>
                                            <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{d.api_key.substring(0,8)}...</td>
                                            <td>{new Date(d.created_at).toLocaleDateString()}</td>
                                            <td>
                                                <button className="btn btn-danger" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => deleteDev(d.id)}><i className="ph ph-trash"></i></button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
