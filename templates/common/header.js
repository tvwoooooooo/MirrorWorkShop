// templates/common/header.js
export const headerHTML = `
<header class="header">
    <div class="logo-area">
        <span class="logo-icon"><i class="fas fa-cloud"></i></span>
        <span>B2 镜像工坊</span>
    </div>
    <div id="loginContainer">
        <div class="login-btn" id="loginBtn">
            <i class="fas fa-user-circle"></i> 登录
        </div>
    </div>
    <div id="userMenuContainer" class="hide">
        <div class="user-menu-btn" id="userMenuBtn">
            <i class="fas fa-user-circle"></i> Admin <i class="fas fa-chevron-down"></i>
            <div class="user-dropdown" id="userDropdown">
                <div class="dropdown-item" id="goToAdmin"><i class="fas fa-cog"></i> 进入后台</div>
                <div class="dropdown-item" id="logoutBtn"><i class="fas fa-sign-out-alt"></i> 退出登录</div>
            </div>
        </div>
    </div>
</header>
`;