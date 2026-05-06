import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useConnection } from '../context/ConnectionContext';
import { io } from 'socket.io-client';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const MIN_WINDOW = 24;

const nowLinePlugin = {
  id: 'nowLine',
  afterDraw(chart) {
    const nowIndex = chart.data.labels.indexOf('Now');
    if (nowIndex < 0) return;
    const x = chart.scales.x.getPixelForValue(nowIndex);
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.strokeStyle = '#718096';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.fillStyle = '#718096';
    ctx.font = "11px Inter, sans-serif";
    ctx.fillText('Now', x + 5, top + 16);
    ctx.restore();
  }
};

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
      backgroundColor: 'rgba(26,32,44,0.9)',
      titleFont: { family: "'Inter', sans-serif" },
      bodyFont: { family: "'Inter', sans-serif" },
      padding: 12,
      cornerRadius: 8,
      filter: item => item.raw !== null
    }
  },
  scales: {
    x: {
      display: true,
      grid: { display: false },
      ticks: {
        maxTicksLimit: 10,
        maxRotation: 0,
        font: { family: "'Inter', sans-serif", size: 11 },
        color: '#718096'
      }
    },
    y: {
      type: 'linear', display: true, position: 'left',
      title: { display: true, text: 'Temperature (°C)', color: '#e53e3e', font: { family: "'Inter', sans-serif" } },
      grid: { color: 'rgba(0,0,0,0.05)' }
    },
    y1: {
      type: 'linear', display: true, position: 'right',
      title: { display: true, text: 'Humidity (%)', color: '#3182ce', font: { family: "'Inter', sans-serif" } },
      grid: { drawOnChartArea: false }
    }
  },
  animation: { duration: 400, easing: 'easeOutQuart' }
};

