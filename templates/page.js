// templates/page.js
import { base } from './styles/base.js';
import { interactive } from './styles/interactive.js';
import { home } from './styles/home.js';
import { admin } from './styles/admin.js';
import { headerHTML } from './common/header.js';
import { footerHTML } from './common/footer.js';
import { popupHTML } from './common/popup.js';
import { loginModalHTML } from './common/loginModal.js';
import { customProjectModalHTML } from './common/customProjectModal.js';
import { homeHTML } from './home/homeIndex.js';
import { detailHTML } from './home/detail.js';
import { adminHTML } from './admin/adminIndex.js';
import { clientJS } from '../client.js';

export function renderFullPage() {
  const styles = `
    ${base}
    ${interactive}
    ${home}
    ${admin}
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>B2 镜像工坊</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600;14..32,700&display=swap" rel="stylesheet">
    <style>${styles}</style>
</head>
<body>
    <div class="container">
        ${headerHTML}
        ${homeHTML}
        ${detailHTML}
        ${adminHTML}
        ${popupHTML}
        ${loginModalHTML}
        ${customProjectModalHTML}
    </div>
    ${footerHTML}

    <!-- Log Widget -->
    <div id="log-widget-fab" class="log-widget-fab">
        <i class="fas fa-file-alt"></i>
        <span id="log-widget-badge" class="log-widget-badge" style="display: none;"></span>
    </div>
    <div id="log-modal-overlay" class="modal-overlay" style="display: none;">
        <div id="log-modal-content" class="modal-content" style="max-width: 800px; max-height: 80vh;">
            <div class="modal-header">
                <h3>Backend Logs</h3>
                <div class="modal-close" id="closeLogModal"><i class="fas fa-times"></i></div>
            </div>
            <pre id="log-modal-container" style="color: #d4d4d4; background-color: #1e1e1e; padding: 1rem; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word; font-family: monospace; max-height: 60vh; overflow-y: auto;"></pre>
        </div>
    </div>

    <script>${clientJS}</script>
</body>
</html>`;
}