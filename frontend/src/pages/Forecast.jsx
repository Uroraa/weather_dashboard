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

// Single source of truth for horizon options — shared by both tabs
const FORECAST_HORIZONS = [
  { value: '6min',  minutes: 6  },
  { value: '10min', minutes: 10 },
  { value: '15min', minutes: 15 },
];

// --- Spatial heatmap helpers ---
function lerp(a, b, t) { return a + (b - a) * t; }

function tempToRgb(val) {
  const t = Math.max(0, Math.min(1, (val - 15) / 25));
  if (t < 0.5) {
    const s = t / 0.5;
    return [Math.round(lerp(30, 50, s)), Math.round(lerp(100, 200, s)), Math.round(lerp(255, 80, s))];
  }
  const s = (t - 0.5) / 0.5;
  return [Math.round(lerp(50, 230, s)), Math.round(lerp(200, 50, s)), Math.round(lerp(80, 30, s))];
}

function humToRgb(val) {
  const t = Math.max(0, Math.min(1, val / 100));
  return [Math.round(lerp(240, 30, t)), Math.round(lerp(160, 100, t)), Math.round(lerp(50, 220, t))];
}

// --- Single-device forecast chart ---
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
      ticks: { maxTicksLimit: 10, maxRotation: 0, font: { family: "'Inter', sans-serif", size: 11 }, color: '#718096' }
    },
    y: {
      type: 'linear', display: true, position: 'left',
      suggestedMin: 10, suggestedMax: 45,
      title: { display: true, text: 'Temperature (°C)', color: '#e53e3e', font: { family: "'Inter', sans-serif" } },
      grid: { color: 'rgba(0,0,0,0.05)' }
    },
    y1: {
      type: 'linear', display: true, position: 'right',
      min: 0, max: 100,
      title: { display: true, text: 'Humidity (%)', color: '#3182ce', font: { family: "'Inter', sans-serif" } },
      grid: { drawOnChartArea: false }
    }
  },
  animation: { duration: 400, easing: 'easeOutQuart' }
};

