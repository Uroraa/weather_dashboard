import React, { useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useConnection } from '../context/ConnectionContext';
import {
    Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

export default function Dashboard() {
    const { isAuthenticated } = useAuth();
    const {
        setActiveDeviceId,
        devices,
        selectedDevice,
        setSelectedDevice,
        devicesLoading,
        chartData,
        liveTemp,
        liveHumidity,
        liveUpdateKey,
    } = useConnection();

    const chartRef = useRef(null);

    // Sync topbar status indicator — only active while Dashboard is mounted
    useEffect(() => {
        setActiveDeviceId(selectedDevice || null);
        return () => setActiveDeviceId(null);
    }, [selectedDevice, setActiveDeviceId]);

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
                suggestedMin: 10, suggestedMax: 45,
                title: { display: true, text: 'Temperature (°C)', color: '#e53e3e' }
            },
            y1: {
                type: 'linear', display: true, position: 'right',
                min: 0, max: 100,
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
            <div className="device-select-wrapper" style={{ position: 'absolute', top: '90px', right: '35px', zIndex: 10 }}>
                <label htmlFor="device-selector" style={{ margin: 0, marginRight: '0.5rem' }}>
                    <i className="ph ph-funnel"></i> View Device:
                </label>
                <select
                    id="device-selector"
                    className="device-select"
                    value={selectedDevice}
                    onChange={e => setSelectedDevice(e.target.value)}
                    disabled={devices.length === 0}
                >
                    {devices.length === 0
                        ? <option value="">No devices found</option>
                        : devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)
                    }
                </select>
            </div>

            {selectedDevice ? (
                <div id="dashboard-content" style={{ marginTop: '2rem' }}>
                    <div className="metrics-grid">
                        <div className="card metric-card">
                            <div className="card-header">
                                <i className="ph ph-thermometer temp-icon"></i>
                                <span>Temperature</span>
                            </div>
                            <div className={`metric-value-wrapper ${liveUpdateKey % 2 === 0 ? 'value-update' : ''}`} key={`temp-${liveUpdateKey}`}>
                                <span className="metric-value">{liveTemp}</span>
                                <span className="metric-unit">°C</span>
                            </div>
                        </div>

                        <div className="card metric-card">
                            <div className="card-header">
                                <i className="ph ph-drop hum-icon"></i>
                                <span>Humidity</span>
                            </div>
                            <div className={`metric-value-wrapper ${liveUpdateKey % 2 === 0 ? 'value-update' : ''}`} key={`hum-${liveUpdateKey}`}>
                                <span className="metric-value">{liveHumidity}</span>
                                <span className="metric-unit">%</span>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header" style={{ marginBottom: '1rem' }}>
                            <i className="ph ph-chart-line-up"></i>
                            <span>Real-time Chart (Last 30 Readings)</span>
                        </div>
                        <div className="chart-container">
                            <Line data={chartData} options={chartOptions} ref={chartRef} />
                        </div>
                    </div>
                </div>
            ) : devicesLoading ? (
                <div id="no-device-msg" className="card" style={{ textAlign: 'center', padding: '4rem 2rem', marginTop: '2rem' }}>
                    <i className="ph ph-circle-notch" style={{ fontSize: '3rem', color: 'var(--primary-color)', marginBottom: '1rem' }}></i>
                    <p style={{ color: 'var(--text-muted)' }}>Loading devices...</p>
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
