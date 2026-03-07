// templates/styles/interactive.js
export const interactive = `
/* ========== 按钮样式 ========== */
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

/* ========== 模态框样式 ========== */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.3);
    backdrop-filter: blur(4px);
    z-index: 100;
    display: none;
    align-items: center;
    justify-content: center;
}

.modal-content {
    background: white;
    border-radius: 32px;
    max-width: 400px;
    width: 90%;
    padding: 2rem;
    box-shadow: 0 30px 60px rgba(0,0,0,0.3);
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
}

.modal-header h3 {
    font-size: 1.4rem;
}

.modal-close {
    background: #f1f5f9;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: 0.2s;
}

.modal-close:hover {
    background: #e2e8f0;
}

.input-group {
    margin-bottom: 1.2rem;
}

.input-group label {
    display: block;
    font-weight: 500;
    margin-bottom: 0.3rem;
    color: #334155;
}

.input-group input {
    width: 100%;
    padding: 0.8rem 1rem;
    border: 1px solid #cbd5e1;
    border-radius: 60px;
    font-size: 1rem;
    outline: none;
    transition: 0.2s;
}

.input-group input:focus {
    border-color: #94a3b8;
    box-shadow: 0 0 0 2px #e2e8f0;
}

.modal-btn {
    background: #1e293b;
    color: white;
    border: none;
    border-radius: 60px;
    padding: 0.8rem;
    width: 100%;
    font-weight: 600;
    cursor: pointer;
    transition: 0.2s;
    margin-top: 0.5rem;
}

.modal-btn:hover {
    background: #0f172a;
}

/* ========== 悬浮窗样式 ========== */
.popup-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.3);
    backdrop-filter: blur(4px);
    z-index: 100;
    display: none;
    align-items: center;
    justify-content: center;
}

.popup-content {
    background: white;
    border-radius: 32px;
    max-width: 600px;
    width: 90%;
    max-height: 80vh;
    padding: 2rem;
    box-shadow: 0 30px 60px rgba(0,0,0,0.3);
    overflow-y: auto;
    position: relative;
}

.popup-close {
    position: absolute;
    top: 1rem;
    right: 1rem;
    background: #f1f5f9;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #475569;
    cursor: pointer;
    transition: 0.2s;
    font-size: 1.2rem;
    z-index: 101;
}

.popup-close:hover {
    background: #e2e8f0;
}

.popup-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding-right: 2rem;
    flex-wrap: wrap;
}

.popup-header h3 {
    font-size: 1.4rem;
    margin-right: auto;
}

.version-selector-sm {
    display: flex;
    align-items: center;
    background: #f1f5f9;
    border-radius: 40px;
    padding: 0.3rem 1rem 0.3rem 1.2rem;
    cursor: pointer;
    user-select: none;
    gap: 0.5rem;
    position: relative;
}

.version-selector-sm span {
    font-weight: 500;
}

.version-dropdown-sm {
    position: absolute;
    top: calc(100% + 5px);
    right: 0;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    box-shadow: 0 8px 16px rgba(0,0,0,0.1);
    z-index: 110;
    display: none;
    min-width: 130px;
}

.version-dropdown-sm.show {
    display: block;
}

.version-item-sm {
    padding: 0.5rem 1.2rem;
    cursor: pointer;
    transition: background 0.2s;
}

.version-item-sm:hover {
    background: #f1f5f9;
}

.version-item-sm.current {
    background: #e9f0ff;
    font-weight: 600;
}

.popup-releases-list {
    border: 1px solid #e2e8f0;
    border-radius: 20px;
    overflow: hidden;
    margin-top: 1rem;
}

.asset-row {
    display: flex;
    align-items: center;
    padding: 0.8rem 1.5rem;
    border-bottom: 1px solid #e2e8f0;
    background: white;
}

.asset-row:last-child {
    border-bottom: none;
}

.asset-name {
    flex: 1;
    font-weight: 500;
}

.asset-size {
    color: #64748b;
    font-size: 0.85rem;
    margin-right: 1rem;
}
`;