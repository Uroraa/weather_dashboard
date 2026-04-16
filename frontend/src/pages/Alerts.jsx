import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Alerts() {
    const { isAuthenticated, apiFetch } = useAuth();
    const [allAlerts, setAllAlerts] = useState([]);
    const [loading, setLoading] = useState(true);
    
    // Pagination
    const [alertsPage, setAlertsPage] = useState(1);
    const [alertsPageSize, setAlertsPageSize] = useState(5);

    const loadAlerts = async () => {
        if (!isAuthenticated) {
            setLoading(false);
            return;
        }
        
        try {
            setLoading(true);
            const res = await apiFetch('/api/alerts');
            if (!res.ok) throw new Error();
            const data = await res.json();
            setAllAlerts(data);
        } catch (err) {
            console.error(err);
            setAllAlerts([]); // Indicates error or empty but we will just treat it as empty for now, or add error state
        } finally {
            setLoading(false);
        }
    };

    const acknowledgeAlert = async (id) => {
        try {
            const res = await apiFetch(`/api/alerts/${id}/acknowledge`, { method: 'PUT' });
            if(res.ok) loadAlerts();
        } catch(e) { console.error(e); }
    };

    useEffect(() => {
        loadAlerts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated]);

    const totalPages = Math.max(1, Math.ceil(allAlerts.length / alertsPageSize));
    const paginated = allAlerts.slice((alertsPage - 1) * alertsPageSize, alertsPage * alertsPageSize);

    if (!isAuthenticated) {
        return (
            <div id="unauth-msg" className="card" style={{ marginTop: '2rem' }}>
                <p className="text-danger"><i className="ph ph-warning-circle"></i> You must be logged in to view alerts.</p>
            </div>
        );
    }

    return (
        <div className="card" id="alerts-container" style={{ padding: 0, marginTop: '2rem' }}>
            <div style={{ padding: '1.5rem', borderBottom: '1px solid #edf2f7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}><i className="ph ph-warning-circle"></i> Recent Alerts</h3>
                <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                    <div id="alerts-pagination-top" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Rows:</label>
                        <select 
                            value={alertsPageSize}
                            onChange={(e) => { setAlertsPageSize(Number(e.target.value)); setAlertsPage(1); }}
                            style={{ padding: '0.25rem 1.5rem 0.25rem 0.5rem', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '0.875rem', background: 'white', cursor: 'pointer' }}
                        >
                            <option value="5">5</option>
                            <option value="10">10</option>
                            <option value="15">15</option>
                        </select>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginLeft: '0.5rem' }}>
                            <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.875rem' }} disabled={alertsPage <= 1} onClick={() => setAlertsPage(p => p - 1)}>Prev</button>
                            <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', padding: '0 0.25rem', whiteSpace: 'nowrap' }}>{alertsPage} / {totalPages}</span>
                            <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.875rem' }} disabled={alertsPage >= totalPages} onClick={() => setAlertsPage(p => p + 1)}>Next</button>
                        </div>
                    </div>
                    <button className="btn btn-outline" onClick={loadAlerts}><i className="ph ph-arrows-clockwise"></i> Refresh</button>
                </div>
            </div>
            
            <div id="alerts-list">
                {loading ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#a0aec0' }}>Loading...</div>
                ) : allAlerts.length === 0 ? (
                    <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
                        <i className="ph ph-check-circle" style={{ fontSize: '4rem', color: 'var(--success-color)', marginBottom: '1rem' }}></i>
                        <h3>All Clear</h3>
                        <p style={{ color: 'var(--text-muted)' }}>There are no recent alerts for your devices.</p>
                    </div>
                ) : (
                    paginated.map(a => {
                        const isAck = !!a.acknowledged_at;
                        const date = new Date(a.timestamp).toLocaleString();
                        
                        return (
                            <div className="alert-item" key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', padding: '1.25rem', borderBottom: '1px solid #edf2f7' }}>
                                <i className="ph ph-warning alert-icon" style={{ fontSize: '2rem', padding: '0.5rem', borderRadius: '50%', color: isAck ? '#a0aec0' : 'var(--danger-color)', background: isAck ? '#edf2f7' : 'rgba(229, 62, 62, 0.1)' }}></i>
                                <div className="alert-content" style={{ flex: 1 }}>
                                    <div className="alert-title" style={{ fontWeight: 700, marginBottom: '0.25rem', color: 'var(--text-main)' }}>
                                        {a.device_name} 
                                        {isAck ? 
                                            <span className="badge" style={{ padding: '0.2rem 0.5rem', borderRadius: '1rem', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', background: '#e6fffa', color: '#2c7a7b', marginLeft: '0.5rem' }}>Acknowledged</span> : 
                                            <span className="badge" style={{ padding: '0.2rem 0.5rem', borderRadius: '1rem', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', background: '#fed7d7', color: '#c53030', marginLeft: '0.5rem' }}>New</span>
                                        }
                                    </div>
                                    <div className="alert-desc" style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>{a.message}</div>
                                    <div className="alert-meta" style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: '#a0aec0' }}>
                                        <span><i className="ph ph-clock"></i> {date}</span>
                                        <span>Type: {a.type}</span>
                                        {isAck && <span><i className="ph ph-check"></i> {new Date(a.acknowledged_at).toLocaleString()}</span>}
                                    </div>
                                </div>
                                <div>
                                    {!isAck && (
                                        <button className="btn btn-outline" style={{ padding: '0.3rem 0.8rem', fontSize: '0.875rem' }} onClick={() => acknowledgeAlert(a.id)}>Acknowledge</button>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
