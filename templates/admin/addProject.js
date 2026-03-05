// templates/admin/addProject.js
export const addProjectHTML = `
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

<!-- 选择存储桶模态框 -->
<div class="modal-overlay" id="selectBucketModal" style="display: none;">
    <div class="modal-content" style="max-width: 500px;">
        <div class="modal-header">
            <h3>选择存储桶</h3>
            <div class="modal-close" id="closeSelectBucketModal"><i class="fas fa-times"></i></div>
        </div>
        <div id="bucketCardGrid" class="buckets-grid" style="max-height: 300px; overflow-y: auto; margin: 1rem 0;"></div>
        <div style="display: flex; justify-content: flex-end;">
            <button class="modal-btn" id="confirmSelectBucketBtn" style="width: auto; padding: 0.5rem 2rem;">确定</button>
        </div>
    </div>
</div>

<!-- 选择备份内容模态框 -->
<div class="modal-overlay" id="backupContentModal" style="display: none;">
    <div class="modal-content" style="max-width: 600px;">
        <div class="modal-header">
            <h3>选择备份内容</h3>
            <div class="modal-close" id="closeBackupContentModal"><i class="fas fa-times"></i></div>
        </div>
        <div style="margin: 1rem 0;">
            <label class="checkbox-item">
                <input type="checkbox" id="backupCodeFiles" checked>
                <span>备份代码文件（整个仓库的文件树）</span>
            </label>
        </div>
        <div style="margin: 1rem 0;">
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                <input type="checkbox" id="backupReleases" style="width: 18px; height: 18px;">
                <span style="font-weight: 600;">备份 Releases</span>
            </div>
            <div id="releasesSelector" style="display: none; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem;">
                <div class="version-selector-sm" id="backupReleaseVersionSelector" style="margin-bottom: 1rem;">
                    <span id="selectedReleaseVersion">选择版本</span>
                    <i class="fas fa-chevron-down"></i>
                    <div class="version-dropdown-sm" id="backupReleaseVersionDropdown"></div>
                </div>
                <div id="backupAssetsList" style="max-height: 200px; overflow-y: auto;"></div>
                <div style="margin-top: 0.5rem;">
                    <label><input type="checkbox" id="selectAllAssets"> 全选当前版本 assets</label>
                </div>
            </div>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
            <button class="btn-icon" id="cancelBackupContent">取消</button>
            <button class="modal-btn" id="confirmBackupContent" style="width: auto; padding: 0.5rem 2rem;">确认备份</button>
        </div>
    </div>
</div>
`;