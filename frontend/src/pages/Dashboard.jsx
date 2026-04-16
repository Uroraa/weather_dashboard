import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { io } from 'socket.io-client';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const MAX_DATA_POINTS = 30;

export default function Dashboard() {
    const { isAuthenticated, user, apiFetch } = useAuth();
    const [devices, setDevices] = useState([]);
    const [selectedDevice, setSelectedDevice] = useState('');
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState('disconnected'); // online, offline, disconnected
    const [temperature, setTemperature] = useState('--');
    const [humidity, setHumidity] = useState('--');
    const [updateKey, setUpdateKey] = useState(0); // For animation retriggers
    
    const [chartData, setChartData] = useState({
        labels: Array(MAX_DATA_POINTS).fill(''),
        datasets: [
            {
                label: 'Temperature (°C)',
                data: Array(MAX_DATA_POINTS).fill(null),
                borderColor: '#e53e3e',
                backgroundColor: 'rgba(229, 62, 62, 0.1)',
                borderWidth: 3,
                pointRadius: 0,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.4,
                yAxisID: 'y'
            },
            {
                label: 'Humidity (%)',
                data: Array(MAX_DATA_POINTS).fill(null),
                borderColor: '#3182ce',
                backgroundColor: 'rgba(49, 130, 206, 0.1)',
                borderWidth: 3,
                pointRadius: 0,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.4,
                yAxisID: 'y1'
            }
        ]
    });

    const socketRef = useRef(null);
    const offlineTimerRef = useRef(null);
    const chartRef = useRef(null);

    const setOfflineTimer = () => {
        if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = setTimeout(() => {
            setStatus('offline');
        }, 60000);
    };

    const updateChartData = (dataPoints) => {
        const labels = [];
        const temps = [];
        const hums = [];

        const padCount = MAX_DATA_POINTS - dataPoints.length;
        for (let i = 0; i < padCount; i++) {
            labels.push(''); temps.push(null); hums.push(null);
        }

        dataPoints.forEach(d => {
            labels.push(new Date(d.timestamp).toLocaleTimeString());
            temps.push(d.temperature);
            hums.push(d.humidity);
        });

        setChartData(prev => ({
            ...prev,
            labels,
            datasets: [
                { ...prev.datasets[0], data: temps },
                { ...prev.datasets[1], data: hums }
            ]
        }));
    };

    useEffect(() => {
        const fetchDevices = async () => {
            if (!isAuthenticated) {
                setLoading(false);
                return;
            }
            try {
                const res = await apiFetch('/api/devices');
                if (!res.ok) throw new Error();
                const data = await res.json();
                setDevices(data);
                if (data.length > 0) {
                    setSelectedDevice(data[0].id.toString());
                }
            } catch (e) {
                setDevices([]);
            } finally {
                setLoading(false);
            }
        };
        fetchDevices();
    }, [isAuthenticated]);

    useEffect(() => {
        if (!selectedDevice) return;

        const fetchData = async () => {
            try {
                const res = await apiFetch(`/api/devices/${selectedDevice}/readings?limit=${MAX_DATA_POINTS}`);
                if (!res.ok) throw new Error();
                const data = await res.json();
                
                if (data.length > 0) {
                    const latest = data[data.length - 1];
                    setTemperature(Number(latest.temperature).toFixed(1));
                    setHumidity(Math.round(Number(latest.humidity)).toString());
                    setUpdateKey(prev => prev + 1);

                    if (Date.now() - new Date(latest.timestamp).getTime() < 60000) {
                        setStatus('online');
                        setOfflineTimer();
                    } else {
                        setStatus('offline');
                    }
                } else {
                    setTemperature('--');
                    setHumidity('--');
                }
                
                updateChartData(data);
            } catch (e) {
                console.error(e);
            }
        };

        fetchData();

        // Setup Socket
        socketRef.current = io('/');
        socketRef.current.on('connect', () => {
            setStatus('online');
            const token = localStorage.getItem('accessToken');
            if (token) socketRef.current.emit('authenticate', token);
            socketRef.current.emit('subscribe_device', selectedDevice);
        });

        socketRef.current.on('disconnect', () => setStatus('disconnected'));

        socketRef.current.on('new_reading', (reading) => {
            if (reading.device_id.toString() !== selectedDevice.toString()) return;
            
            setStatus('online');
            setOfflineTimer();

            setTemperature(Number(reading.temperature).toFixed(1));
            setHumidity(Math.round(Number(reading.humidity)).toString());
            setUpdateKey(prev => prev + 1);

            setChartData(prev => {
                const labels = [...prev.labels];
                const temps = [...prev.datasets[0].data];
                const hums = [...prev.datasets[1].data];

                labels.shift();
                temps.shift();
                hums.shift();

                labels.push(new Date(reading.timestamp || Date.now()).toLocaleTimeString());
                temps.push(reading.temperature);
                hums.push(reading.humidity);

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

        socketRef.current.on('new_alert', (alertObj) => {
            console.warn('Realtime alert received:', alertObj);
        });

        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
            if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
        };
    }, [selectedDevice]);

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: {
                position: 'top',
                labels: { usePointStyle: true, font: { family: "'Inter', sans-serif", weight: '500' } }
            },
            tooltip: {
                backgroundColor: 'rgba(26, 32, 44, 0.9)',
                titleFont: { family: "'Inter', sans-serif" },
                bodyFont: { family: "'Inter', sans-serif" },
                padding: 12,
                cornerRadius: 8,
            }
        },
        scales: {
            x: { display: false, grid: { display: false } },
            y: {
                type: 'linear', display: true, position: 'left',
                title: { display: true, text: 'Temperature (°C)', color: '#e53e3e' }
            },
            y1: {
                type: 'linear', display: true, position: 'right',
                title: { display: true, text: 'Humidity (%)', color: '#3182ce' },
                grid: { drawOnChartArea: false }
            }
        },
        animation: { duration: 400, easing: 'easeOutQuart' }
    };

    if (!isAuthenticated) {
        return (
            <div id="no-device-msg" className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
                <i className="ph ph-warning-circle" style={{ fontSize: '4rem', color: 'var(--danger-color)', marginBottom: '1rem' }}></i>
                <h2 style={{ marginBottom: '0.5rem' }}>Please log in</h2>
                <p style={{ color: 'var(--text-muted)' }}>You need to be logged in to view dashboard data.</p>
            </div>
        );
    }

    return (
        <>
            <div style={{ display: 'none' /* We move the topbar status logic here conceptually, or use a portal to inject into Layout. For simplicity, we just keep the dashboard logic. To have exactly the same UI, global status is usually topbar. Since we are in React, we might want to hoist status or just show it locally if it's too complex to portal right now. Wait, I will use a React Portal to the header or use context later. Let's just render the dashboard content. */ }}></div>
            
            <div className="device-select-wrapper" style={{ position: 'absolute', top: '90px', right: '35px', zIndex: 10 }}>
                {/* Notice: we had device-select in page-header which is inside Layout now. We will just render it floated here or we could move it to Layout. Using absolute position for quick UI match is fine, or we can just render the page-header in Dashboard instead. Let's render the header inside Dashboard in refactoring! Wait, Layout renders the page header. Let's modify Layout to accept children for header slot next time. For now, absolute to top right of content area. */}
                <label htmlFor="device-selector" style={{ margin: 0, marginRight: '0.5rem' }}><i className="ph ph-funnel"></i> View Device:</label>
                <select 
                    id="device-selector" 
                    className="device-select" 
                    value={selectedDevice} 
                    onChange={e => setSelectedDevice(e.target.value)}
                    disabled={devices.length === 0}
                >
                    {devices.length === 0 ? <option value="">No devices found</option> : 
                        devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)
                    }
                </select>
                <span className={`status-dot ${status === 'online' ? 'live' : ''}`} style={{ backgroundColor: status === 'offline' ? '#a0aec0' : (status === 'disconnected' ? 'gray' : ''), marginLeft: '1rem' }}></span>
                <span style={{ fontSize: '0.875rem', marginLeft: '0.5rem', color: 'var(--text-muted)' }}>
                    {status === 'online' ? 'Live connected' : (status === 'offline' ? 'Offline' : 'Disconnected')}
                </span>
            </div>

            {selectedDevice ? (
                <div id="dashboard-content" style={{ marginTop: '2rem' }}>
                    <div className="metrics-grid">
                        <div className="card metric-card">
                            <div className="card-header">
                                <i className="ph ph-thermometer temp-icon"></i>
                                <span>Temperature</span>
                            </div>
                            <div className={`metric-value-wrapper ${updateKey % 2 === 0 ? 'value-update' : ''}`} key={`temp-${updateKey}`}>
                                <span className="metric-value">{temperature}</span>
                                <span className="metric-unit">°C</span>
                            </div>
                        </div>

                        <div className="card metric-card">
                            <div className="card-header">
                                <i className="ph ph-drop hum-icon"></i>
                                <span>Humidity</span>
                            </div>
                            <div className={`metric-value-wrapper ${updateKey % 2 === 0 ? 'value-update' : ''}`} key={`hum-${updateKey}`}>
                                <span className="metric-value">{humidity}</span>
                                <span className="metric-unit">%</span>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header" style={{ marginBottom: '1rem' }}>
                            <i className="ph ph-chart-line-up"></i>
                            <span>Real-time History (Last 30 Readings)</span>
                        </div>
                        <div className="chart-container">
                            <Line data={chartData} options={chartOptions} ref={chartRef} />
                        </div>
                    </div>
                </div>
            ) : (
                <div id="no-device-msg" className="card" style={{ textAlign: 'center', padding: '4rem 2rem', marginTop: '2rem' }}>
                    <i className="ph ph-plugs" style={{ fontSize: '4rem', color: 'var(--text-muted)', marginBottom: '1rem' }}></i>
                    <h2 style={{ marginBottom: '0.5rem' }}>No Devices Configured</h2>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>There are no active devices broadcasting data right now.</p>
                </div>
            )}
        </>
    );
}
