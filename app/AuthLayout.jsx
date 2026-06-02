import React from 'react';
import { Outlet } from 'react-router-dom';

export default function AuthLayout() {
    return (
        <div className="d-flex align-items-center justify-content-center vh-100"
             style={{ backgroundColor: '#0b1a2a' }}>
            <div style={{
                backgroundColor: '#1a3a5a',
                padding: '2rem',
                borderRadius: '12px',
                boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
                width: '100%',
                maxWidth: '420px',
                color: 'white',
                fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}>
                <Outlet />
            </div>
        </div>
    );
}
