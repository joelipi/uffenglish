import React from 'react';
import { Outlet } from 'react-router-dom';
import headerLogo from '../assets/img/uff-logo.png';

export default function AuthLayout() {
    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#0b1a2a', overflowY: 'auto' }}>
            <header
                style={{
                    background: 'linear-gradient(135deg, #3a8fd5 0%, #00c0d8 100%)',
                    padding: '0.75rem 1rem',
                    textAlign: 'center',
                    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.35)',
                }}
            >
                <img
                    src={headerLogo}
                    alt="UFF"
                    style={{ height: 'auto', width: 'auto', maxHeight: 40, maxWidth: '50vw', display: 'inline-block' }}
                />
            </header>
            <div className="d-flex align-items-center justify-content-center" style={{ padding: '2rem 1rem' }}>
                <div style={{
                    backgroundColor: '#1a3a5a',
                    padding: '2rem',
                    borderRadius: '12px',
                    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
                    width: '100%',
                    maxWidth: '420px',
                    color: 'white',
                    fontFamily: 'var(--font-body)',
                }}>
                    <Outlet />
                </div>
            </div>
        </div>
    );
}
