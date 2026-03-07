// templates/common/popup.js
export const popupHTML = `
<div class="popup-overlay" id="releasesPopup">
    <div class="popup-content" id="popupContent">
        <div class="popup-close" id="popupClose"><i class="fas fa-times"></i></div>
        <div class="popup-header">
            <h3 id="popupProjectName">项目名称</h3>
            <div class="version-selector-sm" id="popupVersionSelector">
                <span id="popupSelectedVersion">选择版本</span>
                <i class="fas fa-chevron-down"></i>
                <div class="version-dropdown-sm" id="popupVersionDropdown"></div>
            </div>
        </div>
        <div id="popupReleasesList" class="popup-releases-list"></div>
    </div>
</div>
`;