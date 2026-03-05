// templates/common/loginModal.js
export const loginModalHTML = `
<div class="modal-overlay" id="loginModal">
    <div class="modal-content">
        <div class="modal-header">
            <h3>登录后台</h3>
            <div class="modal-close" id="closeLoginModal"><i class="fas fa-times"></i></div>
        </div>
        <div class="input-group">
            <label>账号</label>
            <input type="text" placeholder="admin" id="username">
        </div>
        <div class="input-group">
            <label>密码</label>
            <input type="password" placeholder="******" id="password">
        </div>
        <button class="modal-btn" id="doLogin">登录</button>
    </div>
</div>
`;