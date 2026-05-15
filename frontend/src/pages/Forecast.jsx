import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useConnection } from '../context/ConnectionContext';
import { io } from 'socket.io-client';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { MapContainer, TileLayer, Rectangle, SVGOverlay, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).href,
  iconUrl: new URL('leaflet/dist/images/marker-icon.png', import.meta.url).href,
  shadowUrl: new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).href,
});

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const MIN_WINDOW = 24;

const FORECAST_HORIZONS = [
  { value: '6min',  minutes: 6  },
  { value: '10min', minutes: 10 },
  { value: '15min', minutes: 15 },
];

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

function MapHoverHandler({ grid, W, H, bounds, spatialMode, tooltipRef }) {
  const [[minLat, minLng], [maxLat, maxLng]] = bounds;
  useMapEvents({
    mousemove(e) {
      const el = tooltipRef?.current;
      if (!el) return;
      const { lat, lng } = e.latlng;
      if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) {
        el.style.display = 'none';
        return;
      }
      const relX = (lng - minLng) / (maxLng - minLng);
      const relY = (maxLat - lat) / (maxLat - minLat);
      const col = Math.min(W - 1, Math.max(0, Math.floor(relX * W)));
      const row = Math.min(H - 1, Math.max(0, Math.floor(relY * H)));
      const val = grid[row][col];
      el.style.left = (e.containerPoint.x + 14) + 'px';
      el.style.top  = (e.containerPoint.y + 14) + 'px';
      if (spatialMode === 'temperature') {
        el.style.color = '#fc8181';
        el.textContent = '\uD83C\uDF21\uFE0F ' + val.toFixed(1) + '\u00b0C';
      } else {
        el.style.color = '#63b3ed';
        el.textContent = '\uD83D\uDCA7 ' + val.toFixed(1) + '%';
      }
      el.style.display = 'block';
    },
    mouseout() {
      if (tooltipRef?.current) tooltipRef.current.style.display = 'none';
    },
  });
  return null;
}

