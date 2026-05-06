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
        markDeviceOffline(selectedDevice);

        // Seed chart from DB so data is available immediately (covers reload too)
        apiFetch(`/api/devices/${selectedDevice}/readings?limit=${MAX_DATA_POINTS}`)
            .then(r => r.ok ? r.json() : null)
            .then(readings => {
                if (!readings || readings.length === 0) return;
                const padLen = MAX_DATA_POINTS - readings.length;
                const labels = [...Array(padLen).fill(''), ...readings.map(r => new Date(r.timestamp).toLocaleTimeString())];
                const temps  = [...Array(padLen).fill(null),  ...readings.map(r => r.temperature)];
                const hums   = [...Array(padLen).fill(null),  ...readings.map(r => r.humidity)];
                setChartData(prev => ({
                    ...prev,
                    labels,
                    datasets: [
                        { ...prev.datasets[0], data: temps },
                        { ...prev.datasets[1], data: hums }
                    ]
                }));
                const last = readings[readings.length - 1];
                setLiveTemp(Number(last.temperature).toFixed(1));
                setLiveHumidity(Math.round(Number(last.humidity)).toString());
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
            setLiveUpdateKey(k => k + 1);

            setChartData(prev => {
                const labels = [...prev.labels];
                const temps  = [...prev.datasets[0].data];
                const hums   = [...prev.datasets[1].data];

                labels.shift(); temps.shift(); hums.shift();

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
            liveUpdateKey,
        }}>
            {children}
        </ConnectionContext.Provider>
    );
}

export const useConnection = () => useContext(ConnectionContext);
