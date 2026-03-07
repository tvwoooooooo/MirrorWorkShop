// templates/styles/base.js
export const base = `
/* ========== 全局样式 ========== */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Inter', sans-serif;
    background-color: #f8fafc;
    color: #0f172a;
    line-height: 1.5;
    position: relative;
}

.container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 1.5rem 2rem;
}

/* header */
.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
}

.logo-area {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    font-size: 1.4rem;
}

.logo-icon {
    background: #1e293b;
    color: #facc15;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
}

/* ========== 工具类 ========== */
.hide {
    display: none !important;
}

.loading-indicator {
    text-align: center;
    padding: 0.8rem;
    color: #64748b;
    font-size: 0.9rem;
    background: rgba(255,255,255,0.5);
    border-radius: 40px;
    margin-top: 0.5rem;
}

.empty-state {
    text-align: center;
    padding: 2rem;
    color: #94a3b8;
    font-style: italic;
}

/* ========== 进度条 ========== */
.progress {
    flex: 1;
    height: 8px;
    background: #e2e8f0;
    border-radius: 40px;
    overflow: hidden;
}

.progress-fill {
    height: 100%;
    background: #1e293b;
}
`;