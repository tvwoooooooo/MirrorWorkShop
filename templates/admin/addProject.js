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

<!-- 选择存储桶模态框（卡片样式 + 备份选项） -->
<div class="modal-overlay" id="selectBucketModal" style="display: none;">
    <div class="modal-content" style="max-width: 500px;">
        <div class="modal-header">
            <h3>选择存储桶</h3>
            <div class="modal-close" id="closeSelectBucketModal"><i class="fas fa-times"></i></div>
        </div>
        <div style="margin-bottom: 1rem; font-weight: 600;" id="modalProjectName"></div>
        <div id="bucketCardGrid" class="buckets-grid" style="max-height: 200px; overflow-y: auto; margin: 1rem 0;">
            <!-- 桶卡片将动态渲染 -->
        </div>
        
        <!-- 备份选项区域 -->
        <div style="border-top: 1px solid #e2e8f0; padding-top: 1rem; margin: 1rem 0;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
                <label class="checkbox-item">
                    <input type="checkbox" id="backupCodeCheckbox" checked> 备份代码文件
                </label>
                <button class="btn-icon" id="modalSelectReleasesBtn">
                    <i class="fas fa-tag"></i> 选择Releases
                </button>
            </div>
            <div id="selectedReleasesInfo" style="color: #64748b; font-size: 0.9rem;"></div>
        </div>

        <div style="display: flex; justify-content: flex-end;">
            <button class="modal-btn" id="confirmSelectBucketBtn" style="width: auto; padding: 0.5rem 2rem;">确定备份</button>
        </div>
    </div>
</div>

<!-- Releases 选择悬浮窗（保持不变） -->
<div class="popup-overlay" id="releasesSelectPopup" style="display: none;">
    <div class="popup-content" style="max-width: 600px;">
        <div class="popup-close" id="releasesSelectPopupClose"><i class="fas fa-times"></i></div>
        <div class="popup-header">
            <h3 id="releasesSelectProjectName">项目名称</h3>
            <div class="version-selector-sm" id="releasesSelectVersionSelector">
                <span id="releasesSelectSelectedVersion">选择版本</span>
                <i class="fas fa-chevron-down"></i>
                <div class="version-dropdown-sm" id="releasesSelectVersionDropdown"></div>
            </div>
        </div>
        <div style="margin: 1rem 0;">
            <label class="checkbox-item">
                <input type="checkbox" id="selectAllReleasesCheckbox"> 全选
            </label>
        </div>
        <div id="releasesSelectList" class="popup-releases-list" style="max-height: 300px; overflow-y: auto;"></div>
        <div style="display: flex; justify-content: flex-end; margin-top: 1rem;">
            <button class="modal-btn" id="confirmReleasesSelectBtn" style="width: auto; padding: 0.5rem 2rem;">确定</button>
        </div>
    </div>
</div>

<style>
.search-result-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #f8fafc;
    border-radius: 60px;
    padding: 0.6rem 1rem;
    margin-bottom: 0.8rem;
}
.search-result-item span {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
.save-btn {
    background: #1e293b;
    color: white;
    border: none;
    border-radius: 40px;
    padding: 0.3rem 1.2rem;
    font-weight: 500;
    cursor: pointer;
}
.save-btn:hover {
    background: #0f172a;
}
.buckets-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.75rem;
}
.bucket-card {
    position: relative;
    background: white;
    border-radius: 12px;
    padding: 0.75rem;
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
.bucket-card.selectable-card.bucket-card-selected {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}
.progress-bg {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    width: 100%;
    z-index: 0;
    opacity: 0.2;
    transition: width 0.3s;
}
.progress-bg.green { background: #22c55e; }
.progress-bg.yellow { background: #eab308; }
.progress-bg.orange { background: #f97316; }
.progress-bg.red { background: #ef4444; }
.percentage {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    font-size: 1.2rem;
    font-weight: 700;
    opacity: 0.15;
    z-index: 1;
    color: #1e293b;
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
    font-size: 0.9rem;
}
.checkbox-item {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    cursor: pointer;
}
</style>
`;
