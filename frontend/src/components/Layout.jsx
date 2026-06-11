import React, { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useConnection } from '../context/ConnectionContext';
import AccountDropdown from './AccountDropdown';

const STATUS_CONFIG = {
    online:  { label: 'Live Connected', dotClass: 'live',    textColor: 'var(--success-color)' },
    offline: { label: 'Offline',        dotClass: 'offline', textColor: '#fc8181' },
};

const PAGES_WITH_STATUS = ['/', '/forecast'];

const Layout = () => {
    const { user, isAuthenticated } = useAuth();
    const { activeStatus } = useConnection();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const location = useLocation();

    const showStatus = PAGES_WITH_STATUS.includes(location.pathname);
    const { label, dotClass, textColor } = STATUS_CONFIG[activeStatus] || STATUS_CONFIG.offline;

    const closeSidebar = () => {
        setSidebarOpen(false);
    };

    const getPageTitle = () => {
        switch (location.pathname) {
            case '/': return 'Dashboard';
            case '/devices': return 'Devices';
            case '/device': return 'Device Details';
            case '/alerts': return 'Alerts';
            case '/forecast': return 'Forecast';
            case '/rooms': return 'Rooms Management';
            case '/admin': return 'Admin Portal';
            case '/account': return 'Account Management';
            default: return 'EMF System';
        }
    };

    return (
        <div className="app-layout">
            {sidebarOpen && <div className="sidebar-overlay" onClick={closeSidebar}></div>}
            <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} id="sidebar">
                <div className="sidebar-header">
                    <i className="ph-fill ph-cpu"></i>
                    <span>EMF System</span>
                </div>

                <nav className="sidebar-nav">
                    <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end onClick={closeSidebar}>
                        <i className="ph ph-squares-four"></i>
                        <span>Dashboard</span>
                    </NavLink>
                    <NavLink to="/devices" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeSidebar}>
                        <i className="ph ph-devices"></i>
                        <span>Devices</span>
                    </NavLink>
                    <NavLink to="/alerts" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeSidebar}>
                        <i className="ph ph-bell-ringing"></i>
                        <span>Alerts</span>
                    </NavLink>
                    <NavLink to="/forecast" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeSidebar}>
                        <i className="ph ph-cloud-sun"></i>
                        <span>Forecast</span>
                    </NavLink>
                    <NavLink to="/rooms" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeSidebar}>
                        <i className="ph ph-house"></i>
                        <span>Rooms</span>
                    </NavLink>

                    {isAuthenticated && user?.role === 'admin' && (
                        <NavLink to="/admin" className={({ isActive }) => `nav-item admin-nav ${isActive ? 'active' : ''}`} id="admin-nav" onClick={closeSidebar}>
                            <i className="ph ph-shield-check"></i>
                            <span>Admin Portal</span>
                        </NavLink>
                    )}
                </nav>
            </aside>

            <div className="main-wrapper">
                <header className="topbar">
                    <div className="topbar-left">
                        <button className="menu-toggle" id="menu-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
                            <i className="ph ph-list"></i>
                        </button>
                        {location.pathname === '/device' ? (
                            <Link to="/devices" className="btn btn-outline" style={{ padding: '0.35rem 0.75rem', background: 'white' }}>
                                <i className="ph ph-arrow-left"></i> <span>Back</span>
                            </Link>
                        ) : showStatus && (
                            <div className="status-indicator">
                                <span className={`status-dot ${dotClass}`}></span>
                                <span style={{ color: textColor, transition: 'color 0.3s ease' }}>{label}</span>
                            </div>
                        )}
                    </div>

                    <div className="topbar-right">
                        <AccountDropdown />
                    </div>
                </header>

                <main className="content">
                    <div className="page-header">
                        <h1 className="page-title">{getPageTitle()}</h1>
                    </div>

                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default Layout;
