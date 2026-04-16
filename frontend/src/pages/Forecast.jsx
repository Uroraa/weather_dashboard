import React from 'react';

export default function Forecast() {
    return (
        <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem', maxWidth: '600px', margin: '2rem auto' }}>
            <i className="ph ph-robot" style={{ fontSize: '5rem', color: 'var(--primary-color)', marginBottom: '1rem' }}></i>
            <h2 style={{ marginBottom: '1rem', color: 'var(--text-main)' }}>AI Forecasting Model</h2>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '2rem' }}>
                This module is currently in development. Future updates will allow you to plug in an ML model to predict temperature and humidity trends based on your historical sensor data.
            </p>
            
            <div style={{ border: '2px dashed #cbd5e0', padding: '2rem', borderRadius: '1rem', background: '#f7fafc' }}>
                <i className="ph ph-upload-simple" style={{ fontSize: '2rem', color: '#a0aec0', marginBottom: '0.5rem' }}></i>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Model Upload Area (Coming Soon)</p>
            </div>
        </div>
    );
}
