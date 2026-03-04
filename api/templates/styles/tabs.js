// templates/styles/tabs.js
export const tabs = `
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
`;