export default function Forecast() {
  const { isAuthenticated, apiFetch } = useAuth();
  const { markDeviceOnline, markDeviceOffline, setActiveDeviceId } = useConnection();

  // Single-device tab state
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [horizon, setHorizon] = useState(FORECAST_HORIZONS[0].value);
  const [loading, setLoading] = useState(true);
  const [fetchingForecast, setFetchingForecast] = useState(false);
  const [insufficientData, setInsufficientData] = useState(false);
  const [error, setError] = useState(null);
  const [chartData, setChartData] = useState(null);
  const socketRef = useRef(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const readingCountRef = useRef(0);
  const REFRESH_EVERY = 5;

  // Tab state
  const [activeTab, setActiveTab] = useState('single');

  // Spatial tab state
  const [spatialData, setSpatialData] = useState(null);
  const [spatialLoading, setSpatialLoading] = useState(false);
  const [spatialError, setSpatialError] = useState(null);
  const [spatialMode, setSpatialMode] = useState('temperature');
  const [spatialHorizonStep, setSpatialHorizonStep] = useState(0); // 0–3, maps to spatialHorizons
  const [spatialRefreshKey, setSpatialRefreshKey] = useState(0);
  const hasSpatialDataRef = useRef(false);
  const [isSpatialRefreshing, setIsSpatialRefreshing] = useState(false);
  const canvasRef = useRef(null);
  const [hoverInfo, setHoverInfo] = useState(null);

  // Derive available horizon steps from heatmap data — synced with FORECAST_HORIZONS, no hard-coded indices
  // "Now" is horizon_minute=0 (actual readings); forecast steps use findIndex on horizon_minute
  const spatialHorizons = spatialData
    ? [
        (() => {
          const idx = spatialData.heatmaps.findIndex(hm => hm.horizon_minute === 0);
          // If service hasn't been updated yet, fall back to first heatmap but flag it as prediction
          if (idx >= 0) return { label: 'Now', idx };
          const fallback = spatialData.heatmaps.findIndex(hm => hm.horizon_minute === 1);
          return fallback >= 0 ? { label: 'Now (~)', idx: fallback } : null;
        })(),
        ...FORECAST_HORIZONS.map(h => {
          const idx = spatialData.heatmaps.findIndex(hm => hm.horizon_minute === h.minutes);
          return idx >= 0 ? { label: `+${h.minutes} min`, idx } : null;
        }),
      ].filter(Boolean)
    : [];

  // sliceIdx is derived, not state
  const sliceIdx = spatialHorizons[spatialHorizonStep]?.idx ?? 0;

  // Load devices
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

  // Sync activeDeviceId for topbar
  useEffect(() => {
    setActiveDeviceId(selectedDevice || null);
    return () => setActiveDeviceId(null);
  }, [selectedDevice, setActiveDeviceId]);

  // Socket: real-time status + refresh trigger for both single-device and spatial
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
      readingCountRef.current += 1;
      if (readingCountRef.current >= REFRESH_EVERY) {
        readingCountRef.current = 0;
        setRefreshKey(k => k + 1);
        setSpatialRefreshKey(k => k + 1); // spatial refreshes at same cadence
      }
    });
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
      markDeviceOffline(selectedDevice);
    };
  }, [selectedDevice, isAuthenticated]);

  // Fetch single-device forecast
  useEffect(() => {
    if (!selectedDevice) return;
    readingCountRef.current = 0;
    setFetchingForecast(true);
    setError(null);
    setChartData(null);
    setInsufficientData(false);

    const deviceInfo = devices.find(d => d.id.toString() === selectedDevice);
    if (deviceInfo?.last_reading) {
      const elapsed = Date.now() - new Date(deviceInfo.last_reading).getTime();
      if (elapsed < 10000) markDeviceOnline(selectedDevice, 'sensor');
      else markDeviceOffline(selectedDevice);
    } else {
      markDeviceOffline(selectedDevice);
    }

    apiFetch(`/api/devices/${selectedDevice}/readings?limit=30`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load readings')))
      .then(readings => {
        if (readings.length < MIN_WINDOW) { setInsufficientData(true); return; }
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
                  borderColor: '#e53e3e', backgroundColor: 'rgba(229,62,62,0.08)',
                  borderWidth: 2, pointRadius: 2, pointHoverRadius: 5,
                  fill: true, tension: 0.4, spanGaps: false, yAxisID: 'y'
                },
                {
                  label: 'Humidity — History (%)',
                  data: [...readings.map(r => r.humidity), lastHum, ...nullArr(forecast.length)],
                  borderColor: '#3182ce', backgroundColor: 'rgba(49,130,206,0.08)',
                  borderWidth: 2, pointRadius: 2, pointHoverRadius: 5,
                  fill: true, tension: 0.4, spanGaps: false, yAxisID: 'y1'
                },
                {
                  label: 'Temperature — Forecast (°C)',
                  data: [...nullArr(readings.length), lastTemp, ...forecast.map(f => f.temperature)],
                  borderColor: 'rgba(229,62,62,0.75)', backgroundColor: 'rgba(229,62,62,0.04)',
                  borderWidth: 2, borderDash: [6, 4], pointRadius: 3, pointHoverRadius: 5,
                  fill: true, tension: 0.4, spanGaps: false, yAxisID: 'y'
                },
                {
                  label: 'Humidity — Forecast (%)',
                  data: [...nullArr(readings.length), lastHum, ...forecast.map(f => f.humidity)],
                  borderColor: 'rgba(49,130,206,0.75)', backgroundColor: 'rgba(49,130,206,0.04)',
                  borderWidth: 2, borderDash: [6, 4], pointRadius: 3, pointHoverRadius: 5,
                  fill: true, tension: 0.4, spanGaps: false, yAxisID: 'y1'
                }
              ]
            });
          });
      })
      .catch(err => setError(err.message || 'Failed to load forecast'))
      .finally(() => setFetchingForecast(false));
  }, [selectedDevice, horizon, refreshKey]);

  // Fetch spatial forecast — spinner on first load, pulse border on subsequent refreshes
  useEffect(() => {
    if (activeTab !== 'spatial' || !isAuthenticated) return;
    if (!hasSpatialDataRef.current) {
      setSpatialLoading(true);
    } else {
      setIsSpatialRefreshing(true);
    }
    setSpatialError(null);
    apiFetch('/api/spatial-forecast')
      .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(new Error(d.error || 'Failed to load spatial forecast'))))
      .then(data => { setSpatialData(data); hasSpatialDataRef.current = true; })
      .catch(err => { if (!hasSpatialDataRef.current) setSpatialError(err.message || 'Spatial forecast service unavailable'); })
      .finally(() => { setSpatialLoading(false); setIsSpatialRefreshing(false); });
  }, [activeTab, isAuthenticated, spatialRefreshKey]);

  // Draw canvas heatmap
  useEffect(() => {
    if (!spatialData || !canvasRef.current || activeTab !== 'spatial') return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const slice = spatialData.heatmaps[sliceIdx];
    const grid = spatialMode === 'temperature' ? slice.temperature : slice.humidity;
    const toRgb = spatialMode === 'temperature' ? tempToRgb : humToRgb;

    const imgData = ctx.createImageData(W, H);
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const col = Math.min(Math.floor((px / W) * grid[0].length), grid[0].length - 1);
        const row = Math.min(Math.floor((py / H) * grid.length), grid.length - 1);
        const [r, g, b] = toRgb(grid[row][col]);
        const i = (py * W + px) * 4;
        imgData.data[i] = r; imgData.data[i + 1] = g; imgData.data[i + 2] = b; imgData.data[i + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    spatialData.nodes.filter(n => !n.virtual).forEach(node => {
      const px = (node.x / 10) * W;
      const py = (node.y / 8) * H;
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fill();
      ctx.strokeStyle = '#1a202c';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#1a202c';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillText(node.name, px + 10, py + 4);
    });
  }, [spatialData, sliceIdx, spatialMode, activeTab]);

  const handleCanvasMouseMove = (e) => {
    if (!spatialData) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const slice = spatialData.heatmaps[sliceIdx];
    const grid = spatialMode === 'temperature' ? slice.temperature : slice.humidity;
    const col = Math.min(Math.floor((cssX / rect.width) * grid[0].length), grid[0].length - 1);
    const row = Math.min(Math.floor((cssY / rect.height) * grid.length), grid.length - 1);
    setHoverInfo({ cssX, cssY, value: grid[row][col], rectWidth: rect.width });
  };

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
      {/* Single-tab controls */}
      {activeTab === 'single' && (
        <div style={{ position: 'absolute', top: '90px', right: '35px', zIndex: 10, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label htmlFor="forecast-horizon-selector" style={{ margin: 0 }}>Horizon:</label>
          <select
            id="forecast-horizon-selector"
            className="device-select"
            value={horizon}
            onChange={e => setHorizon(e.target.value)}
          >
            {FORECAST_HORIZONS.map(h => (
              <option key={h.value} value={h.value}>{h.minutes} min</option>
            ))}
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
      )}

      <div style={{ marginTop: '2rem' }}>
        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
          <button className={`btn ${activeTab === 'single' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setActiveTab('single')}>
            <i className="ph ph-chart-line-up"></i> Single Device
          </button>
          <button className={`btn ${activeTab === 'spatial' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setActiveTab('spatial')}>
            <i className="ph ph-map-trifold"></i> Spatial
          </button>
        </div>

        {/* Single device tab */}
        {activeTab === 'single' && (
          !selectedDevice ? (
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
          ) : null
        )}

        {/* Spatial tab */}
        {activeTab === 'spatial' && (
          spatialLoading ? (
            <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
              <i className="ph ph-circle-notch" style={{ fontSize: '3rem', color: 'var(--primary-color)', marginBottom: '1rem' }}></i>
              <p style={{ color: 'var(--text-muted)' }}>Loading spatial forecast...</p>
            </div>
          ) : spatialError ? (
            <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
              <i className="ph ph-warning" style={{ fontSize: '4rem', color: 'var(--danger-color)', marginBottom: '1rem' }}></i>
              <h2 style={{ marginBottom: '0.5rem' }}>Spatial Forecast Unavailable</h2>
              <p style={{ color: 'var(--text-muted)' }}>{spatialError}</p>
            </div>
          ) : spatialData ? (
            <div className="card">
              <div className="card-header" style={{ marginBottom: '1rem' }}>
                <i className="ph ph-map-trifold"></i>
                <span>Spatial Forecast — {spatialData.nodes.filter(n => !n.virtual).length} Sensors · LSTM + Kriging</span>
              </div>

              {/* Controls row */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
                {/* Mode toggle */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    className={`btn btn-sm ${spatialMode === 'temperature' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setSpatialMode('temperature')}
                  >
                    <i className="ph ph-thermometer"></i> Temperature
                  </button>
                  <button
                    className={`btn btn-sm ${spatialMode === 'humidity' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setSpatialMode('humidity')}
                  >
                    <i className="ph ph-drop"></i> Humidity
                  </button>
                </div>

                {/* Horizon slider — 4 discrete steps with tick labels */}
                <div style={{ flex: 1, minWidth: '180px' }}>
                  <input
                    type="range"
                    min={0}
                    max={spatialHorizons.length - 1}
                    step={1}
                    value={spatialHorizonStep}
                    onChange={e => { setSpatialHorizonStep(Number(e.target.value)); setHoverInfo(null); }}
                    style={{ width: '100%' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {spatialHorizons.map(h => (
                      <span key={h.label} style={{ fontWeight: spatialHorizons[spatialHorizonStep]?.label === h.label ? 700 : 400 }}>
                        {h.label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Canvas heatmap — pulse border class during background refresh */}
              <div
                style={{ position: 'relative' }}
                className={isSpatialRefreshing ? 'spatial-canvas-refreshing' : ''}
              >
                <canvas
                  ref={canvasRef}
                  width={500}
                  height={400}
                  style={{ width: '100%', height: 'auto', borderRadius: '0.5rem', display: 'block', cursor: 'crosshair' }}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseLeave={() => setHoverInfo(null)}
                />
                {hoverInfo && (
                  <div style={{
                    position: 'absolute',
                    left: hoverInfo.cssX + (hoverInfo.cssX > hoverInfo.rectWidth * 0.75 ? -80 : 12),
                    top: Math.max(4, hoverInfo.cssY - 10),
                    background: 'rgba(26,32,44,0.88)',
                    color: '#fff',
                    padding: '3px 9px',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 600,
                    pointerEvents: 'none',
                    whiteSpace: 'nowrap',
                    zIndex: 10,
                  }}>
                    {spatialMode === 'temperature'
                      ? `${hoverInfo.value.toFixed(1)} °C`
                      : `${hoverInfo.value.toFixed(1)} %`}
                  </div>
                )}
              </div>

              {/* Color legend */}
              <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {spatialMode === 'temperature' ? (
                  <>
                    <span>15°C</span>
                    <div style={{ flex: 1, position: 'relative', height: '10px' }}>
                      <div style={{ width: '100%', height: '100%', borderRadius: '5px', background: 'linear-gradient(to right, #1e64ff, #32c832, #e64632)' }} />
                      {hoverInfo && (
                        <div style={{
                          position: 'absolute',
                          left: `${Math.max(0, Math.min(100, (hoverInfo.value - 15) / 25 * 100))}%`,
                          top: '-4px', transform: 'translateX(-50%)',
                          width: '3px', height: '18px',
                          background: 'rgba(26,32,44,0.85)', borderRadius: '2px', pointerEvents: 'none',
                        }} />
                      )}
                    </div>
                    <span>40°C</span>
                  </>
                ) : (
                  <>
                    <span>0%</span>
                    <div style={{ flex: 1, position: 'relative', height: '10px' }}>
                      <div style={{ width: '100%', height: '100%', borderRadius: '5px', background: 'linear-gradient(to right, #f0a032, #1e64dc)' }} />
                      {hoverInfo && (
                        <div style={{
                          position: 'absolute',
                          left: `${Math.max(0, Math.min(100, hoverInfo.value))}%`,
                          top: '-4px', transform: 'translateX(-50%)',
                          width: '3px', height: '18px',
                          background: 'rgba(26,32,44,0.85)', borderRadius: '2px', pointerEvents: 'none',
                        }} />
                      )}
                    </div>
                    <span>100%</span>
                  </>
                )}
              </div>
            </div>
          ) : null
        )}
      </div>
    </>
  );
}
