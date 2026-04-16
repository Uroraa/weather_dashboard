import React, { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AccountDropdown from './AccountDropdown';

const Layout = () => {
    const { user, isAuthenticated } = useAuth();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const location = useLocation();

    const getPageTitle = () => {
        switch (location.pathname) {
            case '/': return 'Dashboard';
            case '/devices': return 'Devices';
            case '/device': return 'Device Details';
            case '/alerts': return 'Alerts';
            case '/forecast': return 'Forecast';
            case '/admin': return 'Admin Portal';
            case '/account': return 'Account Management';
            default: return 'IoT Monitor';
        }
    };

    return (
        <div className="app-layout">
            <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} id="sidebar">
                <div className="sidebar-header">
                    <i className="ph-fill ph-cpu"></i>
                    <span>IoT Monitor</span>
                </div>
                
                <nav className="sidebar-nav">
                    <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end>
                        <i className="ph ph-squares-four"></i>
                        <span>Dashboard</span>
                    </NavLink>
                    <NavLink to="/devices" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <i className="ph ph-devices"></i>
                        <span>Devices</span>
                    </NavLink>
                    <NavLink to="/alerts" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <i className="ph ph-bell-ringing"></i>
                        <span>Alerts</span>
                    </NavLink>
                    <NavLink to="/forecast" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <i className="ph ph-cloud-sun"></i>
                        <span>Forecast</span>
                    </NavLink>
                    
                    {isAuthenticated && user?.role === 'admin' && (
                        <NavLink to="/admin" className={({ isActive }) => `nav-item admin-nav ${isActive ? 'active' : ''}`} id="admin-nav">
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
                        <div className="status-indicator">
                            {/* We will leave status updates to individual pages via a context or globally later. For now let's just make it a placeholder or simple prop from Outlet context */}
                            <span className="status-dot" id="global-status-dot"></span>
                            <span id="global-status-text">Ready</span>
                        </div>
                    </div>
                    
                    <div className="topbar-right">
                        <AccountDropdown />
                    </div>
                </header>

                <main className="content">
                    <div className="page-header">
                        <h1 className="page-title">{getPageTitle()}</h1>
                        
                        {/* the device selector is only for dashboard usually. We can define an Outlet context to pass it back up, but for identical UI it's easier to put the selector INSIDE the page components so Layout is generic. In index.html the device selector is in the content wrapper. */}
                    </div>
                    
                    {/* Render page content */}
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default Layout;
