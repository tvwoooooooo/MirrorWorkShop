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

<!-- 选择存储桶模态框（卡片样式） -->
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