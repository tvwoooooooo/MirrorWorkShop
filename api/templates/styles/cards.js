// templates/styles/cards.js 中的桶卡片和队列面板样式（已是最新）
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