// templates/styles/admin.js
export const admin = `
.admin-panel {
    display: none;
}

.admin-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
}

.admin-panel .section-title {
    font-size: 1.4rem;
    font-weight: 600;
    margin-bottom: 0;
    color: #0f172a;
}

.back-home-btn {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 40px;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: 0.2s;
    color: #1e293b;
    font-size: 1rem;
}

.back-home-btn:hover {
    background: #e2e8f0;
}

.admin-panel .card {
    background: white;
    border-radius: 24px;
    border: 1px solid #e2e8f0;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
    box-shadow: 0 4px 12px rgba(0,0,0,0.02);
}

.admin-panel .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    position: relative;
}

.admin-panel .card-header h2 {
    font-size: 1.2rem;
    font-weight: 600;
}

.admin-panel .search-box {
    max-width: 600px;
}

.admin-panel .mode-toggle {
    background: transparent;
    border: none;
    border-right: 1px solid #cbd5e1;
    padding: 0 1.2rem 0 1.5rem;
    font-weight: 600;
    font-size: 0.95rem;
    color: #1e293b;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
    white-space: nowrap;
}

.admin-panel .mode-toggle i {
    font-size: 0.8rem;
    color: #64748b;
}

.admin-panel .monitor-row {
    display: flex;
    align-items: center;
    gap: 2rem;
    flex-wrap: wrap;
    margin: 1rem 0;
}

.admin-panel .toggle-switch {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.admin-panel .switch {
    position: relative;
    display: inline-block;
    width: 52px;
    height: 28px;
}

.admin-panel .switch input {
    opacity: 0;
    width: 0;
    height: 0;
}

.admin-panel .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #cbd5e1;
    transition: .3s;
    border-radius: 34px;
}

.admin-panel .slider:before {
    position: absolute;
    content: "";
    height: 22px;
    width: 22px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: .3s;
    border-radius: 50%;
}

.admin-panel input:checked + .slider {
    background-color: #1e293b;
}

.admin-panel input:checked + .slider:before {
    transform: translateX(24px);
}

.admin-panel .radio-group {
    display: flex;
    gap: 1rem;
    align-items: center;
}

.admin-panel .radio-group label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    cursor: pointer;
}

.admin-panel .custom-project-trigger {
    background: #f1f5f9;
    border: none;
    border-radius: 40px;
    padding: 0.4rem 1.2rem;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
}

.admin-panel .days-input {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.admin-panel .days-input input {
    width: 70px;
    padding: 0.5rem;
    border: 1px solid #cbd5e1;
    border-radius: 40px;
    text-align: center;
}

.admin-panel .json-editor {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 20px;
    padding: 1rem;
    font-family: monospace;
    font-size: 0.9rem;
    margin: 1rem 0;
    white-space: pre-wrap;
}

.admin-panel .bucket-list {
    margin: 1.5rem 0;
    border: 1px solid #e2e8f0;
    border-radius: 20px;
    overflow: hidden;
}

.admin-panel .bucket-item {
    display: grid;
    grid-template-columns: 1.5fr 1fr 2fr;
    align-items: center;
    padding: 0.8rem 1.2rem;
    border-bottom: 1px solid #e2e8f0;
    background: white;
    font-size: 0.9rem;
}

.admin-panel .bucket-item:last-child {
    border-bottom: none;
}

.admin-panel .bucket-item.header {
    background: #f8fafc;
    font-weight: 600;
    color: #475569;
}

.admin-panel .bucket-usage {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.admin-panel .progress {
    flex: 1;
    height: 8px;
    background: #e2e8f0;
    border-radius: 40px;
    overflow: hidden;
}

.admin-panel .progress-fill {
    height: 100%;
    background: #1e293b;
}

.admin-panel .checkbox-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.5rem 0;
}

.admin-panel .hostname-row {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin: 1rem 0;
}

.admin-panel .hostname-input {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
}

.admin-panel .hostname-input label {
    min-width: 150px;
    font-weight: 500;
}

.admin-panel .hostname-input input {
    flex: 1;
    padding: 0.7rem 1rem;
    border: 1px solid #cbd5e1;
    border-radius: 60px;
    outline: none;
}

.admin-panel .project-list {
    max-height: 300px;
    overflow-y: auto;
    margin: 1rem 0;
    border: 1px solid #e2e8f0;
    border-radius: 20px;
    padding: 0.5rem;
}

.admin-panel .project-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
}

.admin-panel .project-item:hover {
    background: #f8fafc;
    border-radius: 40px;
}

/* 后台搜索结果区域 - 滚动容器 */
.search-result-area {
    margin-top: 1.5rem;
    border-top: 1px solid #e2e8f0;
    padding-top: 1.5rem;
}

.search-results-scroll {
    max-height: 250px;
    overflow-y: auto;
    padding-right: 0.5rem;
}

.search-result-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #f8fafc;
    border-radius: 60px;
    padding: 0.6rem 1rem;
    margin-bottom: 0.8rem;
}

.bucket-select {
    background: white;
    border: 1px solid #cbd5e1;
    border-radius: 40px;
    padding: 0.3rem 1rem;
    margin: 0 0.5rem;
    outline: none;
}

.save-btn {
    background: #1e293b;
    color: white;
    border: none;
    border-radius: 40px;
    padding: 0.3rem 1.2rem;
    font-weight: 500;
    cursor: pointer;
}

.save-btn:hover {
    background: #0f172a;
}
`;