export default function Forecast() {
  const { isAuthenticated, apiFetch } = useAuth();
  const { markDeviceOnline, markDeviceOffline, setActiveDeviceId } = useConnection();
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [horizon, setHorizon] = useState('6min');
  const [loading, setLoading] = useState(true);
  const [fetchingForecast, setFetchingForecast] = useState(false);
  const [insufficientData, setInsufficientData] = useState(false);
  const [error, setError] = useState(null);
  const [chartData, setChartData] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated) { setLoading(false); return; }
    apiFetch('/api/devices')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        setDevices(data);
        if (data.length > 0) setSelectedDevice(data[0].id.toString());
      })
      .catch(() => setDevices([]))
      .finally(() => setLoading(false));
  }, [isAuthenticated]);

  // Sync activeDeviceId for the topbar status indicator
  useEffect(() => {
    setActiveDeviceId(selectedDevice || null);
    return () => setActiveDeviceId(null);
  }, [selectedDevice, setActiveDeviceId]);

  // Socket connection for real-time status on Forecast page
  useEffect(() => {
    if (!selectedDevice || !isAuthenticated) return;

    socketRef.current = io('/');

    socketRef.current.on('connect', () => {
      const token = localStorage.getItem('accessToken');
      if (token) socketRef.current.emit('authenticate', token);
      socketRef.current.emit('subscribe_device', selectedDevice);
    });

    socketRef.current.on('disconnect', () => markDeviceOffline(selectedDevice));

    socketRef.current.on('new_reading', (reading) => {
      if (reading.device_id.toString() !== selectedDevice.toString()) return;
      markDeviceOnline(selectedDevice, reading.source);
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
      markDeviceOffline(selectedDevice);
    };
  }, [selectedDevice, isAuthenticated]);

  // Fetch historical readings, check window, then fetch forecast
  useEffect(() => {
    if (!selectedDevice) return;
    setFetchingForecast(true);
    setError(null);
    setChartData(null);
    setInsufficientData(false);

    const deviceInfo = devices.find(d => d.id.toString() === selectedDevice);
    if (deviceInfo && deviceInfo.last_reading) {
      const elapsed = Date.now() - new Date(deviceInfo.last_reading).getTime();
      if (elapsed < 10000) {
        markDeviceOnline(selectedDevice, 'sensor');
      } else {
        markDeviceOffline(selectedDevice);
      }
    } else {
      markDeviceOffline(selectedDevice);
    }

    apiFetch(`/api/devices/${selectedDevice}/readings?limit=30`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load readings')))
      .then(readings => {
        if (readings.length < MIN_WINDOW) {
          setInsufficientData(true);
          return;
        }

        return apiFetch(`/api/forecast?device_id=${selectedDevice}&horizon=${horizon}`)
          .then(r => r.ok ? r.json() : Promise.reject(new Error('Forecast service unavailable')))
          .then(forecastRes => {
            const forecast = forecastRes.forecast || [];
            const nullArr = n => Array(n).fill(null);
            const lastTemp = readings[readings.length - 1].temperature;
            const lastHum  = readings[readings.length - 1].humidity;

            setChartData({
              labels: [
                ...readings.map(r => new Date(r.timestamp).toLocaleTimeString()),
                'Now',
                ...forecast.map(f => new Date(f.timestamp).toLocaleTimeString())
              ],
              datasets: [
                {
                  label: 'Temperature — History (°C)',
                  data: [...readings.map(r => r.temperature), lastTemp, ...nullArr(forecast.length)],
                  borderColor: '#e53e3e',
                  backgroundColor: 'rgba(229,62,62,0.08)',
                  borderWidth: 2,
                  pointRadius: 2,
                  pointHoverRadius: 5,
                  fill: true,
                  tension: 0.4,
                  spanGaps: false,
                  yAxisID: 'y'
                },
                {
                  label: 'Humidity — History (%)',
                  data: [...readings.map(r => r.humidity), lastHum, ...nullArr(forecast.length)],
                  borderColor: '#3182ce',
                  backgroundColor: 'rgba(49,130,206,0.08)',
                  borderWidth: 2,
                  pointRadius: 2,
                  pointHoverRadius: 5,
                  fill: true,
                  tension: 0.4,
                  spanGaps: false,
                  yAxisID: 'y1'
                },
                {
                  label: 'Temperature — Forecast (°C)',
                  data: [...nullArr(readings.length), lastTemp, ...forecast.map(f => f.temperature)],
                  borderColor: 'rgba(229,62,62,0.75)',
                  backgroundColor: 'rgba(229,62,62,0.04)',
                  borderWidth: 2,
                  borderDash: [6, 4],
                  pointRadius: 3,
                  pointHoverRadius: 5,
                  fill: true,
                  tension: 0.4,
                  spanGaps: false,
                  yAxisID: 'y'
                },
                {
                  label: 'Humidity — Forecast (%)',
                  data: [...nullArr(readings.length), lastHum, ...forecast.map(f => f.humidity)],
                  borderColor: 'rgba(49,130,206,0.75)',
                  backgroundColor: 'rgba(49,130,206,0.04)',
                  borderWidth: 2,
                  borderDash: [6, 4],
                  pointRadius: 3,
                  pointHoverRadius: 5,
                  fill: true,
                  tension: 0.4,
                  spanGaps: false,
                  yAxisID: 'y1'
                }
              ]
            });
          });
      })
      .catch(err => setError(err.message || 'Failed to load forecast'))
      .finally(() => setFetchingForecast(false));
  }, [selectedDevice, horizon]);

  if (!isAuthenticated) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
        <i className="ph ph-warning-circle" style={{ fontSize: '4rem', color: 'var(--danger-color)', marginBottom: '1rem' }}></i>
        <h2 style={{ marginBottom: '0.5rem' }}>Please log in</h2>
        <p style={{ color: 'var(--text-muted)' }}>You need to be logged in to view forecast data.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
        <i className="ph ph-circle-notch" style={{ fontSize: '3rem', color: 'var(--primary-color)', marginBottom: '1rem' }}></i>
        <p style={{ color: 'var(--text-muted)' }}>Loading devices...</p>
      </div>
    );
  }

  return (
    <>
      <div style={{ position: 'absolute', top: '90px', right: '35px', zIndex: 10, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <label htmlFor="forecast-horizon-selector" style={{ margin: 0 }}>Horizon:</label>
        <select
          id="forecast-horizon-selector"
          className="device-select"
          value={horizon}
          onChange={e => setHorizon(e.target.value)}
        >
          <option value="6min">6 min</option>
          <option value="10min">10 min</option>
          <option value="15min">15 min</option>
        </select>
        <label htmlFor="forecast-device-selector" style={{ margin: 0 }}>
          <i className="ph ph-funnel"></i> Device:
        </label>
        <select
          id="forecast-device-selector"
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

      <div style={{ marginTop: '2rem' }}>
        {!selectedDevice ? (
          <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <i className="ph ph-plugs" style={{ fontSize: '4rem', color: 'var(--text-muted)', marginBottom: '1rem' }}></i>
            <h2 style={{ marginBottom: '0.5rem' }}>No Devices</h2>
            <p style={{ color: 'var(--text-muted)' }}>Add a device to view forecast data.</p>
          </div>
        ) : fetchingForecast ? (
          <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <i className="ph ph-circle-notch" style={{ fontSize: '3rem', color: 'var(--primary-color)', marginBottom: '1rem' }}></i>
            <p style={{ color: 'var(--text-muted)' }}>Loading forecast...</p>
          </div>
        ) : insufficientData ? (
          <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <i className="ph ph-hourglass" style={{ fontSize: '3rem', color: 'var(--text-muted)', marginBottom: '1rem' }}></i>
            <p style={{ color: 'var(--text-muted)' }}>Collecting data, please wait a minute...</p>
          </div>
        ) : error ? (
          <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <i className="ph ph-warning" style={{ fontSize: '4rem', color: 'var(--danger-color)', marginBottom: '1rem' }}></i>
            <h2 style={{ marginBottom: '0.5rem' }}>Forecast Unavailable</h2>
            <p style={{ color: 'var(--text-muted)' }}>{error}</p>
          </div>
        ) : chartData ? (
          <div className="card">
            <div className="card-header" style={{ marginBottom: '1rem' }}>
              <i className="ph ph-robot"></i>
              <span>AI Forecast — Next {horizon.replace('min', ' min')} Ahead</span>
            </div>
            <div className="chart-container">
              <Line data={chartData} options={chartOptions} plugins={[nowLinePlugin]} />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
