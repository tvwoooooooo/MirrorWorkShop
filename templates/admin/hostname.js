// templates/admin/hostname.js
export const hostnameHTML = `
<div class="card">
    <div class="card-header">
        <h2>自定义主机名</h2>
        <button class="btn-icon" id="saveHostnameBtn"><i class="fas fa-save"></i> 保存</button>
    </div>
    <div class="hostname-row">
        <div class="hostname-input">
            <label>官网自定义主机名:</label>
            <input type="text" id="officialHostname" placeholder="例如: https://gh-mirror.example.com" style="background-color: #f1f5f9; color: #64748b;">
        </div>
        <div class="hostname-input">
            <label>存储桶自定义主机名:</label>
            <input type="text" id="bucketHostname" placeholder="例如: https://b2-mirror.example.com" style="background-color: #f1f5f9; color: #64748b;">
        </div>
        <p style="color:#475569; font-size:0.9rem;">设置后，相应卡片中的下载链接会替换为自定义主机名</p>
    </div>
</div>
`;