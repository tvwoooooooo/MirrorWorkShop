// templates/styles/search.js
export const search = `
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
`;