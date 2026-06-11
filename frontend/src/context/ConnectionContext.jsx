import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const ConnectionContext = createContext();

const MAX_DATA_POINTS = 30;

function emptyChartData() {
    return {
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
            },
            {
                label: 'AQI',
                data: Array(MAX_DATA_POINTS).fill(null),
                borderColor: '#38a169',
                backgroundColor: 'rgba(56, 161, 105, 0.1)',
                borderWidth: 3,
                pointRadius: 0,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.4,
                yAxisID: 'y2'
            }
        ]
    };
}

export function ConnectionProvider({ children }) {
    const { isAuthenticated, apiFetch } = useAuth();

    // --- Connection status (existing) ---
    const [deviceStatuses, setDeviceStatuses] = useState({});
    const [activeDeviceId, setActiveDeviceId] = useState(null);
    const timersRef = useRef({});

    // --- Persistent dashboard data ---
    const [devices, setDevices] = useState([]);
    const [selectedDevice, setSelectedDevice] = useState('');
    const [devicesLoading, setDevicesLoading] = useState(true);
    const [chartData, setChartData] = useState(emptyChartData);
    const [liveTemp, setLiveTemp] = useState('--');
    const [liveHumidity, setLiveHumidity] = useState('--');
    const [liveAqi, setLiveAqi] = useState('--');
    const [liveUpdateKey, setLiveUpdateKey] = useState(0);

    const socketRef = useRef(null);

    // --- Existing connection status callbacks ---
    const markDeviceOnline = useCallback((deviceId, source) => {
        setDeviceStatuses(prev => ({ ...prev, [deviceId]: { status: 'online', source } }));
        if (timersRef.current[deviceId]) clearTimeout(timersRef.current[deviceId]);
        timersRef.current[deviceId] = setTimeout(() => {
            setDeviceStatuses(prev => ({
                ...prev,
                [deviceId]: { status: 'offline', source: null }
            }));
        }, 10000);
    }, []);

    const markDeviceOffline = useCallback((deviceId) => {
        if (timersRef.current[deviceId]) clearTimeout(timersRef.current[deviceId]);
        setDeviceStatuses(prev => ({
            ...prev,
            [deviceId]: { status: 'offline', source: null }
        }));
    }, []);

    const getDeviceStatus = useCallback((deviceId) => {
        return deviceStatuses[deviceId]?.status || 'offline';
    }, [deviceStatuses]);

    const activeStatus = activeDeviceId
        ? (deviceStatuses[activeDeviceId]?.status || 'offline')
        : 'offline';

    // --- Fetch device list once per login session ---
    useEffect(() => {
        if (!isAuthenticated) {
            setDevices([]);
            setSelectedDevice('');
            setDevicesLoading(false);
            return;
        }
        setDevicesLoading(true);
        apiFetch('/api/devices')
            .then(r => r.ok ? r.json() : Promise.reject())
            .then(data => {
                setDevices(data);
                if (data.length > 0) setSelectedDevice(data[0].id.toString());
            })
            .catch(() => setDevices([]))
            .finally(() => setDevicesLoading(false));
    }, [isAuthenticated]);

    // --- Persistent socket: survives page navigation, resets only on device change ---
    useEffect(() => {
        if (!selectedDevice) return;

        setChartData(emptyChartData());
        setLiveTemp('--');
        setLiveHumidity('--');
        setLiveAqi('--');
        markDeviceOffline(selectedDevice);

        // Seed chart from DB so data is available immediately (covers reload too)
        apiFetch(`/api/devices/${selectedDevice}/readings?limit=${MAX_DATA_POINTS}`)
            .then(r => r.ok ? r.json() : null)
            .then(readings => {
                if (!readings) return;
                
                const loginTime = localStorage.getItem('loginTime');
                if (loginTime) {
                    const parsedLoginTime = parseInt(loginTime, 10);
                    readings = readings.filter(r => new Date(r.timestamp).getTime() >= parsedLoginTime);
                }

                if (readings.length === 0) return;

                const padLen = Math.max(0, MAX_DATA_POINTS - readings.length);
                const labels = [...Array(padLen).fill(''), ...readings.map(r => new Date(r.timestamp).toLocaleTimeString())].slice(-MAX_DATA_POINTS);
                const temps  = [...Array(padLen).fill(null),  ...readings.map(r => r.temperature)].slice(-MAX_DATA_POINTS);
                const hums   = [...Array(padLen).fill(null),  ...readings.map(r => r.humidity)].slice(-MAX_DATA_POINTS);
                const aqis   = [...Array(padLen).fill(null),  ...readings.map(r => r.aqi)].slice(-MAX_DATA_POINTS);
                setChartData(prev => ({
                    ...prev,
                    labels,
                    datasets: [
                        { ...prev.datasets[0], data: temps },
                        { ...prev.datasets[1], data: hums },
                        { ...prev.datasets[2], data: aqis }
                    ]
                }));
                const last = readings[readings.length - 1];
                setLiveTemp(Number(last.temperature).toFixed(1));
                setLiveHumidity(Math.round(Number(last.humidity)).toString());
                setLiveAqi(Math.round(Number(last.aqi)).toString());
            })
            .catch(() => {});

        const socket = io('/');
        socketRef.current = socket;

        socket.on('connect', () => {
            const token = localStorage.getItem('accessToken');
            if (token) socket.emit('authenticate', token);
            socket.emit('subscribe_device', selectedDevice);
        });

        socket.on('disconnect', () => markDeviceOffline(selectedDevice));

        socket.on('new_reading', (reading) => {
            if (reading.device_id.toString() !== selectedDevice.toString()) return;
            markDeviceOnline(selectedDevice, reading.source);
            setLiveTemp(Number(reading.temperature).toFixed(1));
            setLiveHumidity(Math.round(Number(reading.humidity)).toString());
            setLiveAqi(Math.round(Number(reading.aqi)).toString());
            setLiveUpdateKey(k => k + 1);

            setChartData(prev => {
                const labels = [...prev.labels];
                const temps  = [...prev.datasets[0].data];
                const hums   = [...prev.datasets[1].data];
                const aqis   = [...prev.datasets[2].data];

                labels.shift(); temps.shift(); hums.shift(); aqis.shift();

                labels.push(new Date(reading.timestamp || Date.now()).toLocaleTimeString());
                temps.push(reading.temperature);
                hums.push(reading.humidity);
                aqis.push(reading.aqi);

                return {
                    ...prev,
                    labels,
                    datasets: [
                        { ...prev.datasets[0], data: temps },
                        { ...prev.datasets[1], data: hums },
                        { ...prev.datasets[2], data: aqis }
                    ]
                };
            });
        });

        // Cleanup fires only on device change or final app unmount, NOT on page navigation
        return () => {
            socket.disconnect();
            markDeviceOffline(selectedDevice);
        };
    }, [selectedDevice]);

    return (
        <ConnectionContext.Provider value={{
            // Connection status
            deviceStatuses,
            activeDeviceId,
            setActiveDeviceId,
            activeStatus,
            markDeviceOnline,
            markDeviceOffline,
            getDeviceStatus,
            // Persistent dashboard data
            devices,
            selectedDevice,
            setSelectedDevice,
            devicesLoading,
            chartData,
            liveTemp,
            liveHumidity,
            liveAqi,
            liveUpdateKey,
        }}>
            {children}
        </ConnectionContext.Provider>
    );
}

export const useConnection = () => useContext(ConnectionContext);
