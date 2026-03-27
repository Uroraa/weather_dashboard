const MAX_DATA_POINTS = 30;

// DOM
const deviceSelector = document.getElementById('device-selector');
const dashboardContent = document.getElementById('dashboard-content');
const noDeviceMsg = document.getElementById('no-device-msg');
const tempValueEl = document.getElementById('temp-value');
const humValueEl = document.getElementById('hum-value');
const globalStatusDot = document.getElementById('global-status-dot');
const globalStatusText = document.getElementById('global-status-text');

let currentDeviceId = null;
let socket = null;
let sensorChart = null;
let offlineTimer = null;

function setOfflineTimer() {
    if (offlineTimer) clearTimeout(offlineTimer);
    offlineTimer = setTimeout(() => {
        updateConnectionStatus('offline');
    }, 60000); // 60s
}

// Initialize Chart.js exactly like the design spec required
function initChart() {
    const ctx = document.getElementById('sensorChart').getContext('2d');
    sensorChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array(MAX_DATA_POINTS).fill(''),
            datasets: [
                {
                    label: 'Temperature (°C)',
                    data: [],
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
                    data: [],
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
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        font: { family: "'Inter', sans-serif", weight: '500' }
                    }
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
            animation: {
                duration: 400,
                easing: 'easeOutQuart'
            }
        }
    });
}

function updateConnectionStatus(status) {
    if (status === 'online') {
        globalStatusDot.className = 'status-dot live';
        globalStatusDot.style.backgroundColor = ''; // Remove any inline override
        globalStatusText.innerText = 'Live connected';
    } else if (status === 'offline') {
        globalStatusDot.className = 'status-dot';
        globalStatusDot.style.backgroundColor = '#a0aec0'; // Gray dot
        globalStatusText.innerText = 'Offline';
    } else {
        globalStatusDot.className = 'status-dot';
        globalStatusDot.style.backgroundColor = '';
        globalStatusText.innerText = 'Disconnected';
    }
}

function animateValueChange(element, newValue, isFloat = false) {
    if(!element) return;
    const formattedValue = isFloat ? Number(newValue).toFixed(1) : Math.round(Number(newValue));
    if (element.innerText !== formattedValue.toString()) {
        element.innerText = formattedValue;
        
        // Retrigger CSS animation
        const wrapper = element.parentElement;
        wrapper.classList.remove('value-update');
        void wrapper.offsetWidth; 
        wrapper.classList.add('value-update');
    }
}

async function loadDevices() {
    if (!Auth.isAuthenticated()) {
        dashboardContent.style.display = 'none';
        noDeviceMsg.innerHTML = '<p class="text-danger"><i class="ph ph-warning-circle"></i> Please log in to view dashboard data.</p>';
        noDeviceMsg.style.display = 'block';
        deviceSelector.disabled = true;
        return;
    }

    try {
        const res = await apiFetch('/api/devices');
        if (!res.ok) throw new Error('Failed to load devices');
        const devices = await res.json();
        
        deviceSelector.innerHTML = '';
        if (devices.length === 0) {
            deviceSelector.innerHTML = '<option value="">No devices found</option>';
            deviceSelector.disabled = true;
            return;
        }

        devices.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id;
            opt.innerText = d.name;
            deviceSelector.appendChild(opt);
        });

        deviceSelector.disabled = false;
        
        // Auto select first device
        deviceSelector.value = devices[0].id;
        onDeviceSelected(devices[0].id);
        
    } catch (e) {
        console.error(e);
        deviceSelector.innerHTML = '<option value="">Error loading</option>';
    }
}