export default function Forecast() {
  const { isAuthenticated, apiFetch } = useAuth();
  const { markDeviceOnline, markDeviceOffline, setActiveDeviceId } = useConnection();

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

  const [activeTab, setActiveTab] = useState('single');
  const [spatialData, setSpatialData] = useState(null);
  const [spatialLoading, setSpatialLoading] = useState(false);
  const [spatialError, setSpatialError] = useState(null);
  const [spatialMode, setSpatialMode] = useState('temperature');
  const [spatialHorizonStep, setSpatialHorizonStep] = useState(0);
  const [spatialRefreshKey, setSpatialRefreshKey] = useState(0);
  const hasSpatialDataRef = useRef(false);
  const [isSpatialRefreshing, setIsSpatialRefreshing] = useState(false);
  const [pendingPositions, setPendingPositions] = useState({});
  const [isAnimating, setIsAnimating] = useState(false);
  const animIntervalRef = useRef(null);
  const tileTooltipRef = useRef(null);
  const deviceTooltipRef = useRef(null);
  const [dataFlash, setDataFlash] = useState(false);
  const [toast, setToast] = useState(null);

  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState('');

  const calcRoomBounds = useCallback((room) => {
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
  }, []);

  const roomBounds = React.useMemo(() => {
    if (!selectedRoom) return null;
    const room = rooms.find(r => r.id === parseInt(selectedRoom));
    return calcRoomBounds(room);
  }, [selectedRoom, rooms, calcRoomBounds]);

  const spatialHorizons = spatialData
    ? [
        (() => {
          const idx = spatialData.heatmaps.findIndex(hm => hm.horizon_minute === 0);
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

  const sliceIdx = spatialHorizons[spatialHorizonStep]?.idx ?? 0;

  useEffect(() => {
    if (!isAuthenticated) { setLoading(false); return; }
    Promise.all([
      apiFetch('/api/devices').then(r => r.ok ? r.json() : []),
      apiFetch('/api/rooms').then(r => r.ok ? r.json() : [])
    ])
    .then(([devData, roomData]) => {
      setDevices(devData);
      if (devData.length > 0) setSelectedDevice(devData[0].id.toString());
      setRooms(roomData);
      if (roomData.length > 0) setSelectedRoom(roomData[0].id.toString());
    })
    .catch(() => {
      setDevices([]);
      setRooms([]);
    })
    .finally(() => setLoading(false));
  }, [isAuthenticated, apiFetch]);

  useEffect(() => {
    setActiveDeviceId(selectedDevice || null);
    return () => setActiveDeviceId(null);
  }, [selectedDevice, setActiveDeviceId]);

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
        setSpatialRefreshKey(k => k + 1);
      }
    });
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
      markDeviceOffline(selectedDevice);
    };
  }, [selectedDevice, isAuthenticated, markDeviceOffline, markDeviceOnline]);

  useEffect(() => {
    if (!selectedDevice) return;
    readingCountRef.current = 0;
    setFetchingForecast(true);
    setError(null);
    setChartData(null);
    setInsufficientData(false);

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
  }, [selectedDevice, horizon, refreshKey, apiFetch]);

  useEffect(() => {
    if (activeTab !== 'spatial' || !isAuthenticated || !selectedRoom) return;
    if (!hasSpatialDataRef.current && !spatialError) {
      setSpatialLoading(true);
    } else if (hasSpatialDataRef.current) {
      setIsSpatialRefreshing(true);
    }
    // Don't clear spatialError before fetch — keep showing current state
    apiFetch(`/api/spatial-forecast?room_id=${selectedRoom}`)
      .then(r => r.ok ? r.json() : r.json().then(d => Promise.reject(new Error(d.detail || d.error || 'Failed to load spatial forecast'))))
      .then(data => { setSpatialData(data); setSpatialError(null); hasSpatialDataRef.current = true; })
      .catch(err => { 
        setSpatialError(err.message || 'Spatial forecast service unavailable');
        setSpatialData(null); 
      })
      .finally(() => { setSpatialLoading(false); setIsSpatialRefreshing(false); });
  }, [activeTab, isAuthenticated, spatialRefreshKey, selectedRoom, apiFetch]);

  useEffect(() => {
    if (!isAnimating) { clearInterval(animIntervalRef.current); return; }
    animIntervalRef.current = setInterval(() => {
      setSpatialHorizonStep(s => (s + 1) % (spatialHorizons.length || 1));
    }, 800);
    return () => clearInterval(animIntervalRef.current);
  }, [isAnimating, spatialHorizons.length]);

  const showToast = useCallback((message) => {
    const id = Date.now();
    setToast({ message, id });
    setTimeout(() => setToast(prev => prev?.id === id ? null : prev), 3000);
  }, []);

  useEffect(() => {
    if (!hasSpatialDataRef.current) return;
    setDataFlash(true);
    const t = setTimeout(() => setDataFlash(false), 900);
    return () => clearTimeout(t);
  }, [spatialRefreshKey]);

  const saveNodePosition = async (deviceId) => {
    const pos = pendingPositions[deviceId];
    if (!pos) return;
    await apiFetch(`/api/devices/${deviceId}`, { method: 'PUT', body: JSON.stringify(pos) });
    setPendingPositions(prev => { const n = { ...prev }; delete n[deviceId]; return n; });
    setSpatialRefreshKey(k => k + 1);
    showToast('New location saved');
  };

  const makeDeviceIcon = (name) => L.divIcon({
    className: '',
    html: `
      <div style="position:relative;display:flex;flex-direction:column;align-items:center;">
        <div style="width:25px;height:41px;background:url('https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png') center/contain no-repeat;filter:hue-rotate(200deg) saturate(1.5);"></div>
        <div style="
          margin-top:2px;
          background:rgba(26,32,44,0.82);
          color:#fff;
          font-size:10px;
          font-family:'Inter',sans-serif;
          font-weight:600;
          padding:2px 6px;
          border-radius:4px;
          white-space:nowrap;
          pointer-events:none;
          box-shadow:0 1px 4px rgba(0,0,0,0.35);
        ">${name}</div>
      </div>`,
    iconSize: [25, 60],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
  });

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
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
          <button className={`btn ${activeTab === 'single' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setActiveTab('single')}>
            <i className="ph ph-chart-line-up"></i> Single Device
          </button>
          <button className={`btn ${activeTab === 'spatial' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setActiveTab('spatial')}>
            <i className="ph ph-map-trifold"></i> Spatial
          </button>
        </div>

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

        {activeTab === 'spatial' && (
          <div className="card">
            <div className="card-header" style={{ marginBottom: '1rem', flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <i className="ph ph-map-trifold"></i>
                  <span>Spatial Forecast {spatialData ? `— ${spatialData.nodes.filter(n => !n.virtual).length} Sensors · LSTM + Kriging` : ''}</span>
                </div>
                <select
                  className="form-control"
                  style={{ padding: '0.35rem 0.75rem', height: '34px', width: 'auto', fontSize: '0.85rem' }}
                  value={selectedRoom}
                  onChange={e => { setSelectedRoom(e.target.value); hasSpatialDataRef.current = false; setSpatialData(null); setSpatialError(null); }}
                >
                  {rooms.length === 0 ? <option value="">No rooms</option> : rooms.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
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
            </div>

            {spatialLoading ? (
              <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
                <i className="ph ph-circle-notch spinning" style={{ fontSize: '3rem', color: 'var(--primary-color)', marginBottom: '1rem' }}></i>
                <p style={{ color: 'var(--text-muted)' }}>Loading spatial forecast...</p>
              </div>
            ) : spatialError ? (
              <div style={{ position: 'relative', borderRadius: '0.5rem' }}>
                <div style={{ borderRadius: '0.5rem', overflow: 'hidden' }}>
                  {roomBounds && (
                    <MapContainer
                      center={[(roomBounds.minLat + roomBounds.maxLat) / 2, (roomBounds.minLng + roomBounds.maxLng) / 2]}
                      zoomSnap={0.5}
                      wheelPxPerZoomLevel={120}
                      bounds={[[roomBounds.minLat, roomBounds.minLng], [roomBounds.maxLat, roomBounds.maxLng]]}
                      boundsOptions={{ padding: [30, 30] }}
                      style={{ height: 420, width: '100%' }}
                      scrollWheelZoom={true}
                      zoomControl={false}
                      attributionControl={false}
                    >
                      <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        maxZoom={25}
                        maxNativeZoom={19}
                      />
                      {rooms.map(room => {
                        const b = calcRoomBounds(room);
                        if (!b) return null;
                        const isSelected = room.id === parseInt(selectedRoom);
                        return (
                          <React.Fragment key={room.id}>
                            <Rectangle
                              bounds={[[b.minLat, b.minLng], [b.maxLat, b.maxLng]]}
                              pathOptions={{
                                color: isSelected ? '#1a202c' : '#a0aec0',
                                weight: isSelected ? 2 : 1,
                                fillOpacity: 0,
                                dashArray: isSelected ? '' : '5, 10'
                              }}
                            />
                            <Marker
                              position={[b.maxLat, (b.minLng + b.maxLng) / 2]}
                              icon={L.divIcon({
                                className: 'room-label',
                                html: `<div style="font-size:14px;font-weight:700;white-space:nowrap;transform:translate(-50%, -100%);color:#1a202c;text-shadow: 1px 1px 0 rgba(255,255,255,0.8), -1px -1px 0 rgba(255,255,255,0.8), 1px -1px 0 rgba(255,255,255,0.8), -1px 1px 0 rgba(255,255,255,0.8);">${room.name}</div>`,
                                iconSize: [0, 0],
                                iconAnchor: [0, 0]
                              })}
                              interactive={false}
                            />
                            {/* X axis for each room */}
                            {Array.from({ length: Math.ceil(b.width) + 1 }, (_, i) => i).map(m => (
                              <Marker
                                key={`err-x-${room.id}-${m}`}
                                position={[b.minLat, b.minLng + (m / b.width) * (b.maxLng - b.minLng)]}
                                interactive={false}
                                icon={L.divIcon({
                                  className: 'axis-label-x',
                                  html: `<div style="color: #718096; font-size: 10px; font-weight: 700; white-space: nowrap;">${m}m</div>`,
                                  iconSize: [20, 10],
                                  iconAnchor: [10, -5]
                                })}
                              />
                            ))}
                            {/* Y axis for each room */}
                            {Array.from({ length: Math.ceil(b.length) + 1 }, (_, i) => i).map(m => (
                              <Marker
                                key={`err-y-${room.id}-${m}`}
                                position={[b.minLat + (m / b.length) * (b.maxLat - b.minLat), b.minLng]}
                                interactive={false}
                                icon={L.divIcon({
                                  className: 'axis-label-y',
                                  html: `<div style="color: #718096; font-size: 10px; font-weight: 700; white-space: nowrap; text-align: right; width: 25px;">${m}m</div>`,
                                  iconSize: [25, 10],
                                  iconAnchor: [30, 5]
                                })}
                              />
                            ))}
                            {isSelected && (
                              <Marker
                                position={[(b.minLat + b.maxLat) / 2, (b.minLng + b.maxLng) / 2]}
                                interactive={false}
                                icon={L.divIcon({
                                  className: 'error-label',
                                  html: `<div style="font-size:11px; font-weight:600; color:#e53e3e; white-space:nowrap; text-align:center; display:flex; align-items:center; justify-content:center;"><i class="ph ph-warning" style="margin-right:4px"></i>Not enough devices<br/>to collect data</div>`,
                                  iconSize: [200, 40],
                                  iconAnchor: [100, 20]
                                })}
                              />
                            )}
                          </React.Fragment>
                        );
                      })}
                      {/* Show all devices with coordinates */}
                      {devices.filter(d => d.lat && d.lng).map(device => {
                        const room = rooms.find(r => r.id === device.room_id);
                        const nodeTemp = (device.last_temperature ?? '—').toString();
                        const nodeHum  = (device.last_humidity ?? '—').toString();
                        return (
                          <Marker
                            key={device.id}
                            position={[device.lat, device.lng]}
                            icon={makeDeviceIcon(device.name)}
                            eventHandlers={{
                              mouseover(e) {
                                const el = deviceTooltipRef.current;
                                if (!el) return;
                                const cp = e.containerPoint;
                                el.style.left = (cp.x + 14) + 'px';
                                el.style.top  = (cp.y - 80) + 'px';
                                el.innerHTML = `
                                  <div style="font-weight:700;margin-bottom:3px;font-size:0.85rem">${device.name}</div>
                                  <div>🌡️ <span style="color:#c53030">${nodeTemp !== '—' ? nodeTemp + '°C' : '—'}</span></div>
                                  <div>💧 <span style="color:#2b6cb0">${nodeHum !== '—' ? nodeHum + '%' : '—'}</span></div>
                                  <div style="font-size:0.7rem;color:#718096;margin-top:2px">Room: ${room ? room.name : 'Unassigned'}</div>
                                `;
                                el.style.display = 'block';
                              },
                              mousemove(e) {
                                const el = deviceTooltipRef.current;
                                if (!el || el.style.display === 'none') return;
                                const cp = e.containerPoint;
                                el.style.left = (cp.x + 14) + 'px';
                                el.style.top  = (cp.y - 80) + 'px';
                              },
                              mouseout() {
                                if (deviceTooltipRef.current) deviceTooltipRef.current.style.display = 'none';
                              },
                            }}
                          >
                            <Popup>
                              <div style={{ minWidth: 140 }}>
                                <strong>{device.name}</strong>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                                  Room: {room ? room.name : 'Unassigned'}
                                </div>
                                <div style={{ fontSize: '0.85rem' }}>
                                  🌡️ {nodeTemp !== '—' ? nodeTemp + '°C' : '—'} / 💧 {nodeHum !== '—' ? nodeHum + '%' : '—'}
                                </div>
                              </div>
                            </Popup>
                          </Marker>
                        );
                      })}
                    </MapContainer>
                  )}
                </div>
                <div ref={deviceTooltipRef} style={{
                  display: 'none', position: 'absolute',
                  background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px',
                  padding: '7px 12px', fontSize: '0.82rem', fontFamily: "'Inter',sans-serif",
                  lineHeight: 1.6, boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                  pointerEvents: 'none', zIndex: 9999, whiteSpace: 'nowrap',
                }} />
              </div>
            ) : spatialData ? (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
                  <div style={{ flex: 1, minWidth: '180px' }}>
                    <input
                      type="range"
                      min={0}
                      max={spatialHorizons.length - 1}
                      step={1}
                      value={spatialHorizonStep}
                      onChange={e => setSpatialHorizonStep(Number(e.target.value))}
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

                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className={`btn btn-sm ${isAnimating ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setIsAnimating(a => !a)}
                      title="Timelapse through horizons"
                    >
                      <i className={`ph ${isAnimating ? 'ph-pause' : 'ph-play'}`}></i>
                    </button>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => { setIsAnimating(false); setSpatialRefreshKey(k => k + 1); }}
                      title="Refresh"
                    >
                      <i className={`ph ph-arrows-clockwise${isSpatialRefreshing ? ' spinning' : ''}`}></i>
                    </button>
                  </div>
                </div>

                <div style={{
                  position: 'relative',
                  borderRadius: '0.5rem',
                  outline: dataFlash ? '2px solid #38a169' : '2px solid transparent',
                  boxShadow: dataFlash ? '0 0 0 5px rgba(56,161,105,0.22)' : '0 0 0 0px rgba(56,161,105,0)',
                  transition: 'outline 0.25s ease, box-shadow 0.25s ease',
                }}>
                  <div style={{ borderRadius: '0.5rem', overflow: 'hidden' }}>
                    {roomBounds && (
                      <MapContainer
                        center={[(roomBounds.minLat + roomBounds.maxLat) / 2, (roomBounds.minLng + roomBounds.maxLng) / 2]}
                        zoomSnap={0.5}
                        wheelPxPerZoomLevel={120}
                        bounds={[[roomBounds.minLat, roomBounds.minLng], [roomBounds.maxLat, roomBounds.maxLng]]}
                        boundsOptions={{ padding: [30, 30] }}
                        style={{ height: 420, width: '100%' }}
                        scrollWheelZoom={true}
                        zoomControl={false}
                        attributionControl={false}
                      >
                        <TileLayer
                          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                          maxZoom={25}
                          maxNativeZoom={19}
                        />

                        {rooms.map(room => {
                          const b = calcRoomBounds(room);
                          if (!b) return null;
                          const isSelected = room.id === parseInt(selectedRoom);
                          return (
                            <React.Fragment key={room.id}>
                              <Rectangle
                                bounds={[[b.minLat, b.minLng], [b.maxLat, b.maxLng]]}
                                pathOptions={{
                                  color: isSelected ? '#1a202c' : '#a0aec0',
                                  weight: isSelected ? 2 : 1,
                                  fillOpacity: 0,
                                  dashArray: isSelected ? '' : '5, 10'
                                }}
                              />
                              <Marker 
                                position={[b.maxLat, (b.minLng + b.maxLng) / 2]} 
                                icon={L.divIcon({
                                  className: 'room-label',
                                  html: `<div style="font-size:14px;font-weight:700;white-space:nowrap;transform:translate(-50%, -100%);color:#1a202c;text-shadow: 1px 1px 0 rgba(255,255,255,0.8), -1px -1px 0 rgba(255,255,255,0.8), 1px -1px 0 rgba(255,255,255,0.8), -1px 1px 0 rgba(255,255,255,0.8);">${room.name}</div>`,
                                  iconSize: [0, 0],
                                  iconAnchor: [0, 0]
                                })}
                                interactive={false}
                              />
                              {/* X axis for each room */}
                              {Array.from({ length: Math.ceil(b.width) + 1 }, (_, i) => i).map(m => (
                                <Marker
                                  key={`x-${room.id}-${m}`}
                                  position={[b.minLat, b.minLng + (m / b.width) * (b.maxLng - b.minLng)]}
                                  interactive={false}
                                  icon={L.divIcon({
                                    className: 'axis-label-x',
                                    html: `<div style="color: #718096; font-size: 10px; font-weight: 700; white-space: nowrap;">${m}m</div>`,
                                    iconSize: [20, 10],
                                    iconAnchor: [10, -5]
                                  })}
                                />
                              ))}
                              {/* Y axis for each room */}
                              {Array.from({ length: Math.ceil(b.length) + 1 }, (_, i) => i).map(m => (
                                <Marker
                                  key={`y-${room.id}-${m}`}
                                  position={[b.minLat + (m / b.length) * (b.maxLat - b.minLat), b.minLng]}
                                  interactive={false}
                                  icon={L.divIcon({
                                    className: 'axis-label-y',
                                    html: `<div style="color: #718096; font-size: 10px; font-weight: 700; white-space: nowrap; text-align: right; width: 25px;">${m}m</div>`,
                                    iconSize: [25, 10],
                                    iconAnchor: [30, 5]
                                  })}
                                />
                              ))}
                            </React.Fragment>
                          );
                        })}

                        {spatialData && (() => {
                          const slice = spatialData.heatmaps[sliceIdx];
                          if (!slice) return null;
                          const grid = spatialMode === 'temperature' ? slice.temperature : slice.humidity;
                          const toRgb = spatialMode === 'temperature' ? tempToRgb : humToRgb;
                          const H = grid.length, W = grid[0].length;
                          return (
                            <SVGOverlay
                              bounds={[[roomBounds.minLat, roomBounds.minLng], [roomBounds.maxLat, roomBounds.maxLng]]}
                              attributes={{ opacity: 0.65 }}
                            >
                              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height="100%">
                                {grid.flatMap((row, r) =>
                                  row.map((val, c) => {
                                    const [rv, g, b] = toRgb(val);
                                    return <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill={`rgb(${rv},${g},${b})`} />;
                                  })
                                )}
                              </svg>
                            </SVGOverlay>
                          );
                        })()}

                        {devices.filter(d => d.lat && d.lng).map(device => {
                          const room = rooms.find(r => r.id === device.room_id);
                          const b = calcRoomBounds(room);
                          const sNode = spatialData?.nodes.find(n => n.device_id === device.id);
                          const nodeTemp = (sNode?.current_temperature ?? device.last_temperature ?? '—').toString();
                          const nodeHum  = (sNode?.current_humidity ?? device.last_humidity ?? '—').toString();

                          return (
                            <Marker
                              key={device.id}
                              position={[
                                pendingPositions[device.id]?.lat ?? device.lat,
                                pendingPositions[device.id]?.lng ?? device.lng,
                              ]}
                              draggable={true}
                              icon={makeDeviceIcon(device.name)}
                              eventHandlers={{
                                dragend(e) {
                                  let { lat, lng } = e.target.getLatLng();
                                  if (b) {
                                    lat = Math.max(b.minLat, Math.min(b.maxLat, lat));
                                    lng = Math.max(b.minLng, Math.min(b.maxLng, lng));
                                  }
                                  e.target.setLatLng([lat, lng]);
                                  setPendingPositions(prev => ({ ...prev, [device.id]: { lat, lng } }));
                                },
                                mouseover(e) {
                                  const el = deviceTooltipRef.current;
                                  if (!el) return;
                                  const cp = e.containerPoint;
                                  el.style.left = (cp.x + 14) + 'px';
                                  el.style.top  = (cp.y - 80) + 'px';
                                  el.innerHTML = `
                                    <div style="font-weight:700;margin-bottom:3px;font-size:0.85rem">${device.name}</div>
                                    <div>🌡️ <span style="color:#c53030">${nodeTemp !== '—' ? nodeTemp + '°C' : '—'}</span></div>
                                    <div>💧 <span style="color:#2b6cb0">${nodeHum !== '—' ? nodeHum + '%' : '—'}</span></div>
                                  `;
                                  el.style.display = 'block';
                                },
                                mousemove(e) {
                                  const el = deviceTooltipRef.current;
                                  if (!el || el.style.display === 'none') return;
                                  const cp = e.containerPoint;
                                  el.style.left = (cp.x + 14) + 'px';
                                  el.style.top  = (cp.y - 80) + 'px';
                                },
                                mouseout() {
                                  if (deviceTooltipRef.current) deviceTooltipRef.current.style.display = 'none';
                                },
                              }}
                            >
                              <Popup>
                                <div style={{ minWidth: 140 }}>
                                  <strong>{device.name}</strong>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                                    Room: {room ? room.name : 'Unassigned'}
                                  </div>
                                  {sNode?.forecast?.[0] && (
                                    <div style={{ marginTop: 4, fontSize: '0.85rem' }}>
                                      Next: {sNode.forecast[0].temperature}°C / {sNode.forecast[0].humidity}%
                                    </div>
                                  )}
                                  {pendingPositions[device.id] && (
                                    <button
                                      onClick={() => saveNodePosition(device.id)}
                                      style={{ marginTop: 6, padding: '3px 10px', background: 'var(--primary-color)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}
                                    >
                                      Save position
                                    </button>
                                  )}
                                </div>
                              </Popup>
                            </Marker>
                          );
                        })}

                        {spatialData && (() => {
                          const slice = spatialData.heatmaps[sliceIdx];
                          if (!slice) return null;
                          const grid = spatialMode === 'temperature' ? slice.temperature : slice.humidity;
                          const H = grid.length, W = grid[0].length;
                          const BOUNDS = [[roomBounds.minLat, roomBounds.minLng], [roomBounds.maxLat, roomBounds.maxLng]];
                          return (
                            <MapHoverHandler
                              grid={grid} W={W} H={H} bounds={BOUNDS}
                              spatialMode={spatialMode}
                              tooltipRef={tileTooltipRef}
                            />
                          );
                        })()}
                      </MapContainer>
                    )}
                  </div>

                  <div ref={deviceTooltipRef} style={{
                    display: 'none', position: 'absolute',
                    background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px',
                    padding: '7px 12px', fontSize: '0.82rem', fontFamily: "'Inter',sans-serif",
                    lineHeight: 1.6, boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                    pointerEvents: 'none', zIndex: 9999, whiteSpace: 'nowrap',
                  }} />

                  <div ref={tileTooltipRef} style={{
                    display: 'none', position: 'absolute',
                    background: 'rgba(26,32,44,0.9)', color: '#fc8181',
                    padding: '4px 9px', borderRadius: '5px', fontSize: '0.78rem',
                    fontFamily: "'Inter',sans-serif", pointerEvents: 'none',
                    zIndex: 9998, boxShadow: '0 2px 8px rgba(0,0,0,0.25)', whiteSpace: 'nowrap',
                  }} />
                </div>

                <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {spatialMode === 'temperature' ? (
                    <>
                      <span>15°C</span>
                      <div style={{ flex: 1, height: '10px', borderRadius: '5px', background: 'linear-gradient(to right, #1e64ff, #32c832, #e64632)' }} />
                      <span>40°C</span>
                    </>
                  ) : (
                    <>
                      <span>0%</span>
                      <div style={{ flex: 1, height: '10px', borderRadius: '5px', background: 'linear-gradient(to right, #f0a032, #1e64dc)' }} />
                      <span>100%</span>
                    </>
                  )}
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>

      {toast && (
        <div style={{
          position: 'fixed',
          bottom: '2rem',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'linear-gradient(135deg, #38a169, #276749)',
          color: '#fff',
          padding: '0.75rem 1.5rem',
          borderRadius: '10px',
          fontFamily: "'Inter',sans-serif",
          fontWeight: 600,
          fontSize: '0.9rem',
          boxShadow: '0 8px 30px rgba(56,161,105,0.45)',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          animation: 'fadeInUp 0.3s ease',
        }}>
          <span style={{ fontSize: '1.1rem' }}>✅</span> {toast.message}
        </div>
      )}
    </>
  );
}