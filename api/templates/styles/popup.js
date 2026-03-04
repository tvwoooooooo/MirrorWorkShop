// templates/styles/popup.js
export const popup = `
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