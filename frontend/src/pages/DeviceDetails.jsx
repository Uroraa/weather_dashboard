import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useConnection } from '../context/ConnectionContext';
import { io } from 'socket.io-client';
import { useSearchParams, Link } from 'react-router-dom';
import { Line } from 'react-chartjs-2';

const MAX_CHART_POINTS = 30;

export default function DeviceDetails() {
    const { isAuthenticated, apiFetch, token } = useAuth();
    const { markDeviceOnline, markDeviceOffline } = useConnection();
    const [searchParams] = useSearchParams();
    const deviceId = searchParams.get('id');

    const [device, setDevice] = useState(null);
    const [loading, setLoading] = useState('Loading...');

    const [temperature, setTemperature] = useState('--');
    const [humidity, setHumidity] = useState('--');

    const [activeTab, setActiveTab] = useState('chart');
    const [historyData, setHistoryData] = useState([]);
    const [allAlerts, setAllAlerts] = useState([]);

    // Live chart data — starts empty, fills from real-time socket only
    const [liveChartData, setLiveChartData] = useState({
        labels: Array(MAX_CHART_POINTS).fill(''),
        datasets: [
            { label: 'Temp', data: Array(MAX_CHART_POINTS).fill(null), borderColor: '#e53e3e', yAxisID: 'y', tension: 0.4 },
            { label: 'Hum', data: Array(MAX_CHART_POINTS).fill(null), borderColor: '#3182ce', yAxisID: 'y1', tension: 0.4 }
        ]
    });

    const [histPage, setHistPage] = useState(1);
    const [histPageSize, setHistPageSize] = useState(10);
    const [alertsPage, setAlertsPage] = useState(1);
    const [alertsPageSize, setAlertsPageSize] = useState(5);

    const socketRef = useRef(null);

    const loadDevice = async () => {
        try {
            const res = await apiFetch(`/api/devices/${deviceId}`);
            if (!res.ok) { setLoading('Device not found or access denied'); return; }
            const data = await res.json();
            setDevice(data);
            setLoading('');
            await loadReadings();
            await loadAlerts();
        } catch (e) {
            console.error(e);
        }
    };

    const loadReadings = async () => {
        try {
            const res = await apiFetch(`/api/devices/${deviceId}/readings?limit=100`);
            if (res.ok) {
                const data = await res.json();
                // History table gets all readings
                setHistoryData(data);

                // Set latest values for the metric cards
                if (data.length > 0) {
                    const latest = data[data.length - 1];
                    setTemperature(latest.temperature);
                    setHumidity(latest.humidity);
                }
            }
        } catch (e) { console.error(e); }
    };

    const loadAlerts = async () => {
        try {
            const res = await apiFetch(`/api/alerts/device/${deviceId}`);
            if (res.ok) {
                const data = await res.json();
                setAllAlerts(data);
            }
        } catch (e) {}
    };

    useEffect(() => {
        if (!deviceId || !isAuthenticated) {
            setLoading(isAuthenticated ? 'No Device ID provided' : 'Not Authenticated');
            return;
        }

        loadDevice();

        // Start as offline — socket events will set online immediately
        markDeviceOffline(deviceId);

        socketRef.current = io('/');
        socketRef.current.on('connect', () => {
            if (token) socketRef.current.emit('authenticate', token);
            socketRef.current.emit('subscribe_device', deviceId);
        });

        socketRef.current.on('disconnect', () => markDeviceOffline(deviceId));

        socketRef.current.on('new_reading', (r) => {
            if (r.device_id.toString() !== deviceId.toString()) return;

            // Immediately mark online
            markDeviceOnline(deviceId, r.source);

            setTemperature(r.temperature);
            setHumidity(r.humidity);

            // Add to history table
            setHistoryData(prev => {
                const newData = [...prev, r];
                if (newData.length > 100) newData.shift();
                return newData;
            });

            // Append to live chart from the right
            setLiveChartData(prev => {
                const labels = [...prev.labels];
                const temps = [...prev.datasets[0].data];
                const hums = [...prev.datasets[1].data];

                labels.shift(); temps.shift(); hums.shift();

                labels.push(new Date(r.timestamp || Date.now()).toLocaleTimeString());
                temps.push(r.temperature);
                hums.push(r.humidity);

                return {
                    ...prev,
                    labels,
                    datasets: [
                        { ...prev.datasets[0], data: temps },
                        { ...prev.datasets[1], data: hums }
                    ]
                };
            });
        });

        return () => {
            if (socketRef.current) socketRef.current.disconnect();
            markDeviceOffline(deviceId);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deviceId, isAuthenticated, token]);

    const exportCSV = () => {
        let csv = 'Timestamp,Temperature,Humidity\n';
        historyData.forEach(r => {
            csv += `${new Date(r.timestamp).toISOString()},${r.temperature},${r.humidity}\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `device_${deviceId}_data.csv`;
        a.click();
    };

    const chartOptions = {
        responsive: true, maintainAspectRatio: false,
        scales: {
            y: { type: 'linear', position: 'left', suggestedMin: 10, suggestedMax: 45 },
            y1: { type: 'linear', position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false } }
        }
    };

    const paginatedHistory = [...historyData].reverse().slice((histPage - 1) * histPageSize, histPage * histPageSize);
    const totalHistPages = Math.max(1, Math.ceil(historyData.length / histPageSize));

    const paginatedAlerts = allAlerts.slice((alertsPage - 1) * alertsPageSize, alertsPage * alertsPageSize);
    const totalAlertsPages = Math.max(1, Math.ceil(allAlerts.length / alertsPageSize));

    return (
        <>
            <div style={{ position: 'absolute', top: '15px', right: '120px', zIndex: 100 }}>
                <Link to="/devices" className="btn btn-outline" style={{ padding: '0.4rem 0.8rem', background: 'white' }}>
                    <i className="ph ph-arrow-left"></i> <span>Back</span>
                </Link>
            </div>

            {loading ? (
                <div id="loading" style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>{loading}</div>
            ) : (
                <div id="device-content" style={{ marginTop: '2rem' }}>
                    <div className="detail-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem' }}>
                        <div>
                            <h1 className="page-title" id="dev-name" style={{ margin: 0 }}>{device.name}</h1>
                            <div className="device-info" style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
                                <span id="dev-desc">{device.description || 'No description'}</span> •
                                Created: <span id="dev-created">{new Date(device.created_at).toLocaleDateString()}</span>
                            </div>
                        </div>
                    </div>

                    <div className="metrics-grid">
                        <div className="card metric-card">
                            <div className="card-header"><i className="ph ph-thermometer temp-icon"></i><span>Latest Temp</span></div>
                            <div className="metric-value-wrapper"><span className="metric-value" id="val-temp">{temperature}</span><span className="metric-unit">°C</span></div>
                        </div>
                        <div className="card metric-card">
                            <div className="card-header"><i className="ph ph-drop hum-icon"></i><span>Latest Humidity</span></div>
                            <div className="metric-value-wrapper"><span className="metric-value" id="val-hum">{humidity}</span><span className="metric-unit">%</span></div>
                        </div>
                    </div>

                    <div className="card" style={{ marginBottom: '2rem' }}>
                        <div className="tab-group" style={{ display: 'flex', borderBottom: '1px solid #edf2f7', marginBottom: '1.5rem', gap: '2rem' }}>
                            {['chart', 'history', 'alerts'].map(tab => (
                                <div
                                    key={tab}
                                    className={`tab ${activeTab === tab ? 'active' : ''}`}
                                    onClick={() => { setActiveTab(tab); if (tab === 'alerts') loadAlerts(); }}
                                    style={activeTab === tab
                                        ? { color: 'var(--primary-color)', borderBottom: '2px solid var(--primary-color)', fontWeight: 600, cursor: 'pointer', padding: '0.5rem 0' }
                                        : { color: 'var(--text-muted)', fontWeight: 600, cursor: 'pointer', borderBottom: '2px solid transparent', padding: '0.5rem 0' }
                                    }
                                >
                                    {tab === 'chart' ? 'Live Chart' : tab === 'history' ? 'History Table' : 'Alerts'}
                                </div>
                            ))}
                        </div>

                        {activeTab === 'chart' && (
                            <div className="chart-container">
                                <Line data={liveChartData} options={chartOptions} />
                            </div>
                        )}

                        {activeTab === 'history' && (
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                    <div>
                                        <label style={{ fontSize: '0.875rem' }}>Rows: </label>
                                        <select value={histPageSize} onChange={e => { setHistPageSize(Number(e.target.value)); setHistPage(1); }} style={{ padding: '0.25rem' }}>
                                            <option value="10">10</option>
                                            <option value="25">25</option>
                                            <option value="50">50</option>
                                        </select>
                                    </div>
                                    <button className="btn btn-outline" onClick={exportCSV}><i className="ph ph-download"></i> Export CSV</button>
                                </div>
                                <div className="table-wrapper">
                                    <table>
                                        <thead>
                                            <tr><th>Time</th><th>Temperature (°C)</th><th>Humidity (%)</th></tr>
                                        </thead>
                                        <tbody>
                                            {paginatedHistory.map((d, i) => (
                                                <tr key={i}>
                                                    <td>{new Date(d.timestamp).toLocaleString()}</td>
                                                    <td><span className="text-danger">{d.temperature}</span></td>
                                                    <td><span style={{ color: '#3182ce' }}>{d.humidity}</span></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
                                    <button className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.875rem' }} disabled={histPage <= 1} onClick={() => setHistPage(p => p - 1)}>Prev</button>
                                    <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Page {histPage} of {totalHistPages}</span>
                                    <button className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.875rem' }} disabled={histPage >= totalHistPages} onClick={() => setHistPage(p => p + 1)}>Next</button>
                                </div>
                            </div>
                        )}

                        {activeTab === 'alerts' && (
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                                    <div>
                                        <label style={{ fontSize: '0.875rem' }}>Rows: </label>
                                        <select value={alertsPageSize} onChange={e => { setAlertsPageSize(Number(e.target.value)); setAlertsPage(1); }} style={{ padding: '0.25rem' }}>
                                            <option value="5">5</option>
                                            <option value="10">10</option>
                                            <option value="15">15</option>
                                        </select>
                                    </div>
                                </div>
                                {allAlerts.length === 0 ? (
                                    <p style={{ color: 'var(--text-muted)', padding: '1rem' }}>No alerts for this device.</p>
                                ) : (
                                    paginatedAlerts.map((a, i) => (
                                        <div key={i} style={{ padding: '1rem', borderBottom: '1px solid #edf2f7', display: 'flex', justifyContent: 'space-between' }}>
                                            <div>
                                                <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{a.type.toUpperCase()}</div>
                                                <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{a.message}</div>
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: '#a0aec0' }}>{new Date(a.timestamp).toLocaleString()}</div>
                                        </div>
                                    ))
                                )}
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
                                    <button className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.875rem' }} disabled={alertsPage <= 1} onClick={() => setAlertsPage(p => p - 1)}>Prev</button>
                                    <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Page {alertsPage} of {totalAlertsPages}</span>
                                    <button className="btn btn-outline" style={{ padding: '0.2rem 0.5rem', fontSize: '0.875rem' }} disabled={alertsPage >= totalAlertsPages} onClick={() => setAlertsPage(p => p + 1)}>Next</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
