// templates/page.js
import { global } from './styles/global.js';
import { buttons } from './styles/buttons.js';
import { modals } from './styles/modals.js';
import { tabs } from './styles/tabs.js';
import { search } from './styles/search.js';
import { cards } from './styles/cards.js';
import { popup } from './styles/popup.js';
import { details } from './styles/details.js';
import { admin } from './styles/admin.js';
import { progress } from './styles/progress.js';
import { utils } from './styles/utils.js';
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
    ${global}
    ${buttons}
    ${modals}
    ${tabs}
    ${search}
    ${cards}
    ${popup}
    ${details}
    ${admin}
    ${progress}
    ${utils}
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
    <script>${clientJS}</script>
</body>
</html>`;
}