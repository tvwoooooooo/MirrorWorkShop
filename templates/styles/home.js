// templates/styles/home.js
export const home = `
/* ========== 标签页 ========== */
.tabs {
    display: flex;
    gap: 0.25rem;
    background: #e9eef2;
    padding: 0.25rem;
    border-radius: 40px;
    width: fit-content;
    margin-bottom: 2rem;
}

.tab-item {
    padding: 0.5rem 1.8rem;
    border-radius: 40px;
    font-weight: 600;
    cursor: pointer;
    transition: 0.2s;
    user-select: none;
}

.tab-item.active {
    background: white;
    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    color: #1e293b;
}

/* ========== 搜索框 ========== */
.search-section {
    margin-bottom: 2rem;
}

.search-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
}

.search-box {
    flex: 1;
    display: flex;
    background: white;
    border: 1px solid #cbd5e1;
    border-radius: 60px;
    overflow: hidden;
    box-shadow: 0 4px 6px -2px rgba(0,0,0,0.02);
}

.mode-toggle-btn {
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
    transition: background 0.2s;
}

.mode-toggle-btn i {
    font-size: 0.8rem;
    color: #64748b;
}

.mode-toggle-btn:hover {
    background-color: #f1f5f9;
}

.search-box input {
    flex: 1;
    border: none;
    padding: 0.8rem 1rem;
    font-size: 1rem;
    outline: none;
    background: transparent;
}

.search-btn {
    background: #1e293b;
    color: white;
    border: none;
    width: 56px;
    cursor: pointer;
    font-size: 1.2rem;
    transition: 0.2s;
}

.search-btn:hover {
    background: #0f172a;
}

/* ========== 卡片样式 ========== */
/* 官网搜索结果卡片 */
.official-result-card {
    background: #fef9e7;
    border: 1px solid #fde68a;
    border-radius: 24px;
    padding: 1.5rem;
    margin-bottom: 2rem;
    box-shadow: 0 8px 20px rgba(251, 191, 36, 0.1);
}

.official-badge {
    background: #fbbf24;
    color: #0f172a;
    font-size: 0.8rem;
    font-weight: 700;
    padding: 0.2rem 0.9rem;
    border-radius: 30px;
    letter-spacing: 0.3px;
    display: inline-block;
    margin-bottom: 0.6rem;
}

.official-results-list {
    max-height: 400px;
    overflow-y: auto;
    padding-right: 0.5rem;
    position: relative;
}

.official-result-item {
    position: relative;
    overflow: hidden;
    background: #fef9e7;
    border-radius: 20px;
    padding: 1rem 1.2rem;
    margin-bottom: 0.8rem;
    border: 1px solid #fde68a;
    transition: 0.2s;
}

.official-result-item:hover {
    border-color: #fbbf24;
    box-shadow: 0 4px 12px rgba(251, 191, 36, 0.2);
}

.official-result-item .card-bg-icon {
    position: absolute;
    right: 0;
    bottom: 0;
    font-size: 6rem;
    opacity: 0.08;
    z-index: 0;
    pointer-events: none;
    color: #1e293b;
    transform: rotate(-5deg);
}

.official-item-header {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    margin-bottom: 0.3rem;
    position: relative;
    z-index: 1;
    gap: 0.5rem;
    flex-wrap: wrap;
}

.official-item-name {
    font-weight: 700;
    font-size: 1.1rem;
    color: #1e293b;
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 40%;
    flex-shrink: 1;
}

.official-item-name:hover {
    text-decoration: underline;
    color: #2563eb;
}

.official-item-stats {
    display: flex;
    gap: 0.8rem;
    color: #475569;
    font-size: 0.85rem;
    flex-shrink: 0;
    margin-left: 0;
}

.official-item-lastupdate {
    color: #64748b;
    font-size: 0.8rem;
    white-space: nowrap;
    flex-shrink: 0;
    margin-left: auto;
}

.official-item-description {
    color: #475569;
    font-size: 0.9rem;
    margin: 0.3rem 0 0.5rem 0;
    position: relative;
    z-index: 1;
}

.official-item-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.5rem;
    position: relative;
    z-index: 1;
}

/* 项目卡片（存储库） */
.projects-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1.5rem;
}

.project-card {
    position: relative;
    overflow: hidden;
    background: white;
    border-radius: 24px;
    padding: 1.3rem 1.5rem 1.5rem 1.5rem;
    box-shadow: 0 4px 12px rgba(0,0,0,0.02);
    border: 1px solid #e2e8f0;
    transition: all 0.2s;
}

.project-card:hover {
    border-color: #94a3b8;
    box-shadow: 0 12px 24px -8px rgba(0,0,0,0.1);
}

.card-bg-icon {
    position: absolute;
    right: 0;
    bottom: 0;
    font-size: 8rem;
    opacity: 0.08;
    z-index: 0;
    pointer-events: none;
    color: #1e293b;
    transform: rotate(-5deg);
}

.card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1rem;
    position: relative;
    z-index: 1;
}

.project-name {
    font-size: 1.25rem;
    font-weight: 700;
    color: #1e293b;
    text-decoration: none;
    cursor: pointer;
    z-index: 2;
}

.project-name:hover {
    text-decoration: underline;
    color: #2563eb;
}

.header-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    z-index: 2;
}

.official-link-btn {
    background: #eef2ff;
    border: none;
    border-radius: 30px;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #1e4f8a;
    cursor: pointer;
    transition: 0.2s;
    font-size: 1rem;
    text-decoration: none;
}

.official-link-btn:hover {
    background: #dbeafe;
    transform: scale(1.05);
}

.project-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem 1.2rem;
    font-size: 0.85rem;
    color: #475569;
    margin: 1rem 0 1.2rem 0;
    border-top: 1px dashed #e2e8f0;
    padding-top: 0.8rem;
    position: relative;
    z-index: 1;
}

.meta-item {
    display: flex;
    align-items: center;
    gap: 0.3rem;
}

.meta-item i {
    width: 16px;
    color: #64748b;
}

.action-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
    position: relative;
    z-index: 1;
}

.releases-group {
    display: flex;
    gap: 0.3rem;
    align-items: center;
    flex-wrap: wrap;
}

/* 桶卡片 */
.buckets-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1rem;
    margin: 1rem 0;
}

.bucket-card {
    position: relative;
    background: white;
    border-radius: 16px;
    padding: 1rem;
    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    border: 1px solid #e2e8f0;
    transition: all 0.2s;
    cursor: pointer;
    overflow: hidden;
}

.bucket-card:hover {
    border-color: #94a3b8;
    box-shadow: 0 8px 16px rgba(0,0,0,0.1);
}

.bucket-card.delete-mode {
    /* 删除模式下的样式 */
}

.bucket-card.bucket-card-selected {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.bucket-card .progress-bg {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    width: 100%;
    z-index: 0;
    opacity: 0.2;
    transition: width 0.3s;
}

.bucket-card .progress-bg.green { background: #22c55e; }
.bucket-card .progress-bg.yellow { background: #eab308; }
.bucket-card .progress-bg.orange { background: #f97316; }
.bucket-card .progress-bg.red { background: #ef4444; }

.bucket-card .bucket-content {
    position: relative;
    z-index: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.bucket-card .bucket-name {
    font-weight: 600;
    font-size: 1rem;
}

.bucket-card .edit-icon {
    opacity: 0;
    transition: opacity 0.2s;
    color: #64748b;
    cursor: pointer;
    padding: 0.3rem;
    border-radius: 50%;
}

.bucket-card:hover .edit-icon {
    opacity: 1;
}

.bucket-card .edit-icon:hover {
    background: #f1f5f9;
    color: #0f172a;
}

.bucket-card .percentage {
    position: absolute;
    right: 1rem;
    top: 50%;
    transform: translateY(-50%);
    font-size: 1.5rem;
    font-weight: 700;
    opacity: 0.15;
    z-index: 1;
    color: #1e293b;
}

.bucket-card .checkbox {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    z-index: 2;
    display: none;
}

.bucket-card.delete-mode .checkbox {
    display: block;
}

.bucket-card .checkbox input {
    width: 18px;
    height: 18px;
    cursor: pointer;
}

/* Snippets 文本域 */
#snippetsJson {
    width: 100%;
    height: 150px;
    font-family: monospace;
    font-size: 0.9rem;
    padding: 0.5rem;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    resize: vertical;
    background: #f8fafc;
}

#snippetsJson:focus {
    outline: none;
    border-color: #94a3b8;
    box-shadow: 0 0 0 2px #e2e8f0;
}

/* 队列详情面板 */
.queue-detail-panel {
    position: absolute;
    top: calc(100% + 5px);
    right: 0;
    width: 300px;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1);
    padding: 1rem;
    z-index: 100;
    margin-top: 0;
}

.queue-detail-panel h4 {
    margin-bottom: 0.5rem;
    font-size: 1rem;
}

#queueTaskList {
    max-height: 200px;
    overflow-y: auto;
}

.queue-task-item {
    display: flex;
    justify-content: space-between;
    padding: 0.3rem 0;
    border-bottom: 1px solid #f1f5f9;
    font-size: 0.85rem;
}

.queue-task-item .task-name {
    font-weight: 500;
}

.queue-task-item .task-progress {
    color: #64748b;
}

/* ========== 详情视图 ========== */
.detail-view {
    background: white;
    border-radius: 28px;
    border: 1px solid #e2e8f0;
    padding: 2rem;
}

.detail-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
    flex-wrap: wrap;
}

.detail-header h2 {
    margin: 0 1rem;
    font-size: 1.4rem;
    flex: 1;
}

.back-btn {
    background: #f1f5f9;
    border: none;
    border-radius: 40px;
    padding: 0.5rem 1.3rem;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.version-selector {
    position: relative;
    margin-left: auto;
    display: flex;
    align-items: center;
    background: #f1f5f9;
    border-radius: 40px;
    padding: 0.3rem 1rem 0.3rem 1.2rem;
    cursor: pointer;
    user-select: none;
    gap: 0.5rem;
}

.version-selector span {
    font-weight: 500;
    color: #1e293b;
}

.version-selector i {
    font-size: 0.8rem;
    color: #64748b;
}

.version-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 20px;
    box-shadow: 0 12px 24px -8px rgba(0,0,0,0.15);
    padding: 0.5rem 0;
    min-width: 140px;
    z-index: 20;
    display: none;
}

.version-dropdown.show {
    display: block;
}

.version-item {
    padding: 0.6rem 1.5rem;
    font-size: 0.95rem;
    color: #334155;
    cursor: pointer;
    transition: background 0.2s;
}

.version-item:hover {
    background: #f1f5f9;
}

.version-item.current {
    background: #e9f0ff;
    color: #1e4f8a;
    font-weight: 600;
}

.file-list, .releases-list {
    border: 1px solid #e2e8f0;
    border-radius: 20px;
    overflow: hidden;
    margin-bottom: 1.5rem;
}

/* 文件树样式 */
.folder-row {
    cursor: pointer;
}
.folder-icon {
    color: #f1c40f;
    margin-right: 0.5rem;
    width: 20px;
    text-align: center;
}
.file-icon {
    color: #64748b;
    margin-right: 0.5rem;
    width: 20px;
    text-align: center;
}
.release-icon {
    color: #166534; /* 深绿色，与官网 release 按钮文字色一致 */
    margin-right: 0.5rem;
    width: 20px;
    text-align: center;
}
.docker-icon {
    color: #0b5394;
    margin-right: 0.5rem;
    width: 20px;
    text-align: center;
}
.folder-children {
    margin-left: 20px;
}
.file-row {
    display: flex;
    align-items: center;
    padding: 0.6rem 1.5rem;
    border-bottom: 1px solid #e2e8f0;
    background: white;
}
.file-row:last-child {
    border-bottom: none;
}
.file-row .file-name {
    flex: 1;
    font-weight: 500;
    margin-left: 0.2rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.file-row .file-size {
    color: #64748b;
    font-size: 0.85rem;
    margin-right: 1rem;
    min-width: 80px;
    text-align: right;
}
.file-row .btn-download {
    background: transparent;
    border: none;
    color: #1e293b;
    cursor: pointer;
    padding: 0.3rem 0.8rem;
    border-radius: 20px;
    transition: background 0.2s;
}
.file-row .btn-download:hover {
    background: #f1f5f9;
}
.release-row .btn-download {
    margin-left: 0.5rem;
}

/* 注意：移除了冲突的 .file-icon, .release-icon 通用样式，确保 release 图标颜色正确 */

.section-title {
    font-size: 1.2rem;
    font-weight: 600;
    margin: 1.5rem 0 1rem 0;
}
`;
