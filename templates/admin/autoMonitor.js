// templates/admin/autoMonitor.js
export const autoMonitorHTML = `
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

    <!-- API 令牌配置区域 -->
    <div style="margin-top: 1.5rem; border-top: 1px solid #e2e8f0; padding-top: 1rem;">
        <div style="display: flex; gap: 1rem; margin-bottom: 0.5rem;">
            <button class="btn-icon" id="addGithubTokenBtn" style="background: #24292e; color: white;"><i class="fab fa-github"></i> 添加 GitHub 令牌</button>
            <button class="btn-icon" id="addDockerTokenBtn" style="background: #2496ed; color: white;"><i class="fab fa-docker"></i> 添加 Docker 令牌</button>
        </div>
        <!-- 令牌列表将动态渲染 -->
        <div id="githubTokensList" class="buckets-grid" style="margin-top: 1rem;"></div>
        <div id="dockerTokensList" class="buckets-grid" style="margin-top: 1rem;"></div>
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

<!-- Docker 令牌模态框（预留，暂未实现功能） -->
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
