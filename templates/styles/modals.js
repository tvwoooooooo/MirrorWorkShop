// templates/styles/modals.js
export const modals = `
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
`;