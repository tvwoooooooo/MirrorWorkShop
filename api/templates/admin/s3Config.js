// templates/admin/s3Config.js
export const s3ConfigHTML = `
<div class="card">
    <div class="card-header">
        <h2>S3 存储桶配置</h2>
        <div style="display: flex; gap: 0.5rem;">
            <button class="btn-icon" id="addBucketBtn"><i class="fas fa-plus"></i> 添加新桶</button>
            <button class="btn-icon btn-danger" id="deleteModeBtn" title="批量删除"><i class="fas fa-trash"></i></button>
        </div>
    </div>
    <div id="bucketsList" class="buckets-grid">
        <!-- 桶卡片将动态渲染 -->
    </div>
    
    <div style="margin-top: 1.5rem; border-top: 1px solid #e2e8f0; padding-top: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
            <strong>Snippets 规则 (桶标识映射)</strong>
            <div>
                <button class="btn-icon" id="importJsonBtn"><i class="fas fa-upload"></i> 导入JSON</button>
                <button class="btn-icon" id="saveJsonBtn"><i class="fas fa-save"></i> 保存</button>
            </div>
        </div>
        <textarea id="snippetsJson" style="width: 100%; height: 150px; font-family: monospace; font-size: 0.9rem; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 8px; resize: vertical;" placeholder="请输入或编辑 JSON 格式的桶标识映射..."></textarea>
        <div style="margin-top: 0.5rem;">
            <label class="checkbox-item">
                <input type="checkbox" id="addHostnameCheck">
                <span>将桶标识值添加到存储桶自定义主机名（通过 Snippets 代理访问）</span>
            </label>
            <p style="color:#64748b; font-size:0.85rem; margin-top:0.2rem;">
                例如：https://你的域名/<strong>桶标识</strong>/文件路径 将直接指向对应的存储桶
            </p>
        </div>
    </div>
</div>

<div class="modal-overlay" id="bucketModal" style="display: none;">
    <div class="modal-content" style="max-width: 500px;">
        <div class="modal-header">
            <h3 id="bucketModalTitle">添加新桶</h3>
            <div class="modal-close" id="closeBucketModal"><i class="fas fa-times"></i></div>
        </div>
        <form id="bucketForm">
            <div class="input-group">
                <label>自定义桶名 <span style="color:#ef4444;">*</span></label>
                <input type="text" id="bucketCustomName" placeholder="例如: 我的默认桶" required>
                <div style="margin-top: 0.1rem; color: #64748b; font-size: 0.85rem;">
                    <span>桶内部ID(内部引用): </span>
                    <span id="displayInternalId" style="font-family: monospace; background: #f1f5f9; padding: 0.1rem 0.3rem; border-radius: 4px;"></span>
                </div>
            </div>
            <input type="hidden" id="internalId">

            <div class="input-group">
                <label>应用密钥ID (keyID) <span style="color:#ef4444;">*</span></label>
                <input type="text" id="bucketKeyID" placeholder="例如: 006ebb39a593d8a0000000002" required>
            </div>
            <div class="input-group">
                <label>应用密钥 (applicationKey) <span style="color:#ef4444;">*</span></label>
                <input type="password" id="bucketAppKey" placeholder="例如: K006N6aOLs31B7svSroyWHKP2+HJHQU" required>
            </div>
            <div class="input-group">
                <label>存储桶名 (bucketName) <span style="color:#ef4444;">*</span></label>
                <input type="text" id="bucketName" placeholder="例如: M-M-O-C2" required>
            </div>
            <div class="input-group">
                <label>端点 (Endpoint) <span style="color:#ef4444;">*</span></label>
                <input type="text" id="bucketEndpoint" placeholder="例如: s3.ca-east-006.backblazeb2.com" required>
            </div>
            <div class="input-group">
                <label>桶标识 (可选，用于Snippets)</label>
                <input type="text" id="bucketSnippetId" placeholder="例如: default">
                <small style="color:#64748b;">填写后将出现在Snippets规则中，留空则不显示</small>
            </div>
            <input type="hidden" id="editingIndex" value="-1">
            <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                <button type="button" class="btn-icon" id="verifyBucketBtn" style="background: #3b82f6; color: white;">验证连接</button>
                <button type="submit" class="modal-btn" id="saveBucketBtn" style="flex: 1;">保存</button>
            </div>
        </form>
    </div>
</div>
`;