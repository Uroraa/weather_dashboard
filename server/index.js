const express = require('express');
const path = require('path');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const db = require('./models/db');
const alertService = require('./services/alertService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Attach io and services to app so routes can use them
app.set('io', io);
app.set('alertService', alertService);

// Load Routes
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const devicesRoutes = require('./routes/devices');
const dataRoutes = require('./routes/data');
const alertsRoutes = require('./routes/alerts');

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/alerts', alertsRoutes);

// Socket.io Real-time connections
io.on('connection', (socket) => {
    console.log(`[Socket] User connected: ${socket.id}`);
    
    // Clients must emit "authenticate" with their JWT to join their private rooms
    socket.on('authenticate', (token) => {
        const jwt = require('jsonwebtoken');
        jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
            if (err) {
                socket.emit('auth_error', 'Invalid token');
                return;
            }
            
            socket.join(`user_${user.id}`);
            if (user.role === 'admin') {
                socket.join('admins');
            }
            console.log(`[Socket] Socket ${socket.id} authenticated as user ${user.id}`);
        });
    });

    // Public dashboard clients can just subscribe to a device room directly for v1
    socket.on('subscribe_device', (deviceId) => {
        socket.join(`device_${deviceId}`);
        console.log(`[Socket] Socket ${socket.id} subscribed to device_${deviceId}`);
    });
    
    socket.on('unsubscribe_device', (deviceId) => {
        socket.leave(`device_${deviceId}`);
    });

    socket.on('disconnect', () => {
        console.log(`[Socket] User disconnected: ${socket.id}`);
    });
});

const mqttService = require('./services/mqttService');

// Start Local MQTT Broker
mqttService.initMqtt(io, alertService);

// Start the server
// SPA Fallback for generic GET routes (make sure to define this AFTER API routes)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
