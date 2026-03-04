// templates/admin/autoMonitor.js
export const autoMonitorHTML = `
<style>
.token-tabs {
    display: flex;
    gap: 0.25rem;
    background: #e9eef2;
    padding: 0.25rem 0.25rem 0 0.25rem;
    border-radius: 8px 8px 0 0;
    width: fit-content;
    margin-top: 1.5rem;
}
.token-tab {
    padding: 0.5rem 1.5rem;
    border-radius: 6px 6px 0 0;
    font-weight: 600;
    cursor: pointer;
    transition: 0.2s;
    user-select: none;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    background: #d1d9e0;
    color: #334155;
}
.token-tab.active {
    background: white;
    color: #0f172a;
    box-shadow: 0 -2px 4px rgba(0,0,0,0.02);
}
.token-panel {
    border: 1px solid #e2e8f0;
    border-top: none;
    background: white;
    border-radius: 0 8px 8px 8px;
    padding: 1rem;
}
.panel-header {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-bottom: 1rem;
}
.panel-header .btn-icon {
    background: #f1f5f9;
    border: none;
    border-radius: 40px;
    padding: 0.4rem 1rem;
    font-size: 0.9rem;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
    transition: 0.2s;
    color: #1e293b;
}
.panel-header .btn-icon:hover {
    background: #e2e8f0;
}
.panel-header .btn-danger {
    background: #dc2626;
    color: white;
}
.panel-header .btn-danger:hover {
    background: #b91c1c;
}
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
.bucket-card.delete-mode .checkbox {
    display: block;
}
.bucket-card .checkbox {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    z-index: 2;
    display: none;
}
.bucket-card .checkbox input {
    width: 18px;
    height: 18px;
    cursor: pointer;
}
.bucket-card.bucket-card-selected {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}
.bucket-content {
    position: relative;
    z-index: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.bucket-name {
    font-weight: 600;
    font-size: 1rem;
}
</style>

<div class="card">
    <div class="card-header">
        <h2>自动监控</h2>
        <button class="btn-icon" id="saveMonitorBtn"><i class="fas fa-save"></i> 保存</button>
    </div>
    <div class="monitor-row">
        <div class="toggle-switch">
            <span>监控开关</span>
            <label class="switch">
                <input type="checkbox" id="monitorSwitch" checked>
                <span class="slider"></span>
            </label>
        </div>
        <div class="radio-group">
            <label><input type="radio" name="monitorScope" value="all" checked> 全部项目</label>
            <label><input type="radio" name="monitorScope" value="custom"> 自定义项目</label>
        </div>
        <button class="custom-project-trigger" id="openCustomProject"><i class="fas fa-list"></i> 选择项目</button>
    </div>
    <div class="days-input">
        <span>监控日期：每</span>
        <input type="number" id="monitorDays" value="1" min="1" max="30"> 天一次
    </div>

    <!-- API 令牌配置区域（标签页） -->
    <div style="margin-top: 1.5rem; border-top: 1px solid #e2e8f0; padding-top: 1rem;">
        <!-- 标签页 -->
        <div class="token-tabs" id="tokenTabs">
            <div class="token-tab active" data-token-type="github"><i class="fab fa-github"></i> Github令牌</div>
            <div class="token-tab" data-token-type="docker"><i class="fab fa-docker"></i> Docker令牌</div>
        </div>

        <!-- GitHub 令牌面板 -->
        <div class="token-panel" id="githubTokenPanel">
            <div class="panel-header">
                <button class="btn-icon" id="addGithubTokenBtn"><i class="fas fa-plus"></i> +添加令牌</button>
                <button class="btn-icon btn-danger" id="deleteGithubTokenBtn" title="批量删除"><i class="fas fa-trash"></i></button>
            </div>
            <div id="githubTokensList" class="buckets-grid"></div>
        </div>

        <!-- Docker 令牌面板（默认隐藏） -->
        <div class="token-panel hide" id="dockerTokenPanel">
            <div class="panel-header">
                <button class="btn-icon" id="addDockerTokenBtn"><i class="fas fa-plus"></i> +添加令牌</button>
                <button class="btn-icon btn-danger" id="deleteDockerTokenBtn" title="批量删除"><i class="fas fa-trash"></i></button>
            </div>
            <div id="dockerTokensList" class="buckets-grid"></div>
        </div>
    </div>
</div>

<!-- GitHub 令牌模态框 -->
<div class="modal-overlay" id="githubTokenModal" style="display: none;">
    <div class="modal-content" style="max-width: 450px;">
        <div class="modal-header">
            <h3>添加 GitHub 令牌</h3>
            <div class="modal-close" id="closeGithubTokenModal"><i class="fas fa-times"></i></div>
        </div>
        <form id="githubTokenForm">
            <div class="input-group">
                <label>自定义名称 <span style="color:#ef4444;">*</span></label>
                <input type="text" id="githubTokenName" placeholder="例如: 我的工作令牌" required>
            </div>
            <div class="input-group">
                <label>GitHub 个人访问令牌 <span style="color:#ef4444;">*</span></label>
                <input type="password" id="githubTokenValue" placeholder="ghp_xxxxxxxxxxxx" required>
                <small style="color:#64748b;">需要 repo 和 public_repo 权限</small>
            </div>
            <input type="hidden" id="editingGithubTokenIndex" value="-1">
            <button type="submit" class="modal-btn">保存</button>
        </form>
    </div>
</div>

<!-- Docker 令牌模态框 -->
<div class="modal-overlay" id="dockerTokenModal" style="display: none;">
    <div class="modal-content" style="max-width: 450px;">
        <div class="modal-header">
            <h3>添加 Docker 令牌</h3>
            <div class="modal-close" id="closeDockerTokenModal"><i class="fas fa-times"></i></div>
        </div>
        <form id="dockerTokenForm">
            <div class="input-group">
                <label>自定义名称 <span style="color:#ef4444;">*</span></label>
                <input type="text" id="dockerTokenName" placeholder="例如: 我的 docker 令牌" required>
            </div>
            <div class="input-group">
                <label>Docker Hub 访问令牌 <span style="color:#ef4444;">*</span></label>
                <input type="password" id="dockerTokenValue" placeholder="dckr_xxxxxxxx" required>
            </div>
            <input type="hidden" id="editingDockerTokenIndex" value="-1">
            <button type="submit" class="modal-btn">保存</button>
        </form>
    </div>
</div>
`;
