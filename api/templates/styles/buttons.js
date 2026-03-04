// templates/styles/buttons.js
export const buttons = `
/* 登录按钮 / 用户下拉 */
.login-btn, .user-menu-btn {
    background: white;
    border: 1px solid #cbd5e1;
    padding: 0.5rem 1.2rem;
    border-radius: 40px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    transition: 0.2s;
    position: relative;
}

.login-btn:hover, .user-menu-btn:hover {
    background: #f1f5f9;
}

.user-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 20px;
    box-shadow: 0 12px 24px -8px rgba(0,0,0,0.15);
    padding: 0.5rem 0;
    min-width: 160px;
    z-index: 20;
    display: none;
}

.user-dropdown.show {
    display: block;
}

.dropdown-item {
    padding: 0.6rem 1.5rem;
    font-size: 0.95rem;
    color: #334155;
    cursor: pointer;
    transition: background 0.2s;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.dropdown-item:hover {
    background: #f1f5f9;
}

.dropdown-item i {
    width: 20px;
    color: #64748b;
}

.btn-icon {
    background: #f1f5f9;
    border: none;
    border-radius: 40px;
    padding: 0.4rem 1rem;
    font-size: 0.9rem;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
    transition: 0.2s;
    color: #1e293b;
}

.btn-icon i {
    font-size: 0.9rem;
}

.btn-icon:hover {
    background: #e2e8f0;
}

.btn-download {
    background: #e9f0ff;
    color: #1e4f8a;
}

.btn-download:hover {
    background: #d4e2fc;
}

.btn-release {
    background: #e6f7e6;
    color: #166534;
}

.btn-stream {
    background: #f1e6ff;
    color: #6b21a8;
}

.btn-stream i {
    color: #7e22ce;
}

.back-home-btn {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 40px;
    padding: 0.5rem 1.2rem;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    transition: 0.2s;
}

.back-home-btn:hover {
    background: #e2e8f0;
}

.btn-danger {
    background: #dc2626;
    color: white;
    border: none;
}

.btn-danger:hover {
    background: #b91c1c;
}

.btn-danger i {
    color: white;
}
`;