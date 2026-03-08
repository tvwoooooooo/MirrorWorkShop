// templates/home/homeIndex.js
import { tabsHTML } from './tabs.js';
import { searchHTML } from './search.js';
import { officialCardHTML } from './officialCard.js';
import { projectGridHTML } from './projectGrid.js';

export const homeHTML = `
<div id="homeView">
    ${tabsHTML}
    ${searchHTML}
    <div id="log-container-wrapper" style="display: none; margin: 1rem; padding: 1rem; background-color: #1e1e1e; border-radius: 8px; border: 1px solid #333;">
      <h3 style="color: #eee; border-bottom: 1px solid #333; padding-bottom: 0.5rem; margin-top: 0;">Backend Logs</h3>
      <pre id="log-container" style="color: #d4d4d4; white-space: pre-wrap; word-wrap: break-word; font-family: monospace; max-height: 400px; overflow-y: auto;"></pre>
    </div>
    ${officialCardHTML}
    ${projectGridHTML}
</div>
`;