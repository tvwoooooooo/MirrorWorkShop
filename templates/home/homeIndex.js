// templates/home/homeIndex.js
import { tabsHTML } from './tabs.js';
import { searchHTML } from './search.js';
import { officialCardHTML } from './officialCard.js';
import { projectGridHTML } from './projectGrid.js';

export const homeHTML = `
<div id="homeView">
    ${tabsHTML}
    ${searchHTML}
    ${officialCardHTML}
    ${projectGridHTML}
</div>
`;