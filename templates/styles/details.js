// templates/styles/details.js
export const details = `
.detail-view {
    background: white;
    border-radius: 28px;
    border: 1px solid #e2e8f0;
    padding: 2rem;
}

.detail-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 2rem;
    flex-wrap: wrap;
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

.file-row, .release-row {
    display: flex;
    align-items: center;
    padding: 0.8rem 1.5rem;
    border-bottom: 1px solid #e2e8f0;
    background: white;
}

.file-row:last-child, .release-row:last-child {
    border-bottom: none;
}

.file-icon, .release-icon {
    width: 24px;
    color: #64748b;
    margin-right: 1rem;
}

.file-name {
    flex: 1;
    font-weight: 500;
}

.release-info {
    flex: 1;
    display: flex;
    flex-direction: column;
}

.release-tag {
    font-weight: 600;
    color: #0f172a;
}

.release-date {
    font-size: 0.8rem;
    color: #64748b;
}

.release-download {
    display: flex;
    gap: 0.5rem;
}

.docker-tag-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 2rem;
}

.tag-row {
    display: flex;
    justify-content: space-between;
    background: #f8fafc;
    padding: 0.8rem 1.5rem;
    border-radius: 16px;
}

.section-title {
    font-size: 1.2rem;
    font-weight: 600;
    margin: 1.5rem 0 1rem 0;
}
`;