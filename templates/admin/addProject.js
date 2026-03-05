// templates/admin/addProject.js
export const addProjectHTML = `
<style>
/* 备份选项模态框样式 */
.backup-options-modal .modal-content {
    max-width: 600px;
}
.backup-options {
    margin: 1rem 0;
}
.option-item {
    margin-bottom: 1rem;
}
.option-item label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
    cursor: pointer;
}
.option-item input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
}
.releases-section {
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 1rem;
    margin-top: 0.5rem;
    background: #f8fafc;
}
.version-selector-sm {
    display: flex;
    align-items: center;
    background: white;
    border-radius: 40px;
    padding: 0.3rem 1rem 0.3rem 1.2rem;
    cursor: pointer;
    user-select: none;
    gap: 0.5rem;
    border: 1px solid #cbd5e1;
    width: fit-content;
    margin-bottom: 1rem;
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
.assets-list {
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: white;
}
.asset-row {
    display: flex;
    align-items: center;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid #e2e8f0;
}
.asset-row:last-child {
    border-bottom: none;
}
.asset-row input[type="checkbox"] {
    margin-right: 0.8rem;
    width: 16px;
    height: 16px;
    cursor: pointer;
}
.asset-name {
    flex: 1;
    font-size: 0.9rem;
}
.asset-size {
    color: #64748b;
    font-size: 0.8rem;
    margin-right: 1rem;
}
.loading-releases {
    text-align: center;
    padding: 1rem;
    color: #64748b;
}
.empty-releases {
    text-align: center;
    padding: 1rem;
    color: #94a3b8;
    font-style: italic;
}
</style>

<div class="card">
    <div class="card-header" style="position: relative;">
        <h2>项目添加</h2>
        <div class="queue-info" style="display: flex; align-items: center; gap: 0.5rem;">
            <div class="queue-status" style="min-width: 150px; text-align: right;">
                <span id="queueFileCount">总文件: 0</span>
                <span id="queueFileName" style="display: none;">正在上传: 无</span>
            </div>
            <div class="queue-menu" id="queueMenuBtn" style="cursor: pointer; padding: 0.3rem;">
                <i class="fas fa-bars"></i>
            </div>
        </div>
        <!-- 队列详情面板移到此处作为绝对定位子元素 -->
        <div id="queueDetailPanel" class="queue-detail-panel hide">
            <h4>队列任务</h4>
            <div id="queueTaskList"></div>
        </div>
    </div>
    <div class="search-box" style="max-width: 600px;">
        <button class="mode-toggle" id="addModeToggle">
            <span id="addModeText">GitHub</span>
            <i class="fas fa-chevron-down"></i>
        </button>
        <input type="text" id="searchProjectInput" placeholder="搜索项目名称...">
        <button class="search-btn" id="searchProjectBtn"><i class="fas fa-search"></i></button>
    </div>
    <div id="searchResultArea" class="search-result-area hide">
        <h3 style="font-size:1rem; margin-bottom:1rem;">搜索结果：</h3>
        <div id="searchResultsScroll" class="search-results-scroll">
            <div id="searchResultList"></div>
        </div>
    </div>
    <p style="color:#64748b; margin-top:0.5rem;">搜索后将项目完整备份到存储桶</p>
</div>

<!-- 备份选项模态框（新增） -->
<div class="modal-overlay" id="backupOptionsModal" style="display: none;">
    <div class="modal-content backup-options-modal">
        <div class="modal-header">
            <h3 id="backupProjectName">选择备份内容</h3>
            <div class="modal-close" id="closeBackupOptionsModal"><i class="fas fa-times"></i></div>
        </div>
        <div class="backup-options">
            <div class="option-item">
                <label>
                    <input type="checkbox" id="backupCodeCheckbox" checked>
                    <span>代码文件（整个仓库的文件树）</span>
                </label>
            </div>
            <div class="option-item">
                <label>
                    <input type="checkbox" id="backupReleasesCheckbox">
                    <span>Releases</span>
                </label>
            </div>
            <div id="releasesSelector" class="releases-section" style="display: none;">
                <div class="version-selector-sm" id="backupVersionSelector">
                    <span id="backupSelectedVersion">加载中...</span>
                    <i class="fas fa-chevron-down"></i>
                    <div class="version-dropdown-sm" id="backupVersionDropdown"></div>
                </div>
                <div id="backupAssetsList" class="assets-list"></div>
            </div>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
            <button class="btn-icon" id="cancelBackupOptions">取消</button>
            <button class="modal-btn" id="confirmBackupOptions" style="width: auto; padding: 0.5rem 2rem;">下一步</button>
        </div>
    </div>
</div>

<!-- 选择存储桶模态框（卡片样式，保持不变） -->
<div class="modal-overlay" id="selectBucketModal" style="display: none;">
    <div class="modal-content" style="max-width: 500px;">
        <div class="modal-header">
            <h3>选择存储桶</h3>
            <div class="modal-close" id="closeSelectBucketModal"><i class="fas fa-times"></i></div>
        </div>
        <div id="bucketCardGrid" class="buckets-grid" style="max-height: 300px; overflow-y: auto; margin: 1rem 0;">
            <!-- 桶卡片将动态渲染 -->
        </div>
        <div style="display: flex; justify-content: flex-end;">
            <button class="modal-btn" id="confirmSelectBucketBtn" style="width: auto; padding: 0.5rem 2rem;">确定</button>
        </div>
    </div>
</div>
`;
