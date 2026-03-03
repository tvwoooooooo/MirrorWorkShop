// templates/styles/global.js
export const global = `
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
`;