async function loadDeviceData(deviceId) {
    try {
        // Fetch 30 past readings
        const res = await apiFetch(`/api/devices/${deviceId}/readings?limit=${MAX_DATA_POINTS}`);
        if (!res.ok) throw new Error('Data fetch failed');
        
        const data = await res.json();
        
        if (data.length > 0) {
            const latest = data[data.length - 1];
            animateValueChange(tempValueEl, latest.temperature, true);
            animateValueChange(humValueEl, latest.humidity, false);

            if (Date.now() - new Date(latest.timestamp).getTime() < 60000) {
                updateConnectionStatus('online');
                setOfflineTimer();
            } else {
                updateConnectionStatus('offline');
            }

            const labels = [];
            const temps = [];
            const hums = [];

            // Pad the start
            const padCount = MAX_DATA_POINTS - data.length;
            for(let i=0; i<padCount; i++) {
                labels.push(''); temps.push(null); hums.push(null);
            }

            data.forEach(d => {
                const date = new Date(d.timestamp);
                labels.push(date.toLocaleTimeString());
                temps.push(d.temperature);
                hums.push(d.humidity);
            });

            sensorChart.data.labels = labels;
            sensorChart.data.datasets[0].data = temps;
            sensorChart.data.datasets[1].data = hums;
            sensorChart.update();
        } else {
            // Reset if no data
            tempValueEl.innerText = '--';
            humValueEl.innerText = '--';
            sensorChart.data.labels = Array(MAX_DATA_POINTS).fill('');
            sensorChart.data.datasets[0].data = [];
            sensorChart.data.datasets[1].data = [];
            sensorChart.update();
        }
    } catch (e) {
        console.error(e);
    }
}

function setupSocket(deviceId) {
    if (!socket) {
        socket = io();
        
        socket.on('connect', () => {
            updateConnectionStatus(true);
            const token = Auth.getToken();
            if (token) {
                socket.emit('authenticate', token);
            }
            if (currentDeviceId) {
                socket.emit('subscribe_device', currentDeviceId);
            }
            console.log('Socket connected');
        });

        socket.on('disconnect', () => {
            updateConnectionStatus('disconnected');
        });

        // Listen for new readings targeted at this device
        socket.on('new_reading', (reading) => {
            if (reading.device_id.toString() !== currentDeviceId.toString()) return;
            
            // Re-affirm live status since real data arrived
            updateConnectionStatus('online');
            setOfflineTimer();

            animateValueChange(tempValueEl, reading.temperature, true);
            animateValueChange(humValueEl, reading.humidity, false);

            const date = new Date(reading.timestamp || Date.now());
            
            // Shift chart data
            const labels = sensorChart.data.labels;
            const temps = sensorChart.data.datasets[0].data;
            const hums = sensorChart.data.datasets[1].data;

            labels.shift();
            temps.shift();
            hums.shift();

            labels.push(date.toLocaleTimeString());
            temps.push(reading.temperature);
            hums.push(reading.humidity);

            sensorChart.update();
        });
        
        socket.on('new_alert', (alertObj) => {
            console.warn('Realtime alert received:', alertObj);
            // Optionally show a toast here in v2
            alert(`⚠️ New Alert from ${alertObj.device_name}: ${alertObj.message}`);
        });
    } else {
        if (currentDeviceId && currentDeviceId !== deviceId) {
            socket.emit('unsubscribe_device', currentDeviceId);
        }
        if (deviceId) {
            socket.emit('subscribe_device', deviceId);
        }
    }
}

function onDeviceSelected(deviceId) {
    currentDeviceId = deviceId;
    
    if (deviceId) {
        dashboardContent.style.display = 'block';
        noDeviceMsg.style.display = 'none';
        
        loadDeviceData(deviceId);
        setupSocket(deviceId);
    } else {
        dashboardContent.style.display = 'none';
        noDeviceMsg.style.display = 'block';
        if (socket && currentDeviceId) {
            socket.emit('unsubscribe_device', currentDeviceId);
        }
    }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    initChart();
    
    deviceSelector.addEventListener('change', (e) => {
        onDeviceSelected(e.target.value);
    });

    loadDevices().then(() => {
        // If still no devices after load, verify UI state
        if (!currentDeviceId) {
            dashboardContent.style.display = 'none';
            noDeviceMsg.style.display = 'block';
        }
    });
});
