import React, { useState, useEffect } from 'react';
import { appStore } from '../modules/store';

/**
 * React transition for ui.js
 * This component acts as the main UI shell/container, managing modals,
 * navbars, sidebars, and global toast notifications.
 */
export default function UI({ children }) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [activeModal, setActiveModal] = useState(null);
    const [toastMessage, setToastMessage] = useState(null);

    // Subscribe to store for global state changes
    const isTextMode = appStore((state) => state.isTextMode);
    const userFirstName = appStore((state) => state.userFirstName);

    const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

    const openModal = (modalName) => setActiveModal(modalName);
    const closeModal = () => setActiveModal(null);

    const showToast = (message, duration = 3000) => {
        setToastMessage(message);
        setTimeout(() => setToastMessage(null), duration);
    };

    // Global keyboard listener for closing modals (Escape key)
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                setSidebarOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    return (
        <div className={`app-ui-wrapper ${isTextMode ? 'text-mode-active' : ''}`}>

            {/* Navbar */}
            <nav className="navbar navbar-dark bg-dark px-3 py-2 shadow-sm d-flex justify-content-between align-items-center">
                <div className="d-flex align-items-center">
                    <button className="btn btn-outline-light me-3" onClick={toggleSidebar}>
                        <i className="bi bi-list fs-4"></i>
                    </button>
                    <span className="navbar-brand mb-0 h1 fw-bold text-info">UFF English</span>
                </div>

                <div className="user-profile d-flex align-items-center text-white">
                    <span className="me-2 d-none d-md-inline">
                        {userFirstName ? `Hi, ${userFirstName}` : 'Guest User'}
                    </span>
                    <div className="rounded-circle bg-secondary d-flex justify-content-center align-items-center cursor-pointer" style={{ width: '40px', height: '40px' }} onClick={() => openModal('profile')}>
                        <i className="bi bi-person-fill fs-5"></i>
                    </div>
                </div>
            </nav>

            {/* Sidebar Overlay */}
            {sidebarOpen && (
                <div className="sidebar-overlay position-fixed top-0 start-0 w-100 h-100 bg-dark bg-opacity-50 z-2" onClick={toggleSidebar}></div>
            )}

            {/* Sidebar */}
            <div className={`sidebar bg-light position-fixed top-0 bottom-0 start-0 z-3 transition-transform ${sidebarOpen ? 'translate-middle-x-0' : 'translate-middle-x-n100'}`} style={{ width: '250px', transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform 0.3s ease-in-out' }}>
                <div className="p-4">
                    <div className="d-flex justify-content-between align-items-center mb-4 border-bottom pb-2">
                        <h4 className="m-0">Menu</h4>
                        <button className="btn-close" onClick={toggleSidebar}></button>
                    </div>
                    <ul className="list-unstyled">
                        <li className="mb-3"><a href="#" className="text-decoration-none text-dark fs-5"><i className="bi bi-house-door me-2"></i> Home</a></li>
                        <li className="mb-3"><a href="#" className="text-decoration-none text-dark fs-5"><i className="bi bi-book me-2"></i> Courses</a></li>
                        <li className="mb-3"><a href="#" className="text-decoration-none text-dark fs-5"><i className="bi bi-gear me-2"></i> Settings</a></li>
                    </ul>
                </div>
            </div>

            {/* Main Content Area */}
            <main className="main-content container-fluid p-0">
                {children}
            </main>

            {/* Global Modals */}
            {activeModal === 'profile' && (
                <div className="modal d-block bg-dark bg-opacity-75 z-index-master">
                    <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5 className="modal-title">User Profile</h5>
                                <button type="button" className="btn-close" onClick={closeModal}></button>
                            </div>
                            <div className="modal-body text-center p-4">
                                <i className="bi bi-person-circle display-1 text-secondary mb-3"></i>
                                <h3>{userFirstName || 'Guest'}</h3>
                                <p className="text-muted">Manage your settings and progress.</p>
                                <button className="btn btn-primary w-100 mt-3" onClick={() => { closeModal(); showToast('Settings opened'); }}>Settings</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Global Toast Notification */}
            {toastMessage && (
                <div className="position-fixed bottom-0 end-0 p-3 z-3">
                    <div className="toast show align-items-center text-white bg-primary border-0" role="alert" aria-live="assertive" aria-atomic="true">
                        <div className="d-flex">
                            <div className="toast-body">
                                {toastMessage}
                            </div>
                            <button type="button" className="btn-close btn-close-white me-2 m-auto" onClick={() => setToastMessage(null)}></button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
