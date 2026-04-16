import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';

const AccountDropdown = () => {
    const { user, isAuthenticated, login, logout } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [tab, setTab] = useState('login'); // 'login' or 'register'
    
    const [loginEmail, setLoginEmail] = useState('user@example.com');
    const [loginPassword, setLoginPassword] = useState('User123!');
    const [loginError, setLoginError] = useState('');

    const [regName, setRegName] = useState('');
    const [regEmail, setRegEmail] = useState('');
    const [regPassword, setRegPassword] = useState('');
    const [regError, setRegError] = useState('');

    const dropdownRef = useRef(null);
    const avatarBtnRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (
                dropdownRef.current && 
                !dropdownRef.current.contains(event.target) &&
                avatarBtnRef.current && 
                !avatarBtnRef.current.contains(event.target)
            ) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleDropdown = () => {
        setIsOpen(!isOpen);
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoginError('');
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: loginEmail, password: loginPassword })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Login failed');

            login(data.accessToken, data.user);
            setIsOpen(false);
        } catch (err) {
            setLoginError(err.message);
        }
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        setRegError('');
        try {
            const payload = { name: regName, email: regEmail, password: regPassword };
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Registration failed');

            setLoginEmail(regEmail);
            setLoginPassword(regPassword);
            setTab('login');
            // optionally auto login
        } catch (err) {
            setRegError(err.message);
        }
    };

    return (
        <div style={{ position: 'relative' }}>
            <div 
                className="user-profile" 
                title="Account" 
                style={{ position: 'relative', zIndex: 100, cursor: 'pointer' }}
                onClick={toggleDropdown}
                ref={avatarBtnRef}
            >
                <div 
                    className="avatar" 
                    id="user-avatar" 
                    style={{ 
                        transition: 'transform 0.2s', 
                        marginRight: '1rem', 
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)', 
                        background: isAuthenticated ? 'var(--success-color)' : 'var(--text-muted)', 
                        color: 'white',
                        transform: isOpen ? 'scale(1.1)' : 'scale(1)'
                    }}
                >
                    {isAuthenticated && user?.name ? user.name.charAt(0).toUpperCase() : <i className="ph ph-user"></i>}
                </div>
            </div>

            <div 
                ref={dropdownRef}
                className={`account-dropdown ${isOpen ? 'active' : ''}`}
                style={{ 
                    position: 'absolute', 
                    top: '50px', 
                    right: '10px' 
                }}
            >
                {!isAuthenticated ? (
                    <div id="unauth-dropdown-view">
                        <div className="tab-group" style={{ display: 'flex', borderBottom: '1px solid #edf2f7', marginBottom: '1rem' }}>
                            <div className={`tab ${tab === 'login' ? 'active' : ''}`} onClick={() => setTab('login')} style={{ flex: 1, textAlign: 'center', padding: '1rem', cursor: 'pointer', fontWeight: 600, borderBottom: `2px solid ${tab === 'login' ? 'var(--primary-color)' : 'transparent'}`, color: tab === 'login' ? 'var(--primary-color)' : 'var(--text-muted)' }}>Login</div>
                            <div className={`tab ${tab === 'register' ? 'active' : ''}`} onClick={() => setTab('register')} style={{ flex: 1, textAlign: 'center', padding: '1rem', cursor: 'pointer', fontWeight: 600, borderBottom: `2px solid ${tab === 'register' ? 'var(--primary-color)' : 'transparent'}`, color: tab === 'register' ? 'var(--primary-color)' : 'var(--text-muted)' }}>Register</div>
                        </div>
                        
                        <div style={{ padding: '0 1.5rem 1.5rem' }}>
                            {tab === 'login' && (
                                <div id="login-form-view">
                                    {loginError && <div className="alert-box alert-error" style={{ padding: '0.5rem', marginBottom: '1rem', fontSize: '0.875rem' }}>{loginError}</div>}
                                    <form onSubmit={handleLogin}>
                                        <div className="form-group">
                                            <label style={{ fontSize: '0.875rem' }}>Email Address</label>
                                            <input type="email" required value={loginEmail} onChange={e => setLoginEmail(e.target.value)} />
                                        </div>
                                        <div className="form-group">
                                            <label style={{ fontSize: '0.875rem' }}>Password</label>
                                            <input type="password" required value={loginPassword} onChange={e => setLoginPassword(e.target.value)} />
                                        </div>
                                        <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>Sign In</button>
                                    </form>
                                </div>
                            )}

                            {tab === 'register' && (
                                <div id="register-form-view">
                                    {regError && <div className="alert-box alert-error" style={{ padding: '0.5rem', marginBottom: '1rem', fontSize: '0.875rem' }}>{regError}</div>}
                                    <form onSubmit={handleRegister}>
                                        <div className="form-group">
                                            <label style={{ fontSize: '0.875rem' }}>Full Name</label>
                                            <input type="text" required value={regName} onChange={e => setRegName(e.target.value)} />
                                        </div>
                                        <div className="form-group">
                                            <label style={{ fontSize: '0.875rem' }}>Email Address</label>
                                            <input type="email" required value={regEmail} onChange={e => setRegEmail(e.target.value)} />
                                        </div>
                                        <div className="form-group">
                                            <label style={{ fontSize: '0.875rem' }}>Password</label>
                                            <input type="password" required value={regPassword} onChange={e => setRegPassword(e.target.value)} />
                                        </div>
                                        <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>Create Account</button>
                                    </form>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div id="auth-dropdown-view">
                        <div style={{ padding: '1.5rem', borderBottom: '1px solid #edf2f7', textAlign: 'center' }}>
                            <div style={{ width: '48px', height: '48px', background: 'var(--success-color)', color: 'white', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', margin: '0 auto 0.5rem', fontWeight: 700 }}>
                                {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
                            </div>
                            <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{user?.name}</div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{user?.email}</div>
                        </div>
                        <div style={{ padding: '1rem' }}>
                            <Link to="/account" className="btn btn-outline" style={{ width: '100%', justifyContent: 'center', marginBottom: '0.5rem' }} onClick={() => setIsOpen(false)}>Edit Profile</Link>
                            <button className="btn btn-outline" style={{ width: '100%', justifyContent: 'center', color: 'var(--danger-color)' }} onClick={() => { logout(); setIsOpen(false); }}>
                                <i className="ph ph-sign-out"></i> Sign Out
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AccountDropdown;
