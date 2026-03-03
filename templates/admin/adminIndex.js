// templates/admin/adminIndex.js
import { adminHeaderHTML } from './adminHeader.js';
import { addProjectHTML } from './addProject.js';
import { autoMonitorHTML } from './autoMonitor.js';
import { s3ConfigHTML } from './s3Config.js';
import { hostnameHTML } from './hostname.js';

export const adminHTML = `
<div id="adminPanel" class="admin-panel">
    ${adminHeaderHTML}
    ${addProjectHTML}
    ${autoMonitorHTML}
    ${s3ConfigHTML}
    ${hostnameHTML}
</div>
`;