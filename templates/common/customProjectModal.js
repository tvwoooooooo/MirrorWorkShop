// templates/common/customProjectModal.js
export const customProjectModalHTML = `
<div class="modal-overlay" id="customProjectModal">
    <div class="modal-content">
        <div class="modal-header">
            <h3>选择监控项目</h3>
            <div class="modal-close" id="closeCustomModal"><i class="fas fa-times"></i></div>
        </div>
        <div class="project-list" id="customProjectList"></div>
        <button class="modal-btn" id="saveCustomProjects">确定</button>
    </div>
</div>
`;