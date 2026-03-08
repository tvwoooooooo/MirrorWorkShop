// templates/admin/addProject.js
export const addProjectHTML = `
<style>
/* 两步选择模态框样式 */
.backup-modal-content {
    max-width: 800px;
    width: 90%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
}
.backup-step {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 0;
}
.backup-step.hide {
    display: none;
}
.backup-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
}
.backup-header h3 {
    font-size: 1.2rem;
    font-weight: 600;
}
.backup-footer {
    display: flex;
    justify-content: space-between;
    margin-top: 1rem;
    border-top: 1px solid #e2e8f0;
    padding-top: 1rem;
}
.file-tree {
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 0.5rem;
    max-height: 200px;
    overflow-y: auto;
    margin-bottom: 1rem;
}
.file-item {
    display: flex;
    align-items: center;
    padding: 0.3rem 0.5rem;
    font-size: 0.9rem;
}
.file-item input[type="checkbox"] {
    margin-right: 0.5rem;
}
.file-item .file-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.file-item .file-size {
    color: #64748b;
    font-size: 0.8rem;
    margin-left: 0.5rem;
}
.releases-container {
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 0.5rem;
    max-height: 300px;
    overflow-y: auto;
}
.release-item {
    border-bottom: 1px solid #f1f5f9;
    padding: 0.5rem;
}
.release-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
}
.release-header input[type="checkbox"] {
    margin-right: 0.5rem;
}
.release-tag {
    font-weight: 600;
    font-size: 0.95rem;
}
.release-date {
    color: #64748b;
    font-size: 0.8rem;
    margin-left: auto;
}
.release-assets {
    margin-left: 2rem;
    padding-left: 0.5rem;
    border-left: 2px solid #e2e8f0;
    display: none;
}
.release-assets.expanded {
    display: block;
}
.asset-item {
    display: flex;
    align-items: center;
    padding: 0.3rem 0;
    font-size: 0.85rem;
}
.asset-item input[type="checkbox"] {
    margin-right: 0.5rem;
}
.asset-name {
    flex: 1;
}
.asset-size {
    color: #64748b;
    margin-left: 0.5rem;
}
.select-all-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.5rem 0;
    padding: 0.3rem 0.5rem;
    background: #f8fafc;
    border-radius: 8px;
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
        <div id="queueDetailPanel" class="queue-detail-panel hide">
            <h4>队列任务</h4>
            <div id="queueTaskList"></div>
        </div>
    </div>
    <div class="search-box" style="max-width: 600px;">
        <button class="mode-toggle" id="adminModeToggle">
            <span id="adminModeText">搜索模式</span>
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

<!-- 选择备份内容的模态框（两步） -->
<div class="modal-overlay" id="backupContentModal" style="display: none;">
    <div class="modal-content backup-modal-content">
        <div class="modal-header">
            <h3 id="backupModalTitle">选择备份内容</h3>
            <div class="modal-close" id="closeBackupModal"><i class="fas fa-times"></i></div>
        </div>
        
        <!-- 第一步：选择文件与 Releases -->
        <div id="backupStep1" class="backup-step">
            <div class="backup-header">
                <i class="fab fa-github" id="backupTypeIcon"></i>
                <span id="backupProjectName"></span>
            </div>
            
            <!-- 文件树区域 -->
            <h4 style="margin: 0.5rem 0;">代码文件</h4>
            <div class="select-all-bar">
                <input type="checkbox" id="selectAllFiles" checked>
                <label for="selectAllFiles">全选所有文件</label>
                <span style="margin-left: auto;" id="selectedFilesCount">全部文件</span>
            </div>
            <div id="fileTreeContainer" class="file-tree">
                <div class="loading-indicator">加载文件列表中...</div>
            </div>
            
            <!-- Releases 区域 -->
            <h4 style="margin: 0.5rem 0;">Releases</h4>
            <div class="select-all-bar">
                <input type="checkbox" id="selectAllReleases">
                <label for="selectAllReleases">全选所有 Releases 资产</label>
                <span style="margin-left: auto;" id="selectedReleasesCount">0 个文件</span>
            </div>
            <div id="releasesContainer" class="releases-container">
                <div class="loading-indicator">加载 Releases 中...</div>
            </div>
        </div>
        
        <!-- 第二步：选择存储桶 -->
        <div id="backupStep2" class="backup-step hide">
            <h4 style="margin: 0.5rem 0;">选择存储桶</h4>
            <div id="step2BucketGrid" class="buckets-grid" style="max-height: 300px; overflow-y: auto;">
                <!-- 桶卡片动态渲染 -->
            </div>
        </div>
        
        <!-- 底部按钮 -->
        <div class="backup-footer">
            <div>
                <button class="btn-icon" id="backupPrevBtn" style="display: none;"><i class="fas fa-arrow-left"></i> 上一步</button>
            </div>
            <div>
                <button class="btn-icon" id="backupCancelBtn">取消</button>
                <button class="btn-icon btn-primary" id="backupNextBtn">下一步</button>
                <button class="btn-icon btn-primary" id="backupSaveBtn" style="display: none;">保存</button>
            </div>
        </div>
    </div>
</div>

<!-- 旧的选择存储桶模态框（保留用于兼容） -->
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
