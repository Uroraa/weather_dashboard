import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ConnectionProvider } from './context/ConnectionContext';
import Layout from './components/Layout';
// Import pages (we will create them next)
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import DeviceDetails from './pages/DeviceDetails';
import Alerts from './pages/Alerts';
import Forecast from './pages/Forecast';
import Rooms from './pages/Rooms';
import Admin from './pages/Admin';
import Account from './pages/Account';

function App() {
  return (
    <AuthProvider>
      <ConnectionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="devices" element={<Devices />} />
            <Route path="device" element={<DeviceDetails />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="forecast" element={<Forecast />} />
            <Route path="rooms" element={<Rooms />} />
            <Route path="admin" element={<Admin />} />
            <Route path="account" element={<Account />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </ConnectionProvider>
    </AuthProvider>
  );
}

export default App;
