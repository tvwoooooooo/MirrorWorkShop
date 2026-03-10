// client.js
export const clientJS = `
(async function() {
    // ============================================================================
    // 1. 核心工具函数
    // ============================================================================

    function safeGet(id) {
        const el = document.getElementById(id);
        if (!el) console.warn('Element not found:', id);
        return el;
    }

    const apiBase = '/api';

    // ============================================================================
    // 2. 全局变量定义
    // ============================================================================

    let githubProjects = [], dockerProjects = [], buckets = [], config = {};
    let currentTab = 'github', searchMode = 'local';

    // 分页相关
    let officialCurrentPage = 1, officialTotal = 0, officialLoading = false, officialHasMore = true, officialQuery = '', officialType = 'github';
    let adminCurrentPage = 1, adminTotal = 0, adminLoading = false, adminHasMore = true, adminQuery = '', adminType = 'github';

    // 桶管理相关
    let deleteModeActive = false;
    let selectedBuckets = new Set();

    // 队列信息相关
    let queueInfoInterval = null;
    let currentProjectToBackup = null;

    // 令牌管理相关
    let githubTokens = [];
    let dockerTokens = [];
    let githubDeleteMode = false;
    let dockerDeleteMode = false;
    let githubSelectedTokens = new Set();
    let dockerSelectedTokens = new Set();

    // 两步备份流程相关变量
    let backupProjectData = null;
    let backupFileTree = [];
    let backupReleases = [];
    let selectedFiles = new Set();
    let selectedAssets = new Set();

    // Docker tags 相关变量
    let backupTags = [];
    let selectedTags = new Set();

    // 日志挂件相关
    let globalLogs = [];
    let newLogCount = 0;

    // 当前查看的项目详情（用于版本切换）
    let currentDetailProject = null;
    let currentDetailType = 'github';
    let currentVersionIndex = 0;
    let cachedMetaData = {}; // 按 metaPath 缓存元数据

    // ============================================================================
    // 3. 数据加载与更新
    // ============================================================================

    async function loadData() {
        try {
            const [githubRes, dockerRes, bucketsRes, configRes] = await Promise.all([
                fetch(apiBase + '/projects/github'),
                fetch(apiBase + '/projects/docker'),
                fetch(apiBase + '/buckets'),
                fetch(apiBase + '/config')
            ]);
            githubProjects = await githubRes.json();
            dockerProjects = await dockerRes.json();
            buckets = await bucketsRes.json();
            config = await configRes.json();

            buckets = buckets.map(b => ({
                ...b,
                usage: b.usage !== undefined ? b.usage : Math.random() * 10,
                total: 10
            }));

            renderBucketsCards();
            updateConfigUI();
        } catch (e) { console.error('加载数据失败', e); }
    }

    function updateConfigUI() {
        const officialHostname = safeGet('officialHostname');
        const bucketHostname = safeGet('bucketHostname');
        if (officialHostname) officialHostname.value = config.officialHostname || '';
        if (bucketHostname) bucketHostname.value = config.bucketHostname || '';
    }

    // ============================================================================
    // 4. 登录状态管理
    // ============================================================================

    let isLoggedIn = false;
    const loginContainer = safeGet('loginContainer');
    const userMenuContainer = safeGet('userMenuContainer');
    const homeView = safeGet('homeView');
    const detailView = safeGet('detailView');
    const adminPanel = safeGet('adminPanel');
    const loginBtn = safeGet('loginBtn');
    const loginModal = safeGet('loginModal');
    const closeLoginModal = safeGet('closeLoginModal');
    const doLogin = safeGet('doLogin');
    const userMenuBtn = safeGet('userMenuBtn');
    const userDropdown = safeGet('userDropdown');
    const goToAdmin = safeGet('goToAdmin');
    const logoutBtn = safeGet('logoutBtn');
    const backHomeBtn = safeGet('backHomeBtn');

    function setLoggedIn(status) {
        isLoggedIn = status;
        if (status) {
            if (loginContainer) loginContainer.classList.add('hide');
            if (userMenuContainer) userMenuContainer.classList.remove('hide');
            if (homeView) homeView.classList.remove('hide');
            if (detailView) detailView.classList.add('hide');
            if (adminPanel) adminPanel.style.display = 'none';
        } else {
            if (loginContainer) loginContainer.classList.remove('hide');
            if (userMenuContainer) userMenuContainer.classList.add('hide');
            if (homeView) homeView.classList.remove('hide');
            if (detailView) detailView.classList.add('hide');
            if (adminPanel) adminPanel.style.display = 'none';
        }
    }
    setLoggedIn(false);

    // ============================================================================
    // 5. 桶卡片渲染
    // ============================================================================

    function renderBucketsCards() {
        const bucketsList = safeGet('bucketsList');
        const snippetsJson = safeGet('snippetsJson');
        if (!bucketsList) return;
        if (!buckets || buckets.length === 0) {
            bucketsList.innerHTML = '<div class="empty-state">暂无桶配置，请添加</div>';
            if (snippetsJson) snippetsJson.value = '';
            return;
        }

        const isDeleteMode = bucketsList.classList.contains('delete-mode');
        const cardsHtml = buckets.map((bucket, index) => {
            const usagePercent = (bucket.usage / bucket.total) * 100;
            let bgColorClass = 'green';
            if (usagePercent >= 80) bgColorClass = 'red';
            else if (usagePercent >= 60) bgColorClass = 'orange';
            else if (usagePercent >= 40) bgColorClass = 'yellow';

            const selectedClass = selectedBuckets.has(index) ? 'bucket-card-selected' : '';

            return \`
                <div class="bucket-card \${isDeleteMode ? 'delete-mode' : ''} \${selectedClass}" data-index="\${index}">
                    <div class="progress-bg \${bgColorClass}" style="width: \${usagePercent}%;"></div>
                    <div class="percentage">\${usagePercent.toFixed(1)}%</div>
                    <div class="checkbox">
                        <input type="checkbox" class="bucket-checkbox" data-index="\${index}" \${selectedBuckets.has(index) ? 'checked' : ''}>
                    </div>
                    <div class="bucket-content">
                        <span class="bucket-name">\${bucket.customName}</span>
                        <i class="fas fa-pen edit-icon" data-index="\${index}"></i>
                    </div>
                </div>
            \`;
        }).join('');
        bucketsList.innerHTML = cardsHtml;

        document.querySelectorAll('.bucket-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.classList.contains('edit-icon') || e.target.classList.contains('bucket-checkbox')) return;
                const isDeleteMode = bucketsList.classList.contains('delete-mode');
                if (isDeleteMode) {
                    const checkbox = card.querySelector('.bucket-checkbox');
                    if (checkbox) {
                        checkbox.checked = !checkbox.checked;
                        const changeEvent = new Event('change', { bubbles: true });
                        checkbox.dispatchEvent(changeEvent);
                    }
                }
            });
        });

        document.querySelectorAll('.edit-icon').forEach(icon => {
            icon.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(icon.dataset.index);
                openBucketModal('edit', index);
            });
        });

        if (snippetsJson) {
            const validBuckets = buckets.filter(b => b.snippetId && b.snippetId.trim() !== '');
            const snippets = validBuckets.reduce((acc, b) => {
                acc[b.customName] = b.snippetId;
                return acc;
            }, {});
            snippetsJson.value = JSON.stringify(snippets, null, 2);
        }
    }

    // ============================================================================
    // 6. 桶管理
    // ============================================================================

    const bucketsList = safeGet('bucketsList');
    const addBucketBtn = safeGet('addBucketBtn');
    const deleteModeBtn = safeGet('deleteModeBtn');
    const bucketModal = safeGet('bucketModal');
    const closeBucketModal = safeGet('closeBucketModal');
    const bucketForm = safeGet('bucketForm');
    const bucketModalTitle = safeGet('bucketModalTitle');
    const bucketCustomName = safeGet('bucketCustomName');
    const bucketKeyID = safeGet('bucketKeyID');
    const bucketAppKey = safeGet('bucketAppKey');
    const bucketName = safeGet('bucketName');
    const bucketEndpoint = safeGet('bucketEndpoint');
    const displayInternalId = safeGet('displayInternalId');
    const internalId = safeGet('internalId');
    const bucketSnippetId = safeGet('bucketSnippetId');
    const editingIndex = safeGet('editingIndex');
    const importJsonBtn = safeGet('importJsonBtn');
    const saveJsonBtn = safeGet('saveJsonBtn');
    const snippetsJson = safeGet('snippetsJson');
    const addHostnameCheck = safeGet('addHostnameCheck');
    const verifyBucketBtn = safeGet('verifyBucketBtn');

    function generateBucketId() {
        return 'bucket-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    }

    function openBucketModal(mode, index = -1) {
        if (!bucketModal) return;

        if (mode === 'add') {
            bucketModalTitle.innerText = '添加新桶';
            bucketCustomName.value = '';
            const newId = generateBucketId();
            if (displayInternalId) displayInternalId.innerText = newId;
            if (internalId) internalId.value = newId;
            bucketKeyID.value = '';
            bucketAppKey.value = '';
            bucketName.value = '';
            bucketEndpoint.value = '';
            bucketSnippetId.value = '';
            editingIndex.value = '-1';
        } else {
            const bucket = buckets[index];
            bucketModalTitle.innerText = '编辑桶';
            bucketCustomName.value = bucket.customName || '';
            if (displayInternalId) displayInternalId.innerText = bucket.id || '';
            if (internalId) internalId.value = bucket.id || '';
            bucketKeyID.value = bucket.keyID || '';
            bucketAppKey.value = bucket.applicationKey || '';
            bucketName.value = bucket.bucketName || '';
            bucketEndpoint.value = bucket.endpoint || '';
            bucketSnippetId.value = bucket.snippetId || '';
            editingIndex.value = index;
        }
        bucketModal.style.display = 'flex';
    }

    function exitDeleteMode() {
        deleteModeActive = false;
        if (bucketsList) bucketsList.classList.remove('delete-mode');
        document.querySelectorAll('.bucket-card').forEach(card => {
            card.classList.remove('bucket-card-selected');
        });
        const cancelBtn = document.getElementById('cancelDeleteBtn');
        if (cancelBtn) cancelBtn.remove();
        if (deleteModeBtn) {
            deleteModeBtn.innerHTML = '<i class="fas fa-trash"></i>';
            deleteModeBtn.classList.add('btn-danger');
        }
        selectedBuckets.clear();
        renderBucketsCards();
    }

    async function saveBucketsToAPI() {
        try {
            const res = await fetch(apiBase + '/buckets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buckets)
            });
            if (!res.ok) throw new Error('保存失败');
            console.log('桶列表已保存');
        } catch (e) {
            console.error('保存桶列表失败', e);
            alert('保存桶列表失败：' + e.message);
        }
    }

    if (addBucketBtn) {
        addBucketBtn.addEventListener('click', () => openBucketModal('add'));
    }

    if (deleteModeBtn) {
        deleteModeBtn.addEventListener('click', () => {
            if (!deleteModeActive) {
                deleteModeActive = true;
                if (bucketsList) bucketsList.classList.add('delete-mode');
                deleteModeBtn.innerHTML = '<i class="fas fa-trash"></i> 删除';
                deleteModeBtn.classList.add('btn-danger');
                const cancelBtn = document.createElement('button');
                cancelBtn.className = 'btn-icon';
                cancelBtn.id = 'cancelDeleteBtn';
                cancelBtn.innerHTML = '<i class="fas fa-times"></i> 取消';
                deleteModeBtn.parentNode.appendChild(cancelBtn);
                cancelBtn.addEventListener('click', exitDeleteMode);
            } else {
                const indicesToDelete = Array.from(selectedBuckets).map(Number).sort((a,b)=>b-a);
                if (indicesToDelete.length === 0) {
                    alert('请至少选择一个桶');
                    return;
                }
                for (const idx of indicesToDelete) {
                    buckets.splice(idx, 1);
                }
                selectedBuckets.clear();
                saveBucketsToAPI().then(() => {
                    exitDeleteMode();
                    renderBucketsCards();
                });
            }
        });
    }

    document.addEventListener('change', (e) => {
        if (e.target.classList.contains('bucket-checkbox')) {
            const index = parseInt(e.target.dataset.index);
            const card = e.target.closest('.bucket-card');
            if (card) {
                if (e.target.checked) {
                    card.classList.add('bucket-card-selected');
                    selectedBuckets.add(index);
                } else {
                    card.classList.remove('bucket-card-selected');
                    selectedBuckets.delete(index);
                }
            }
        }
    });

    if (closeBucketModal) {
        closeBucketModal.addEventListener('click', () => { if (bucketModal) bucketModal.style.display = 'none'; });
    }
    if (bucketModal) {
        bucketModal.addEventListener('click', (e) => { if (e.target === bucketModal) bucketModal.style.display = 'none'; });
    }

    if (bucketForm) {
        bucketForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const customName = bucketCustomName.value.trim();
            const keyID = bucketKeyID.value.trim();
            const appKey = bucketAppKey.value.trim();
            const bktName = bucketName.value.trim();
            const endpoint = bucketEndpoint.value.trim();
            const idValue = internalId.value.trim();
            const snippetId = bucketSnippetId.value.trim();
            const index = parseInt(editingIndex.value);

            if (!customName || !keyID || !appKey || !bktName || !endpoint) {
                alert('请填写所有必填项');
                return;
            }

            if (!idValue) {
                alert('内部ID不能为空，请刷新重试');
                return;
            }

            const newBucket = {
                id: idValue,
                customName,
                keyID,
                applicationKey: appKey,
                bucketName: bktName,
                endpoint,
                snippetId: snippetId || '',
                usage: Math.random() * 10,
                total: 10
            };

            if (index === -1) {
                buckets.push(newBucket);
            } else {
                const old = buckets[index];
                buckets[index] = { ...old, ...newBucket, usage: old.usage, total: old.total };
            }

            await saveBucketsToAPI();
            if (bucketModal) bucketModal.style.display = 'none';
            if (deleteModeActive) {
                exitDeleteMode();
            } else {
                renderBucketsCards();
            }
        });
    }

    if (importJsonBtn && snippetsJson) {
        importJsonBtn.addEventListener('click', () => {
            try {
                const json = JSON.parse(snippetsJson.value);
                Object.entries(json).forEach(([customName, snippetId]) => {
                    const bucket = buckets.find(b => b.customName === customName);
                    if (bucket) {
                        bucket.snippetId = snippetId;
                    } else {
                        console.warn('桶不存在:', customName);
                    }
                });
                renderBucketsCards();
                saveBucketsToAPI();
                alert('JSON 已导入并更新桶标识');
            } catch (e) {
                alert('JSON 格式错误：' + e.message);
            }
        });
    }

    if (saveJsonBtn && snippetsJson) {
        saveJsonBtn.addEventListener('click', () => {
            try {
                const json = JSON.parse(snippetsJson.value);
                Object.entries(json).forEach(([customName, snippetId]) => {
                    const bucket = buckets.find(b => b.customName === customName);
                    if (bucket) {
                        bucket.snippetId = snippetId;
                    } else {
                        console.warn('桶不存在:', customName);
                    }
                });
                renderBucketsCards();
                saveBucketsToAPI();
                alert('Snippets 配置已保存');
            } catch (e) {
                alert('JSON 格式错误：' + e.message);
            }
        });
    }

    if (verifyBucketBtn) {
        verifyBucketBtn.addEventListener('click', async () => {
            const keyID = bucketKeyID.value.trim();
            const appKey = bucketAppKey.value.trim();
            const bktName = bucketName.value.trim();
            const endpoint = bucketEndpoint.value.trim();

            if (!keyID || !appKey || !bktName || !endpoint) {
                alert('请先填写密钥ID、密钥、存储桶名和端点');
                return;
            }

            const originalText = verifyBucketBtn.innerText;
            verifyBucketBtn.innerText = '验证中...';
            verifyBucketBtn.disabled = true;

            try {
                const res = await fetch(apiBase + '/verify-bucket', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        keyID,
                        applicationKey: appKey,
                        bucketName: bktName,
                        endpoint
                    })
                });

                const result = await res.json();
                if (result.success) {
                    alert('✅ 连接成功！');
                } else {
                    alert('❌ 连接失败：' + (result.error || '未知错误'));
                }
            } catch (e) {
                alert('验证请求失败：' + e.message);
            } finally {
                verifyBucketBtn.innerText = originalText;
                verifyBucketBtn.disabled = false;
            }
        });
    }

    // ============================================================================
    // 7. 保存自定义主机名配置
    // ============================================================================
    const saveHostnameBtn = safeGet('saveHostnameBtn');
    if (saveHostnameBtn) {
        saveHostnameBtn.addEventListener('click', async () => {
            const officialHostname = safeGet('officialHostname');
            const bucketHostname = safeGet('bucketHostname');
            if (!officialHostname || !bucketHostname) return;
            
            config.officialHostname = officialHostname.value;
            config.bucketHostname = bucketHostname.value;
            
            try {
                const res = await fetch(apiBase + '/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });
                if (res.ok) {
                    alert('主机名配置已保存');
                } else {
                    alert('保存失败');
                }
            } catch (e) {
                alert('保存失败：' + e.message);
            }
        });
    }

    // ============================================================================
    // 8. 保存自动监控配置
    // ============================================================================
    const saveMonitorBtn = safeGet('saveMonitorBtn');
    const monitorSwitch = safeGet('monitorSwitch');
    const monitorDays = safeGet('monitorDays');
    if (saveMonitorBtn) {
        saveMonitorBtn.addEventListener('click', async () => {
            const scope = document.querySelector('input[name="monitorScope"]:checked')?.value;
            config.monitor = {
                enabled: monitorSwitch ? monitorSwitch.checked : false,
                scope: scope || 'all',
                customProjects: config.monitor?.customProjects || [],
                intervalDays: monitorDays ? parseInt(monitorDays.value) : 1
            };
            try {
                const res = await fetch(apiBase + '/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config)
                });
                if (res.ok) {
                    alert('监控配置已保存');
                } else {
                    alert('保存失败');
                }
            } catch (e) {
                alert('保存失败：' + e.message);
            }
        });
    }

    // ============================================================================
    // 9. 令牌管理（GitHub 和 Docker）
    // ============================================================================

    async function loadGithubTokens() {
        try {
            const res = await fetch(apiBase + '/tokens/github');
            if (!res.ok) throw new Error('加载失败');
            githubTokens = await res.json();
            renderGithubTokens();
        } catch (e) {
            console.error('加载 GitHub 令牌失败', e);
        }
    }

    async function loadDockerTokens() {
        try {
            const res = await fetch(apiBase + '/tokens/docker');
            if (!res.ok) throw new Error('加载失败');
            dockerTokens = await res.json();
            renderDockerTokens();
        } catch (e) {
            console.error('加载 Docker 令牌失败', e);
        }
    }

    function renderGithubTokens() {
        const container = safeGet('githubTokensList');
        if (!container) return;
        if (githubTokens.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无 GitHub 令牌</div>';
            return;
        }
        const isDeleteMode = githubDeleteMode;
        const cardsHtml = githubTokens.map(token => {
            const selectedClass = githubSelectedTokens.has(token.index) ? 'bucket-card-selected' : '';
            return \`
                <div class="bucket-card \${isDeleteMode ? 'delete-mode' : ''} \${selectedClass}" data-index="\${token.index}">
                    <div class="bucket-content">
                        <span class="bucket-name">\${token.name}</span>
                        <span class="bucket-usage">使用: \${token.usageCount}</span>
                    </div>
                </div>
            \`;
        }).join('');
        container.innerHTML = cardsHtml;

        document.querySelectorAll('#githubTokensList .bucket-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (!githubDeleteMode) return;
                const index = parseInt(card.dataset.index);
                if (githubSelectedTokens.has(index)) {
                    githubSelectedTokens.delete(index);
                    card.classList.remove('bucket-card-selected');
                } else {
                    githubSelectedTokens.add(index);
                    card.classList.add('bucket-card-selected');
                }
            });
        });
    }

    function renderDockerTokens() {
        const container = safeGet('dockerTokensList');
        if (!container) return;
        if (dockerTokens.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无 Docker 令牌</div>';
            return;
        }
        const isDeleteMode = dockerDeleteMode;
        const cardsHtml = dockerTokens.map(token => {
            const selectedClass = dockerSelectedTokens.has(token.index) ? 'bucket-card-selected' : '';
            return \`
                <div class="bucket-card \${isDeleteMode ? 'delete-mode' : ''} \${selectedClass}" data-index="\${token.index}">
                    <div class="bucket-content">
                        <span class="bucket-name">\${token.name}</span>
                        <span class="bucket-usage">使用: \${token.usageCount}</span>
                    </div>
                </div>
            \`;
        }).join('');
        container.innerHTML = cardsHtml;

        document.querySelectorAll('#dockerTokensList .bucket-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (!dockerDeleteMode) return;
                const index = parseInt(card.dataset.index);
                if (dockerSelectedTokens.has(index)) {
                    dockerSelectedTokens.delete(index);
                    card.classList.remove('bucket-card-selected');
                } else {
                    dockerSelectedTokens.add(index);
                    card.classList.add('bucket-card-selected');
                }
            });
        });
    }

    function toggleGithubDeleteMode() {
        const deleteBtn = safeGet('deleteGithubTokenBtn');
        if (!deleteBtn) return;
        
        if (!githubDeleteMode) {
            githubDeleteMode = true;
            deleteBtn.innerHTML = '<i class="fas fa-trash"></i> 删除';
            let cancelBtn = document.getElementById('cancelGithubDelete');
            if (!cancelBtn) {
                cancelBtn = document.createElement('button');
                cancelBtn.className = 'btn-icon';
                cancelBtn.id = 'cancelGithubDelete';
                cancelBtn.innerHTML = '<i class="fas fa-times"></i> 取消';
                deleteBtn.parentNode.appendChild(cancelBtn);
                cancelBtn.addEventListener('click', () => {
                    githubDeleteMode = false;
                    deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
                    cancelBtn.remove();
                    githubSelectedTokens.clear();
                    renderGithubTokens();
                });
            }
            renderGithubTokens();
        } else {
            if (githubSelectedTokens.size === 0) {
                alert('请至少选择一个令牌');
                return;
            }
            const indices = Array.from(githubSelectedTokens).sort((a,b)=>b-a);
            Promise.all(indices.map(async idx => {
                await fetch(apiBase + '/tokens/github?index=' + idx, { method: 'DELETE' });
            })).then(() => {
                loadGithubTokens();
                githubDeleteMode = false;
                deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
                document.getElementById('cancelGithubDelete')?.remove();
                githubSelectedTokens.clear();
            }).catch(e => alert('删除失败：' + e.message));
        }
    }

    function toggleDockerDeleteMode() {
        const deleteBtn = safeGet('deleteDockerTokenBtn');
        if (!deleteBtn) return;
        
        if (!dockerDeleteMode) {
            dockerDeleteMode = true;
            deleteBtn.innerHTML = '<i class="fas fa-trash"></i> 删除';
            let cancelBtn = document.getElementById('cancelDockerDelete');
            if (!cancelBtn) {
                cancelBtn = document.createElement('button');
                cancelBtn.className = 'btn-icon';
                cancelBtn.id = 'cancelDockerDelete';
                cancelBtn.innerHTML = '<i class="fas fa-times"></i> 取消';
                deleteBtn.parentNode.appendChild(cancelBtn);
                cancelBtn.addEventListener('click', () => {
                    dockerDeleteMode = false;
                    deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
                    cancelBtn.remove();
                    dockerSelectedTokens.clear();
                    renderDockerTokens();
                });
            }
            renderDockerTokens();
        } else {
            if (dockerSelectedTokens.size === 0) {
                alert('请至少选择一个令牌');
                return;
            }
            const indices = Array.from(dockerSelectedTokens).sort((a,b)=>b-a);
            Promise.all(indices.map(async idx => {
                await fetch(apiBase + '/tokens/docker?index=' + idx, { method: 'DELETE' });
            })).then(() => {
                loadDockerTokens();
                dockerDeleteMode = false;
                deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
                document.getElementById('cancelDockerDelete')?.remove();
                dockerSelectedTokens.clear();
            }).catch(e => alert('删除失败：' + e.message));
        }
    }

    const githubTokenModal = safeGet('githubTokenModal');
    const closeGithubTokenModal = safeGet('closeGithubTokenModal');
    const githubTokenForm = safeGet('githubTokenForm');
    const githubTokenName = safeGet('githubTokenName');
    const githubTokenValue = safeGet('githubTokenValue');
    const editingGithubTokenIndex = safeGet('editingGithubTokenIndex');

    function openGithubTokenModal() {
        githubTokenName.value = '';
        githubTokenValue.value = '';
        editingGithubTokenIndex.value = '-1';
        githubTokenModal.style.display = 'flex';
    }

    if (closeGithubTokenModal) {
        closeGithubTokenModal.addEventListener('click', () => { githubTokenModal.style.display = 'none'; });
    }
    if (githubTokenModal) {
        githubTokenModal.addEventListener('click', (e) => { if (e.target === githubTokenModal) githubTokenModal.style.display = 'none'; });
    }

    if (githubTokenForm) {
        githubTokenForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = githubTokenName.value.trim();
            const token = githubTokenValue.value.trim();
            if (!name || !token) {
                alert('请填写名称和令牌');
                return;
            }
            const res = await fetch(apiBase + '/tokens/github', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, token })
            });
            if (res.ok) {
                alert('令牌已保存');
                githubTokenModal.style.display = 'none';
                await loadGithubTokens();
            } else {
                alert('保存失败');
            }
        });
    }

    const dockerTokenModal = safeGet('dockerTokenModal');
    const closeDockerTokenModal = safeGet('closeDockerTokenModal');
    const dockerTokenForm = safeGet('dockerTokenForm');
    const dockerTokenName = safeGet('dockerTokenName');
    const dockerTokenValue = safeGet('dockerTokenValue');
    const editingDockerTokenIndex = safeGet('editingDockerTokenIndex');

    function openDockerTokenModal() {
        dockerTokenName.value = '';
        dockerTokenValue.value = '';
        editingDockerTokenIndex.value = '-1';
        dockerTokenModal.style.display = 'flex';
    }

    if (closeDockerTokenModal) {
        closeDockerTokenModal.addEventListener('click', () => { dockerTokenModal.style.display = 'none'; });
    }
    if (dockerTokenModal) {
        dockerTokenModal.addEventListener('click', (e) => { if (e.target === dockerTokenModal) dockerTokenModal.style.display = 'none'; });
    }

    if (dockerTokenForm) {
        dockerTokenForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = dockerTokenName.value.trim();
            const username = document.getElementById('dockerUsername').value.trim();
            const token = dockerTokenValue.value.trim();
            if (!name || !token || !username) {
                alert('请填写名称、用户名和令牌');
                return;
            }
            const res = await fetch(apiBase + '/tokens/docker', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, username, token })
            });
            if (res.ok) {
                alert('令牌已保存');
                dockerTokenModal.style.display = 'none';
                await loadDockerTokens();
            } else {
                alert('保存失败');
            }
        });
    }

    const tokenTabs = document.querySelectorAll('.token-tab');
    const githubPanel = safeGet('githubTokenPanel');
    const dockerPanel = safeGet('dockerTokenPanel');
    const githubActions = safeGet('githubActions');
    const dockerActions = safeGet('dockerActions');

    if (tokenTabs.length) {
        tokenTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tokenTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const type = tab.dataset.tokenType;
                if (type === 'github') {
                    if (githubPanel) githubPanel.classList.remove('hide');
                    if (dockerPanel) dockerPanel.classList.add('hide');
                    if (githubActions) githubActions.classList.remove('hide');
                    if (dockerActions) dockerActions.classList.add('hide');
                } else {
                    if (githubPanel) githubPanel.classList.add('hide');
                    if (dockerPanel) dockerPanel.classList.remove('hide');
                    if (githubActions) githubActions.classList.add('hide');
                    if (dockerActions) dockerActions.classList.remove('hide');
                }
            });
        });
    }

    const addGithubBtn = safeGet('addGithubTokenBtn');
    if (addGithubBtn) addGithubBtn.addEventListener('click', openGithubTokenModal);

    const addDockerBtn = safeGet('addDockerTokenBtn');
    if (addDockerBtn) addDockerBtn.addEventListener('click', openDockerTokenModal);

    const deleteGithubBtn = safeGet('deleteGithubTokenBtn');
    if (deleteGithubBtn) deleteGithubBtn.addEventListener('click', toggleGithubDeleteMode);

    const deleteDockerBtn = safeGet('deleteDockerTokenBtn');
    if (deleteDockerBtn) deleteDockerBtn.addEventListener('click', toggleDockerDeleteMode);

    // ============================================================================
    // 10. 首页搜索功能
    // ============================================================================

    const modeToggleBtn = safeGet('modeToggleBtn');
    const modeText = safeGet('modeText');
    const officialBadgeText = safeGet('officialBadgeText');
    const homeSearchBtn = safeGet('homeSearchBtn');
    const homeSearchInput = safeGet('homeSearchInput');
    const officialCard = safeGet('officialResultCard');
    const officialResultsList = safeGet('officialResultsList');

    function toggleSearchMode() {
        searchMode = searchMode === 'local' ? 'official' : 'local';
        if (modeText) modeText.innerText = searchMode === 'local' ? '存储库' : (currentTab === 'github' ? 'GitHub 搜索' : 'Docker 搜索');
        if (officialCard) officialCard.classList.add('hide');
    }
    if (modeToggleBtn) modeToggleBtn.addEventListener('click', toggleSearchMode);

    async function loadOfficialResults(query, type, page) {
        if (officialLoading) return;

        if (page === 1) {
            clearLogs(); // 新的搜索开始时清空日志
        }
        
        const oldLoading = document.getElementById('official-loading-item');
        if (oldLoading) oldLoading.remove();

        officialLoading = true;
        const loadingItem = document.createElement('div');
        loadingItem.className = 'loading-indicator';
        loadingItem.id = 'official-loading-item';
        loadingItem.innerText = '加载中...';
        if (officialResultsList) officialResultsList.appendChild(loadingItem);

        try {
            const res = await fetch(\`\${apiBase}/search?q=\${encodeURIComponent(query)}&type=\${type}&page=\${page}\`);
            if (!res.ok) throw new Error('搜索失败');
            const data = await res.json();
            
            if (data.logs) updateLogView(data.logs);

            const newItems = data.items;
            officialTotal = data.total;
            officialHasMore = newItems.length === 10 && (page * 10) < officialTotal;

            if (page === 1 && officialResultsList) officialResultsList.innerHTML = '';
            else document.getElementById('official-loading-item')?.remove();

            newItems.forEach(item => {
                const isGitHub = item.type === 'github';
                const bgIconClass = isGitHub ? 'fab fa-github' : 'fab fa-docker';
                const releaseButton = item.has_releases ? \`<button class="btn-icon btn-release" data-project='\${JSON.stringify(item)}'><i class="fas fa-tag"></i> Releases</button>\` : '';
                const itemHtml = \`
                    <div class="official-result-item" data-repo='\${JSON.stringify(item)}'>
                        <div class="card-bg-icon"><i class="\${bgIconClass}"></i></div>
                        <div class="official-item-header">
                            <a href="\${item.homepage}" target="_blank" class="official-item-name">\${item.name}</a>
                            <div class="official-item-stats">
                                <span><i class="\${isGitHub ? 'fas fa-code-branch' : 'fas fa-download'}"></i> \${isGitHub ? (item.forks || 0) : (item.pulls || 0)}</span>
                                <span><i class="far fa-star"></i> \${item.stars || 0}</span>
                            </div>
                            <span class="official-item-lastupdate"><i class="far fa-calendar-alt"></i> \${item.lastUpdate || '未知'}</span>
                        </div>
                        <div class="official-item-description">\${item.description}</div>
                        <div class="official-item-actions">
                            <button class="btn-icon git-link-btn"><i class="far fa-copy"></i> Git链接</button>
                            <button class="btn-icon btn-download"><i class="fas fa-file-zipper"></i> 下载ZIP</button>
                            <button class="btn-icon btn-stream"><i class="fas fa-water"></i> 流式</button>
                            \${releaseButton}
                        </div>
                    </div>
                \`;
                if (officialResultsList) officialResultsList.insertAdjacentHTML('beforeend', itemHtml);
            });

            if (officialHasMore && officialResultsList) {
                const newLoadingItem = document.createElement('div');
                newLoadingItem.className = 'loading-indicator hide';
                newLoadingItem.id = 'official-loading-item';
                newLoadingItem.innerText = '加载中...';
                officialResultsList.appendChild(newLoadingItem);
            }

            if (officialResultsList) {
                officialResultsList.addEventListener('click', async (e) => {
                    const btn = e.target.closest('.btn-release');
                    if (!btn) return;
                    e.stopPropagation();
                    
                    const projectData = btn.dataset.project;
                    if (!projectData) {
                        console.error('No project data found on Releases button');
                        return;
                    }
                    
                    try {
                        const proj = JSON.parse(projectData);
                        let releases = [];
                        if (proj.type === 'github') {
                            const url = \`https://api.github.com/repos/\${proj.owner}/\${proj.repo}/releases\`;
                            const res = await fetch(url, {
                                headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'B2-Mirror-Worker' }
                            });
                            if (res.ok) {
                                const data = await res.json();
                                releases = data.map(r => ({
                                    tag: r.tag_name,
                                    date: r.published_at?.split('T')[0] || r.created_at?.split('T')[0],
                                    assets: r.assets.map(a => ({
                                        name: a.name,
                                        size: a.size,
                                        url: a.browser_download_url
                                    }))
                                }));
                            }
                        } else {
                            const url = \`https://hub.docker.com/v2/repositories/\${proj.owner}/\${proj.repo}/tags/?page_size=20\`;
                            const res = await fetch(url, {
                                headers: { 'Accept': 'application/json', 'User-Agent': 'B2-Mirror-Worker' }
                            });
                            if (res.ok) {
                                const data = await res.json();
                                releases = data.results.map(t => ({
                                    tag: t.name,
                                    date: t.last_updated?.split('T')[0],
                                    assets: []
                                }));
                            }
                        }
                        const versions = releases.map(r => ({
                            date: r.date || '未知',
                            releases: [r]
                        }));
                        showReleasesPopup(versions, proj.name, proj.type, 0, true);
                    } catch (err) {
                        console.error('Failed to parse project data', err);
                    }
                });
            }

        } catch (error) {
            alert('搜索出错：' + error.message);
        } finally {
            officialLoading = false;
            const li = document.getElementById('official-loading-item');
            if (li) li.classList.add('hide');
        }
    }

    if (officialResultsList) {
        officialResultsList.addEventListener('scroll', () => {
            if (!officialHasMore || officialLoading) return;
            const { scrollTop, scrollHeight, clientHeight } = officialResultsList;
            if (scrollTop + clientHeight >= scrollHeight - 50) {
                const li = document.getElementById('official-loading-item');
                if (li) li.classList.remove('hide');
                officialCurrentPage++;
                loadOfficialResults(officialQuery, officialType, officialCurrentPage);
            }
        });
    }

    if (homeSearchBtn) {
        homeSearchBtn.addEventListener('click', async () => {
            const query = homeSearchInput ? homeSearchInput.value.trim() : '';
            if (!query) { alert('请输入搜索关键词'); return; }
            if (searchMode === 'local') {
                const allProjects = [...githubProjects, ...dockerProjects];
                const results = allProjects.filter(p => p.name.toLowerCase().includes(query.toLowerCase()));
                if (results.length === 0) { alert('未找到本地项目'); return; }
                if (officialResultsList) {
                    officialResultsList.innerHTML = results.map(p => {
                        const type = p.homepage.includes('github') ? 'github' : 'docker';
                        const isGitHub = type === 'github';
                        const bgIconClass = isGitHub ? 'fab fa-github' : 'fab fa-docker';
                        const hasReleases = p.versions && p.versions.some(v => v.releases && v.releases.length > 0);
                        const releaseButton = hasReleases ? \`<button class="btn-icon btn-release" data-project='\${JSON.stringify(p)}'><i class="fas fa-tag"></i> Releases</button>\` : '';
                        return \`
                            <div class="official-result-item">
                                <div class="card-bg-icon"><i class="\${bgIconClass}"></i></div>
                                <div class="official-item-header">
                                    <a href="\${p.homepage}" target="_blank" class="official-item-name">\${p.name}</a>
                                    <div class="official-item-stats">
                                        <span><i class="\${isGitHub ? 'fas fa-code-branch' : 'fas fa-download'}"></i> 0</span>
                                        <span><i class="far fa-star"></i> 0</span>
                                    </div>
                                    <span class="official-item-lastupdate"><i class="far fa-calendar-alt"></i> \${p.lastUpdate}</span>
                                </div>
                                <div class="official-item-description">存储库项目</div>
                                <div class="official-item-actions">
                                    <button class="btn-icon git-link-btn"><i class="far fa-copy"></i> Git链接</button>
                                    <button class="btn-icon btn-download"><i class="fas fa-file-zipper"></i> 下载ZIP</button>
                                    <button class="btn-icon btn-stream"><i class="fas fa-water"></i> 流式</button>
                                    \${releaseButton}
                                </div>
                            </div>\`;
                    }).join('');
                }
                if (officialCard) officialCard.classList.remove('hide');
            } else {
                officialQuery = query;
                officialType = currentTab === 'github' ? 'github' : 'docker';
                officialCurrentPage = 1;
                officialHasMore = true;
                if (officialBadgeText) officialBadgeText.innerText = currentTab === 'github' ? 'GitHub' : 'Docker';
                if (officialCard) officialCard.classList.remove('hide');
                await loadOfficialResults(officialQuery, officialType, 1);
            }
        });
    }

    // ============================================================================
    // 11. 后台项目添加搜索
    // ============================================================================

    const addModeToggle = safeGet('addModeToggle');
    const addModeText = safeGet('addModeText');
    const searchProjectBtn = safeGet('searchProjectBtn');
    const searchProjectInput = safeGet('searchProjectInput');
    const searchResultArea = safeGet('searchResultArea');
    const searchResultList = safeGet('searchResultList');
    const searchResultsScroll = safeGet('searchResultsScroll');
    const selectBucketModal = safeGet('selectBucketModal');
    const closeSelectBucketModal = safeGet('closeSelectBucketModal');
    const bucketCardGrid = safeGet('bucketCardGrid');
    const confirmSelectBucketBtn = safeGet('confirmSelectBucketBtn');

    let addMode = 'GitHub';
    if (addModeToggle) {
        addModeToggle.addEventListener('click', () => {
            addMode = addMode === 'GitHub' ? 'Docker' : 'GitHub';
            if (addModeText) addModeText.innerText = addMode;
        });
    }

    async function loadAdminResults(query, type, page) {
        if (adminLoading) return;
        
        const oldLoading = document.getElementById('admin-loading-item');
        if (oldLoading) oldLoading.remove();

        adminLoading = true;
        const loadingItem = document.createElement('div');
        loadingItem.className = 'loading-indicator';
        loadingItem.id = 'admin-loading-item';
        loadingItem.innerText = '加载中...';
        if (searchResultsScroll) searchResultsScroll.appendChild(loadingItem);

        try {
            const res = await fetch(\`\${apiBase}/search?q=\${encodeURIComponent(query)}&type=\${type}&page=\${page}\`);
            if (!res.ok) throw new Error('搜索失败');
            const data = await res.json();
            const newItems = data.items;
            adminTotal = data.total;
            adminHasMore = newItems.length === 30 && (page * 30) < adminTotal;

            if (page === 1 && searchResultList) searchResultList.innerHTML = '';

            newItems.forEach(item => {
                const isGitHub = item.type === 'github';
                const itemHtml = \`
                    <div class="search-result-item">
                        <span style="display: flex; align-items: center; gap: 0.5rem;">
                            <i class="\${isGitHub ? 'fab fa-github' : 'fab fa-docker'}"></i>
                            <strong>\${item.name}</strong>
                            <span style="color:#64748b; font-size:0.8rem;">
                                <i class="\${isGitHub ? 'fas fa-code-branch' : 'fas fa-download'}"></i> \${isGitHub ? item.forks : item.pulls}
                                <i class="far fa-star"></i> \${item.stars}
                            </span>
                        </span>
                        <div>
                            <button class="save-btn backup-btn" data-name="\${item.name}" data-type="\${item.type}" data-owner="\${item.owner}" data-repo="\${item.repo}">完整备份</button>
                        </div>
                    </div>\`;
                if (searchResultList) searchResultList.insertAdjacentHTML('beforeend', itemHtml);
            });

            if (adminHasMore && searchResultsScroll) {
                const newLoadingItem = document.createElement('div');
                newLoadingItem.className = 'loading-indicator';
                newLoadingItem.id = 'admin-loading-item';
                newLoadingItem.innerText = '加载中...';
                newLoadingItem.style.display = 'none';
                searchResultsScroll.appendChild(newLoadingItem);
            } else {
                document.getElementById('admin-loading-item')?.remove();
            }

            document.querySelectorAll('.backup-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const name = e.target.dataset.name;
                    const type = e.target.dataset.type;
                    const owner = e.target.dataset.owner;
                    const repo = e.target.dataset.repo;
                    if (type === 'github') {
                        openBackupContentModal({ name, type, owner, repo });
                    } else {
                        openBackupContentModal({ name, type, owner, repo }); // Docker 也使用同一函数
                    }
                });
            });

        } catch (error) {
            alert('搜索出错：' + error.message);
        } finally {
            adminLoading = false;
            if (!adminHasMore) {
                document.getElementById('admin-loading-item')?.remove();
            } else {
                const li = document.getElementById('admin-loading-item');
                if (li) li.style.display = 'none';
            }
        }
    }

    if (searchResultsScroll) {
        searchResultsScroll.addEventListener('scroll', () => {
            if (!adminHasMore || adminLoading) return;
            const { scrollTop, scrollHeight, clientHeight } = searchResultsScroll;
            if (scrollTop + clientHeight >= scrollHeight - 50) {
                const li = document.getElementById('admin-loading-item');
                if (li) {
                    li.style.display = 'block';
                    adminCurrentPage++;
                    loadAdminResults(adminQuery, adminType, adminCurrentPage);
                }
            }
        });
    }

    if (searchProjectBtn) {
        searchProjectBtn.addEventListener('click', async () => {
            const query = searchProjectInput ? searchProjectInput.value.trim() : '';
            if (!query) { alert('请输入搜索关键词'); return; }
            adminQuery = query;
            adminType = addMode === 'GitHub' ? 'github' : 'docker';
            adminCurrentPage = 1;
            adminHasMore = true;
            if (searchResultArea) searchResultArea.classList.remove('hide');
            await loadAdminResults(adminQuery, adminType, 1);
        });
    }

    function openSelectBucketModal() {
        if (!bucketCardGrid || !selectBucketModal) return;
        
        if (buckets.length === 0) {
            bucketCardGrid.innerHTML = '<div class="empty-state">暂无桶配置，请先添加</div>';
        } else {
            const cardsHtml = buckets.map((bucket, index) => {
                const usagePercent = (bucket.usage / bucket.total) * 100;
                let bgColorClass = 'green';
                if (usagePercent >= 80) bgColorClass = 'red';
                else if (usagePercent >= 60) bgColorClass = 'orange';
                else if (usagePercent >= 40) bgColorClass = 'yellow';

                return \`
                    <div class="bucket-card selectable-card" data-bucket-id="\${bucket.id}" data-index="\${index}">
                        <div class="progress-bg \${bgColorClass}" style="width: \${usagePercent}%;"></div>
                        <div class="percentage">\${usagePercent.toFixed(1)}%</div>
                        <div class="bucket-content">
                            <span class="bucket-name">\${bucket.customName}</span>
                        </div>
                    </div>
                \`;
            }).join('');
            bucketCardGrid.innerHTML = cardsHtml;

            document.querySelectorAll('.selectable-card').forEach(card => {
                card.addEventListener('click', () => {
                    document.querySelectorAll('.selectable-card').forEach(c => c.classList.remove('bucket-card-selected'));
                    card.classList.add('bucket-card-selected');
                });
            });
        }
        selectBucketModal.style.display = 'flex';
    }

    if (closeSelectBucketModal) {
        closeSelectBucketModal.addEventListener('click', () => {
            if (selectBucketModal) selectBucketModal.style.display = 'none';
        });
    }
    if (selectBucketModal) {
        selectBucketModal.addEventListener('click', (e) => {
            if (e.target === selectBucketModal) selectBucketModal.style.display = 'none';
        });
    }

    if (confirmSelectBucketBtn) {
        confirmSelectBucketBtn.addEventListener('click', async () => {
            const selectedCard = document.querySelector('.selectable-card.bucket-card-selected');
            if (!selectedCard) {
                alert('请选择一个桶');
                return;
            }
            const bucketId = selectedCard.dataset.bucketId;
            const project = currentProjectToBackup;
            if (!project) {
                alert('项目信息丢失');
                return;
            }
            const res = await fetch(apiBase + '/project', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: project.type, name: project.name, bucketId })
            });
            const result = await res.json();
            if (result.success) {
                alert(\`完整备份任务已提交，任务ID: \${result.taskId}\`);
                pollTaskStatus(result.taskId);
                selectBucketModal.style.display = 'none';
                currentProjectToBackup = null;
            } else {
                alert('保存失败：' + (result.error || '未知错误'));
            }
        });
    }

    // ============================================================================
    // 12. 两步备份流程函数（支持 GitHub 和 Docker）
    // ============================================================================

    const backupModal = safeGet('backupContentModal');
    const closeBackupModal = safeGet('closeBackupModal');
    const backupStep1 = safeGet('backupStep1');
    const backupStep2 = safeGet('backupStep2');
    const backupPrevBtn = safeGet('backupPrevBtn');
    const backupNextBtn = safeGet('backupNextBtn');
    const backupSaveBtn = safeGet('backupSaveBtn');
    const backupCancelBtn = safeGet('backupCancelBtn');
    const backupProjectName = safeGet('backupProjectName');
    const backupTypeIcon = safeGet('backupTypeIcon');
    const fileTreeContainer = safeGet('fileTreeContainer');
    const releasesContainer = safeGet('releasesContainer');
    const selectAllFiles = safeGet('selectAllFiles');
    const selectAllReleases = safeGet('selectAllReleases');
    const selectedFilesCount = safeGet('selectedFilesCount');
    const selectedReleasesCount = safeGet('selectedReleasesCount');
    // Docker tags 相关元素
    const tagsContainer = safeGet('tagsContainer');
    const selectAllTags = safeGet('selectAllTags');
    const selectedTagsCount = safeGet('selectedTagsCount');
    const githubContent = safeGet('githubContent');
    const dockerContent = safeGet('dockerContent');
    const step2BucketGrid = safeGet('step2BucketGrid');

    async function openBackupContentModal(project) {
        backupProjectData = project;
        backupModal.style.display = 'flex';
        backupStep1.classList.remove('hide');
        backupStep2.classList.add('hide');
        backupPrevBtn.style.display = 'none';
        backupNextBtn.style.display = 'inline-block';
        backupSaveBtn.style.display = 'none';
        backupProjectName.innerText = project.name;
        backupTypeIcon.className = project.type === 'github' ? 'fab fa-github' : 'fab fa-docker';

        // 根据类型显示对应内容区域
        if (project.type === 'github') {
            githubContent.classList.remove('hide');
            dockerContent.classList.add('hide');
            // 加载 GitHub 数据
            fileTreeContainer.innerHTML = '<div class="loading-indicator">加载文件列表中...</div>';
            releasesContainer.innerHTML = '<div class="loading-indicator">加载 Releases 中...</div>';
            selectedFiles.clear();
            selectedAssets.clear();
            if (selectAllFiles) selectAllFiles.checked = true;
            if (selectAllReleases) selectAllReleases.checked = false;
            if (selectedFilesCount) selectedFilesCount.innerText = '全部文件';
            if (selectedReleasesCount) selectedReleasesCount.innerText = '0 个版本';

            // 加载文件树
            try {
                const res = await fetch(\`/api/repo-tree?owner=\${project.owner}&repo=\${project.repo}\`);
                if (!res.ok) throw new Error('获取文件树失败');
                backupFileTree = await res.json();
                renderFileTree();
            } catch (e) {
                fileTreeContainer.innerHTML = \`<div class="empty-state">加载失败：\${e.message}</div>\`;
            }

            // 加载 Releases
            try {
                const res = await fetch(\`/api/repo-releases?owner=\${project.owner}&repo=\${project.repo}\`);
                if (!res.ok) throw new Error('获取 Releases 失败');
                backupReleases = await res.json();
                renderReleases();
            } catch (e) {
                releasesContainer.innerHTML = \`<div class="empty-state">加载失败：\${e.message}</div>\`;
            }
        } else {
            githubContent.classList.add('hide');
            dockerContent.classList.remove('hide');
            // 加载 Docker tags
            tagsContainer.innerHTML = '<div class="loading-indicator">加载版本列表中...</div>';
            selectedTags.clear();
            if (selectAllTags) selectAllTags.checked = false;
            if (selectedTagsCount) selectedTagsCount.innerText = '0 个版本';

            try {
                const res = await fetch(\`/api/docker-tags?repo=\${project.name}\`);
                if (!res.ok) throw new Error('获取 tags 失败');
                const data = await res.json();
                backupTags = data.items || [];
                renderTags();
            } catch (e) {
                tagsContainer.innerHTML = \`<div class="empty-state">加载失败：\${e.message}</div>\`;
            }
        }
    }

    function renderFileTree() {
        if (!backupFileTree || backupFileTree.length === 0) {
            fileTreeContainer.innerHTML = '<div class="empty-state">无文件</div>';
            return;
        }
        let html = '';
        backupFileTree.forEach(path => {
            html += \`
                <div class="file-item">
                    <input type="checkbox" class="file-checkbox" data-path="\${path}" checked>
                    <span class="file-name">\${path}</span>
                </div>
            \`;
        });
        fileTreeContainer.innerHTML = html;

        document.querySelectorAll('.file-checkbox').forEach(cb => {
            cb.addEventListener('change', updateSelectedFiles);
        });
        updateSelectedFiles();
    }

    function updateSelectedFiles() {
        selectedFiles.clear();
        document.querySelectorAll('.file-checkbox:checked').forEach(cb => {
            selectedFiles.add(cb.dataset.path);
        });
        const count = selectedFiles.size;
        if (selectedFilesCount) {
            selectedFilesCount.innerText = count === backupFileTree.length ? '全部文件' : \`\${count} 个文件\`;
        }
        if (selectAllFiles) {
            selectAllFiles.checked = count === backupFileTree.length;
            selectAllFiles.indeterminate = count > 0 && count < backupFileTree.length;
        }
    }

    function renderReleases() {
        if (!backupReleases || backupReleases.length === 0) {
            releasesContainer.innerHTML = '<div class="empty-state">无 Releases</div>';
            return;
        }
        let html = '';
        backupReleases.forEach((release, idx) => {
            const hasAssets = release.assets && release.assets.length > 0;
            const assetsHtml = hasAssets ? release.assets.map(asset => \`
                <div class="asset-item">
                    <input type="checkbox" class="asset-checkbox" data-release-idx="\${idx}" data-asset-url="\${asset.url}" data-asset-name="\${asset.name}">
                    <span class="asset-name">\${asset.name}</span>
                    <span class="asset-size">\${(asset.size/1024).toFixed(2)} KB</span>
                </div>
            \`).join('') : '<div class="asset-item" style="color:#94a3b8;">无资产文件</div>';
            
            html += \`
                <div class="release-item" data-release-idx="\${idx}">
                    <div class="release-header">
                        \${hasAssets ? \`<input type="checkbox" class="release-checkbox" data-release-idx="\${idx}">\` : '<span style="width: 20px;"></span>'}
                        <span class="release-tag">\${release.tag}</span>
                        <span class="release-date">\${release.date}</span>
                        <i class="fas fa-chevron-down" style="margin-left: auto; cursor: pointer;"></i>
                    </div>
                    <div class="release-assets">
                        \${assetsHtml}
                    </div>
                </div>
            \`;
        });
        releasesContainer.innerHTML = html;

        document.querySelectorAll('.release-header').forEach(header => {
            header.addEventListener('click', (e) => {
                if (e.target.type === 'checkbox') return;
                const assetsDiv = header.nextElementSibling;
                assetsDiv.classList.toggle('expanded');
                const icon = header.querySelector('.fa-chevron-down');
                if (icon) icon.classList.toggle('fa-chevron-up');
            });
        });

        document.querySelectorAll('.release-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const idx = e.target.dataset.releaseIdx;
                const assets = document.querySelectorAll(\`.asset-checkbox[data-release-idx="\${idx}"]\`);
                assets.forEach(asset => asset.checked = e.target.checked);
                updateSelectedAssets();
            });
        });

        document.querySelectorAll('.asset-checkbox').forEach(cb => {
            cb.addEventListener('change', updateSelectedAssets);
        });

        updateSelectedAssets();
    }

    function updateSelectedAssets() {
        selectedAssets.clear();
        document.querySelectorAll('.asset-checkbox:checked').forEach(cb => {
            selectedAssets.add(cb.dataset.assetUrl);
        });
        const count = selectedAssets.size;
        if (selectedReleasesCount) selectedReleasesCount.innerText = \`\${count} 个文件\`;

        backupReleases.forEach((release, idx) => {
            const releaseCheckbox = document.querySelector(\`.release-checkbox[data-release-idx="\${idx}"]\`);
            if (!releaseCheckbox) return;
            const assetCheckboxes = document.querySelectorAll(\`.asset-checkbox[data-release-idx="\${idx}"]\`);
            if (assetCheckboxes.length === 0) return;
            const checkedCount = Array.from(assetCheckboxes).filter(cb => cb.checked).length;
            releaseCheckbox.checked = checkedCount === assetCheckboxes.length;
            releaseCheckbox.indeterminate = checkedCount > 0 && checkedCount < assetCheckboxes.length;
        });

        if (selectAllReleases) {
            const totalAssets = document.querySelectorAll('.asset-checkbox').length;
            const checkedAssets = selectedAssets.size;
            selectAllReleases.checked = checkedAssets === totalAssets;
            selectAllReleases.indeterminate = checkedAssets > 0 && checkedAssets < totalAssets;
        }
    }

    function renderTags() {
        if (!backupTags || backupTags.length === 0) {
            tagsContainer.innerHTML = '<div class="empty-state">无版本</div>';
            return;
        }
        let html = '';
        backupTags.forEach(tag => {
            html += \`
                <div class="tag-item">
                    <div class="tag-header">
                        <input type="checkbox" class="tag-checkbox" data-tag="\${tag.name}">
                        <span class="tag-name">\${tag.name}</span>
                        <span class="tag-date">\${tag.lastUpdate || ''}</span>
                        <span class="tag-size">\${tag.size ? (tag.size/1024/1024).toFixed(2) + ' MB' : ''}</span>
                    </div>
                </div>
            \`;
        });
        tagsContainer.innerHTML = html;

        document.querySelectorAll('.tag-checkbox').forEach(cb => {
            cb.addEventListener('change', updateSelectedTags);
        });
        updateSelectedTags();
    }

    function updateSelectedTags() {
        selectedTags.clear();
        document.querySelectorAll('.tag-checkbox:checked').forEach(cb => {
            selectedTags.add(cb.dataset.tag);
        });
        const count = selectedTags.size;
        if (selectedTagsCount) selectedTagsCount.innerText = \`\${count} 个版本\`;

        if (selectAllTags) {
            selectAllTags.checked = count === backupTags.length;
            selectAllTags.indeterminate = count > 0 && count < backupTags.length;
        }
    }

    if (backupNextBtn) {
        backupNextBtn.addEventListener('click', () => {
            if (backupProjectData.type === 'github') {
                if (selectedFiles.size === 0 && selectedAssets.size === 0) {
                    alert('请至少选择一个文件或 Release 资产');
                    return;
                }
            } else {
                if (selectedTags.size === 0) {
                    alert('请至少选择一个版本');
                    return;
                }
            }
            backupStep1.classList.add('hide');
            backupStep2.classList.remove('hide');
            backupPrevBtn.style.display = 'inline-block';
            backupNextBtn.style.display = 'none';
            backupSaveBtn.style.display = 'inline-block';
            renderStep2Buckets();
        });
    }

    function renderStep2Buckets() {
        if (!step2BucketGrid) return;
        if (buckets.length === 0) {
            step2BucketGrid.innerHTML = '<div class="empty-state">暂无桶配置，请先添加</div>';
            return;
        }
        const cardsHtml = buckets.map((bucket, index) => {
            const usagePercent = (bucket.usage / bucket.total) * 100;
            let bgColorClass = 'green';
            if (usagePercent >= 80) bgColorClass = 'red';
            else if (usagePercent >= 60) bgColorClass = 'orange';
            else if (usagePercent >= 40) bgColorClass = 'yellow';

            return \`
                <div class="bucket-card selectable-card" data-bucket-id="\${bucket.id}" data-index="\${index}">
                    <div class="progress-bg \${bgColorClass}" style="width: \${usagePercent}%;"></div>
                    <div class="percentage">\${usagePercent.toFixed(1)}%</div>
                    <div class="bucket-content">
                        <span class="bucket-name">\${bucket.customName}</span>
                    </div>
                </div>
            \`;
        }).join('');
        step2BucketGrid.innerHTML = cardsHtml;

        document.querySelectorAll('#step2BucketGrid .selectable-card').forEach(card => {
            card.addEventListener('click', () => {
                document.querySelectorAll('#step2BucketGrid .selectable-card').forEach(c => c.classList.remove('bucket-card-selected'));
                card.classList.add('bucket-card-selected');
            });
        });
    }

    if (backupPrevBtn) {
        backupPrevBtn.addEventListener('click', () => {
            backupStep2.classList.add('hide');
            backupStep1.classList.remove('hide');
            backupPrevBtn.style.display = 'none';
            backupNextBtn.style.display = 'inline-block';
            backupSaveBtn.style.display = 'none';
        });
    }

    if (backupSaveBtn) {
        backupSaveBtn.addEventListener('click', async () => {
            const selectedCard = document.querySelector('#step2BucketGrid .selectable-card.bucket-card-selected');
            if (!selectedCard) {
                alert('请选择一个存储桶');
                return;
            }
            const bucketId = selectedCard.dataset.bucketId;

            if (backupProjectData.type === 'github') {
                const files = Array.from(selectedFiles);
                const assets = Array.from(selectedAssets).map(url => {
                    for (const release of backupReleases) {
                        const asset = release.assets.find(a => a.url === url);
                        if (asset) return { name: asset.name, url: asset.url, size: asset.size };
                    }
                    return null;
                }).filter(Boolean);

                const payload = {
                    type: 'github',
                    owner: backupProjectData.owner,
                    repo: backupProjectData.repo,
                    bucketId,
                    files,
                    assets
                };

                try {
                    const res = await fetch(apiBase + '/project/detailed', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const result = await res.json();
                    if (result.success) {
                        alert(\`备份任务已提交，任务ID: \${result.taskId}\`);
                        pollTaskStatus(result.taskId);
                        backupModal.style.display = 'none';
                    } else {
                        alert('保存失败：' + (result.error || '未知错误'));
                    }
                } catch (e) {
                    alert('请求失败：' + e.message);
                }
            } else {
                const tags = Array.from(selectedTags);
                const payload = {
                    type: 'docker',
                    repo: backupProjectData.name,
                    bucketId,
                    tags
                };
                try {
                    const res = await fetch(apiBase + '/docker/project/detailed', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    const result = await res.json();
                    if (result.success) {
                        alert(\`Docker 备份任务已提交，任务ID: \${result.taskId}\`);
                        pollTaskStatus(result.taskId);
                        backupModal.style.display = 'none';
                    } else {
                        alert('保存失败：' + (result.error || '未知错误'));
                    }
                } catch (e) {
                    alert('请求失败：' + e.message);
                }
            }
        });
    }

    if (closeBackupModal) {
        closeBackupModal.addEventListener('click', () => { backupModal.style.display = 'none'; });
    }
    if (backupModal) {
        backupModal.addEventListener('click', (e) => { if (e.target === backupModal) backupModal.style.display = 'none'; });
    }
    if (backupCancelBtn) {
        backupCancelBtn.addEventListener('click', () => { backupModal.style.display = 'none'; });
    }

    if (selectAllFiles) {
        selectAllFiles.addEventListener('change', (e) => {
            document.querySelectorAll('.file-checkbox').forEach(cb => cb.checked = e.target.checked);
            updateSelectedFiles();
        });
    }

    if (selectAllReleases) {
        selectAllReleases.addEventListener('change', (e) => {
            document.querySelectorAll('.asset-checkbox').forEach(cb => cb.checked = e.target.checked);
            updateSelectedAssets();
        });
    }

    if (selectAllTags) {
        selectAllTags.addEventListener('change', (e) => {
            document.querySelectorAll('.tag-checkbox').forEach(cb => cb.checked = e.target.checked);
            updateSelectedTags();
        });
    }

    // ============================================================================
    // 13. 队列信息显示
    // ============================================================================

    const queueMenuBtn = safeGet('queueMenuBtn');
    const queueDetailPanel = safeGet('queueDetailPanel');
    const queueTaskList = safeGet('queueTaskList');
    const queueFileCount = safeGet('queueFileCount');
    const queueFileName = safeGet('queueFileName');

    async function updateQueueInfo() {
        try {
            const res = await fetch('/api/queue/status');
            if (!res.ok) throw new Error('获取队列状态失败');
            const data = await res.json();
            const tasks = data.tasks || [];

            if (queueFileCount && queueFileName) {
                if (tasks.length === 0) {
                    queueFileCount.style.display = 'inline';
                    queueFileName.style.display = 'none';
                    queueFileCount.innerText = '暂无任务';
                } else {
                    const first = tasks[0];
                    queueFileCount.style.display = 'none';
                    queueFileName.style.display = 'inline';
                    queueFileName.innerText = \`正在上传: \${first.name}\`;
                }
            }

            if (queueTaskList) {
                if (tasks.length === 0) {
                    queueTaskList.innerHTML = '<div class="empty-state">暂无活动任务</div>';
                } else {
                    queueTaskList.innerHTML = tasks.map(task => \`
                        <div class="queue-task-item">
                            <span class="task-name">\${task.name}</span>
                            <span class="task-status">\${task.status === 'processing' ? '正在上传' : '等待中'}</span>
                        </div>
                    \`).join('');
                }
            }
        } catch (e) {
            console.error('更新队列信息失败', e);
            if (queueFileCount) queueFileCount.innerText = '队列信息不可用';
            if (queueTaskList) queueTaskList.innerHTML = '<div class="empty-state">加载失败</div>';
        }
    }

    function startQueueInfoPolling() {
        if (queueInfoInterval) clearInterval(queueInfoInterval);
        updateQueueInfo();
        queueInfoInterval = setInterval(updateQueueInfo, 60000);
    }

    function stopQueueInfoPolling() {
        if (queueInfoInterval) {
            clearInterval(queueInfoInterval);
            queueInfoInterval = null;
        }
    }

    if (queueMenuBtn && queueDetailPanel) {
        queueMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            queueDetailPanel.classList.toggle('hide');
        });
        document.addEventListener('click', (e) => {
            if (!queueMenuBtn.contains(e.target) && !queueDetailPanel.contains(e.target)) {
                queueDetailPanel.classList.add('hide');
            }
        });
    }

    // ============================================================================
    // 14. 项目卡片渲染（从 D1 读取数据，无需修改）
    // ============================================================================

    const githubGrid = safeGet('githubGrid');
    const dockerGrid = safeGet('dockerGrid');
    const tabs = document.querySelectorAll('.tab-item');

    function renderGrid() {
        if (githubGrid) githubGrid.innerHTML = '';
        if (dockerGrid) dockerGrid.innerHTML = '';
        githubProjects.forEach(p => { if (githubGrid) githubGrid.appendChild(createProjectCard(p, 'github')); });
        dockerProjects.forEach(p => { if (dockerGrid) dockerGrid.appendChild(createProjectCard(p, 'docker')); });
    }

    function createProjectCard(proj, type) {
        const card = document.createElement('div'); card.className = 'project-card';
        const isGitHub = type === 'github';
        // 从 versions 中获取最新版本的日期
        const latestVersion = proj.versions && proj.versions.length > 0 ? proj.versions[proj.versions.length - 1] : { date: proj.lastUpdate };
        const displayName = isGitHub ? proj.name : proj.name;
        const bgIconClass = type === 'github' ? 'fab fa-github' : 'fab fa-docker';
        
        // 构建卡片 HTML（仅显示基本信息，详细内容需要点击后加载）
        card.innerHTML = \`
            <div class="card-bg-icon"><i class="\${bgIconClass}"></i></div>
            <div class="card-header">
                <a class="project-name" data-detail='\${JSON.stringify(proj).replace(/'/g, "&apos;")}' data-type="\${type}">\${displayName}</a>
                <div class="header-right">
                    <a href="\${proj.homepage}" target="_blank" class="official-link-btn" title="访问官网"><i class="fas fa-external-link-alt"></i></a>
                </div>
            </div>
            <div class="project-meta">
                <span class="meta-item"><i class="far fa-calendar-alt"></i> 最后更新: \${proj.lastUpdate}</span>
                <span class="meta-item"><i class="far fa-clock"></i> 存入: \${latestVersion.date}</span>
            </div>
            <div class="action-buttons">
                <button class="btn-icon git-link-btn"><i class="far fa-copy"></i> Git链接</button>
                <button class="btn-icon btn-download"><i class="fas fa-file-zipper"></i> 下载ZIP</button>
                <button class="btn-icon btn-stream"><i class="fas fa-water"></i> 流式</button>
            </div>\`;
        const nameLink = card.querySelector('.project-name');
        if (nameLink) {
            nameLink.addEventListener('click', (e) => {
                e.preventDefault();
                showDetail(type, proj);
            });
        }
        return card;
    }

    // ============================================================================
    // 15. 详情页加载（从 B2 获取元数据）
    // ============================================================================

    // 格式化文件大小
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 构建文件树
    function buildFileTree(files) {
        const tree = [];
        const map = {};
        files.forEach(f => {
            const parts = f.path.split('/');
            let current = tree;
            let currentPath = '';
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                currentPath += (currentPath ? '/' : '') + part;
                let node = current.find(n => n.name === part && n.type === (i === parts.length - 1 ? 'file' : 'folder'));
                if (!node) {
                    node = {
                        name: part,
                        type: i === parts.length - 1 ? 'file' : 'folder',
                        path: currentPath,
                        size: i === parts.length - 1 ? f.size : 0,
                        children: i === parts.length - 1 ? null : []
                    };
                    current.push(node);
                    if (node.type === 'folder') {
                        map[currentPath] = node.children;
                    }
                }
                if (node.type === 'folder') {
                    current = node.children;
                }
            }
        });
        return tree;
    }

    async function showDetail(type, project) {
        currentDetailProject = project;
        currentDetailType = type;
        currentVersionIndex = project.versions.length - 1; // 默认显示最新版本（最后一个）
        
        if (homeView) homeView.classList.add('hide');
        if (detailView) detailView.classList.remove('hide');
        
        await renderDetailView();
    }

    async function renderDetailView() {
        if (!currentDetailProject) return;
        
        const project = currentDetailProject;
        const type = currentDetailType;
        const versions = project.versions || [];
        
        if (versions.length === 0) {
            detailView.innerHTML = '<div class="empty-state">该项目暂无版本信息</div>';
            return;
        }
        
        // 获取当前版本信息
        const version = versions[currentVersionIndex];
        const metaPath = version.metaPath;
        const bucketId = version.bucketId;
        
        // 尝试从缓存获取元数据
        let metaData = cachedMetaData[metaPath];
        if (!metaData) {
            try {
                const res = await fetch(\`/api/meta?path=\${encodeURIComponent(metaPath)}&bucketId=\${bucketId}\`);
                if (!res.ok) throw new Error('Failed to load metadata');
                metaData = await res.json();
                cachedMetaData[metaPath] = metaData; // 缓存
            } catch (e) {
                console.error('Failed to load metadata:', e);
                detailView.innerHTML = \`<div class="empty-state">加载失败：\${e.message}</div>\`;
                return;
            }
        }
        
        // 根据类型渲染详情
        let html = '';
        if (type === 'github') {
            html = renderGithubDetail(project, versions, currentVersionIndex, metaData);
        } else {
            html = renderDockerDetail(project, versions, currentVersionIndex, metaData);
        }
        
        detailView.innerHTML = html;
        attachDetailEventHandlers(type, project, versions);
    }

    function renderGithubDetail(project, versions, currentIdx, metaData) {
        const versionDates = versions.map(v => v.date);
        const currentDate = versions[currentIdx].date;
        const files = metaData.files || [];
        const releases = metaData.releases || [];
        
        const fileTree = buildFileTree(files);
        
        function renderTree(nodes, level = 0) {
            return nodes.map(node => {
                if (node.type === 'folder') {
                    return \`
                        <div class="folder-item" style="margin-left: \${level*20}px;">
                            <div class="folder-header" onclick="window.toggleFolder(this)">
                                <i class="fas fa-folder"></i>
                                <span class="folder-name">\${node.name}</span>
                            </div>
                            <div class="folder-children" style="display: none;">
                                \${renderTree(node.children, level + 1)}
                            </div>
                        </div>
                    \`;
                } else {
                    const sizeStr = formatFileSize(node.size);
                    return \`
                        <div class="file-item" style="margin-left: \${level*20}px;">
                            <i class="far fa-file"></i>
                            <span class="file-name">\${node.name}</span>
                            <span class="file-size">\${sizeStr}</span>
                            <button class="btn-icon btn-download" data-path="\${node.path}" data-bucket="\${versions[currentIdx].bucketId}"><i class="fas fa-download"></i></button>
                        </div>
                    \`;
                }
            }).join('');
        }
        
        const filesHtml = renderTree(fileTree);
        
        const releasesHtml = releases.map(r => \`
            <div class="release-row">
                <i class="fas fa-tag release-icon"></i>
                <div class="release-info">
                    <span class="release-tag">\${r.name}</span>
                    <span class="release-date">\${r.date || ''}</span>
                </div>
                <div class="release-download">
                    <span class="file-meta">\${r.size ? formatFileSize(r.size) : '-'}</span>
                    <button class="btn-icon btn-download" data-url="\${r.url}"><i class="fas fa-download"></i> 下载</button>
                </div>
            </div>
        \`).join('');
        
        return \`
            <div class="detail-header">
                <button class="back-btn" id="backBtn"><i class="fas fa-arrow-left"></i> 返回列表</button>
                <div class="version-selector" id="versionSelector">
                    <span id="selectedVersion">\${currentDate}</span>
                    <i class="fas fa-chevron-down"></i>
                    <div class="version-dropdown" id="versionDropdown">
                        \${versionDates.map((date, idx) => \`<div class="version-item \${idx === currentIdx ? 'current' : ''}" data-version-index="\${idx}">\${date}</div>\`).join('')}
                    </div>
                </div>
            </div>
            <h2><i class="fab fa-github"></i> \${project.name}</h2>
            <div class="file-list">\${filesHtml}</div>
            \${releasesHtml ? '<div class="section-title">Releases</div>' + '<div class="releases-list">' + releasesHtml + '</div>' : ''}
            <p style="margin-top:1rem; color:#475569;"><i class="fas fa-info-circle"></i> 文件列表和Releases随版本切换</p>
        \`;
    }

    function renderDockerDetail(project, versions, currentIdx, metaData) {
        const versionDates = versions.map(v => v.date);
        const currentDate = versions[currentIdx].date;
        const tags = metaData.tags || [];
        
        const tagsHtml = tags.map(tag => \`
            <div class="tag-row">
                <span><i class="fas fa-tag"></i> \${tag}</span>
                <span><button class="btn-icon"><i class="fas fa-download"></i> pull</button></span>
            </div>
        \`).join('');
        
        return \`
            <div class="detail-header">
                <button class="back-btn" id="backBtn"><i class="fas fa-arrow-left"></i> 返回列表</button>
                <div class="version-selector" id="versionSelector">
                    <span id="selectedVersion">\${currentDate}</span>
                    <i class="fas fa-chevron-down"></i>
                    <div class="version-dropdown" id="versionDropdown">
                        \${versionDates.map((date, idx) => \`<div class="version-item \${idx === currentIdx ? 'current' : ''}" data-version-index="\${idx}">\${date}</div>\`).join('')}
                    </div>
                </div>
            </div>
            <h2><i class="fab fa-docker"></i> \${project.name}</h2>
            <div class="docker-tag-list">\${tagsHtml}</div>
            <p style="margin-top:1rem; color:#475569;"><i class="fas fa-info-circle"></i> 标签列表随版本切换</p>
        \`;
    }

    function attachDetailEventHandlers(type, project, versions) {
        const backBtn = safeGet('backBtn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                if (detailView) detailView.classList.add('hide');
                if (homeView) homeView.classList.remove('hide');
            });
        }
        
        const selector = safeGet('versionSelector');
        const dropdown = safeGet('versionDropdown');
        if (selector) {
            selector.addEventListener('click', (e) => {
                e.stopPropagation();
                if (dropdown) dropdown.classList.toggle('show');
            });
        }
        
        if (dropdown) {
            dropdown.querySelectorAll('.version-item').forEach(item => {
                item.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const idx = parseInt(item.dataset.versionIndex);
                    if (idx !== currentVersionIndex) {
                        currentVersionIndex = idx;
                        await renderDetailView(); // 重新渲染
                    }
                    if (dropdown) dropdown.classList.remove('show');
                });
            });
        }
        
        // 添加文件夹展开/折叠事件委托
        const fileList = document.querySelector('.file-list');
        if (fileList) {
            fileList.addEventListener('click', (e) => {
                const folderHeader = e.target.closest('.folder-header');
                if (folderHeader) {
                    const children = folderHeader.nextElementSibling;
                    if (children && children.classList.contains('folder-children')) {
                        children.style.display = children.style.display === 'none' ? 'block' : 'none';
                    }
                }
            });
        }
        
        // 下载按钮事件（需要实现下载逻辑）
        document.querySelectorAll('.btn-download').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const path = btn.dataset.path;
                const bucket = btn.dataset.bucket;
                const url = btn.dataset.url;
                if (path && bucket) {
                    // 构造下载链接，需要后端实现 /api/download
                    // 这里暂时提示
                    alert(\`下载文件: \${path}\`);
                } else if (url) {
                    window.open(url, '_blank');
                }
            });
        });
        
        document.addEventListener('click', function closeDropdown(e) {
            if (selector && !selector.contains(e.target) && dropdown) {
                dropdown.classList.remove('show');
            }
        }, { once: true });
    }

    // ============================================================================
    // 16. 悬浮窗（Releases）- 保持不变
    // ============================================================================

    const popup = safeGet('releasesPopup');
    const popupClose = safeGet('popupClose');
    const popupProjectName = safeGet('popupProjectName');
    const popupSelectedVersion = safeGet('popupSelectedVersion');
    const popupVersionSelector = safeGet('popupVersionSelector');
    const popupVersionDropdown = safeGet('popupVersionDropdown');
    const popupReleasesList = safeGet('popupReleasesList');

    let currentVersions = [];
    let currentPopupVersionIdx = 0;
    let currentPopupType = 'github';
    let isOfficialPopup = false;

    window.showReleasesPopup = function(versions, projectName, type, versionIdx, official = false) {
        currentVersions = versions;
        currentPopupVersionIdx = versionIdx;
        currentPopupType = type;
        isOfficialPopup = official;
        if (popupProjectName) popupProjectName.innerText = projectName;
        const version = versions[versionIdx];
        if (popupSelectedVersion) popupSelectedVersion.innerText = version.date;
        let dropdownHtml = '';
        versions.forEach((v, idx) => {
            dropdownHtml += \`<div class="version-item-sm \${idx === versionIdx ? 'current' : ''}" data-popup-version="\${idx}">\${v.date}</div>\`;
        });
        if (popupVersionDropdown) popupVersionDropdown.innerHTML = dropdownHtml;
        renderPopupReleases(version.releases, official);
        if (popup) popup.style.display = 'flex';

        if (popupVersionDropdown) {
            popupVersionDropdown.querySelectorAll('.version-item-sm').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const newIdx = parseInt(item.dataset.popupVersion);
                    if (newIdx !== currentPopupVersionIdx) {
                        currentPopupVersionIdx = newIdx;
                        const newVersion = currentVersions[newIdx];
                        if (popupSelectedVersion) popupSelectedVersion.innerText = newVersion.date;
                        renderPopupReleases(newVersion.releases, isOfficialPopup);
                        if (popupVersionDropdown) {
                            popupVersionDropdown.querySelectorAll('.version-item-sm').forEach(el => el.classList.remove('current'));
                            item.classList.add('current');
                        }
                    }
                    if (popupVersionDropdown) popupVersionDropdown.classList.remove('show');
                });
            });
        }
    };

    function renderPopupReleases(releases, official = false) {
        if (!popupReleasesList) return;
        if (!releases || releases.length === 0) {
            popupReleasesList.innerHTML = '<div style="padding: 2rem; text-align: center; color: #64748b;">暂无 Releases 文件</div>';
            return;
        }
        let html = '';
        releases.forEach(r => {
            html += \`<div class="release-row"><i class="fas fa-tag release-icon"></i><div class="release-info"><span class="release-tag">\${r.tag}</span><span class="release-date">\${r.date}</span></div></div>\`;
            if (r.assets && r.assets.length > 0) {
                r.assets.forEach(asset => {
                    const size = asset.size ? (asset.size / 1024).toFixed(2) + ' KB' : '';
                    html += \`
                        <div class="asset-row">
                            <span class="asset-name">📄 \${asset.name}</span>
                            <span class="asset-size">\${size}</span>
                            <div class="release-download">
                                <button class="btn-icon btn-download" onclick="window.open('\${asset.url}', '_blank')"><i class="fas fa-download"></i> 官网下载</button>
                                <button class="btn-icon btn-stream" onclick="alert('流式下载演示')"><i class="fas fa-water"></i> 流式下载</button>
                            </div>
                        </div>
                    \`;
                });
            } else {
                html += \`<div class="asset-row">该版本无可下载文件</div>\`;
            }
        });
        popupReleasesList.innerHTML = html;
    }

    if (popupVersionSelector) {
        popupVersionSelector.addEventListener('click', (e) => { e.stopPropagation(); if (popupVersionDropdown) popupVersionDropdown.classList.toggle('show'); });
    }
    if (popupClose) popupClose.addEventListener('click', () => { if (popup) popup.style.display = 'none'; });
    if (popup) popup.addEventListener('click', (e) => { if (e.target === popup) popup.style.display = 'none'; });

    // ============================================================================
    // 17. 标签切换
    // ============================================================================

    function setActiveTab(tabId) {
        currentTab = tabId;
        tabs.forEach(t => t.classList.remove('active'));
        const activeTab = document.querySelector(\`.tab-item[data-tab="\${tabId}"]\`);
        if (activeTab) activeTab.classList.add('active');
        if (tabId === 'github') {
            if (githubGrid) githubGrid.classList.remove('hide');
            if (dockerGrid) dockerGrid.classList.add('hide');
        } else {
            if (githubGrid) githubGrid.classList.add('hide');
            if (dockerGrid) dockerGrid.classList.remove('hide');
        }
        if (searchMode === 'official' && modeText) {
            modeText.innerText = currentTab === 'github' ? 'GitHub 搜索' : 'Docker 搜索';
        }
    }

    tabs.forEach(tab => tab.addEventListener('click', () => setActiveTab(tab.dataset.tab)));

    // ============================================================================
    // 18. 任务轮询
    // ============================================================================

    function pollTaskStatus(taskId) {
        const interval = setInterval(async () => {
            const res = await fetch(\`\${apiBase}/task/\${taskId}\`);
            const task = await res.json();
            if (task.status === 'completed' || task.status === 'completed_with_errors') {
                clearInterval(interval);
                const failedCount = task.failedFiles ? task.failedFiles.length : 0;
                const failedAssets = task.failedAssets ? task.failedAssets.length : 0;
                if (failedCount > 0 || failedAssets > 0) {
                    alert(\`备份完成！文件: \${task.processedFiles} 个，失败文件: \${failedCount}；资产: \${task.processedAssets || 0} 个，失败资产: \${failedAssets}\`);
                } else {
                    alert(\`备份完成！共上传文件 \${task.totalFiles} 个，资产 \${task.totalAssets || 0} 个\`);
                }
                location.reload();
            } else if (task.status === 'failed') {
                clearInterval(interval);
                alert(\`备份失败: \${task.error}\`);
            } else if (task.status === 'processing' || task.status === 'queued') {
                console.log(\`任务处理中...\`);
            }
        }, 3000);
    }

    // ============================================================================
    // 19. 事件绑定（登录等）
    // ============================================================================

    if (loginBtn) loginBtn.addEventListener('click', () => { if (loginModal) loginModal.style.display = 'flex'; });
    if (closeLoginModal) closeLoginModal.addEventListener('click', () => { if (loginModal) loginModal.style.display = 'none'; });
    if (loginModal) loginModal.addEventListener('click', e => { if (e.target === loginModal) loginModal.style.display = 'none'; });
    if (doLogin) doLogin.addEventListener('click', () => { if (loginModal) loginModal.style.display = 'none'; setLoggedIn(true); });

    if (userMenuBtn) userMenuBtn.addEventListener('click', e => { e.stopPropagation(); if (userDropdown) userDropdown.classList.toggle('show'); });
    document.addEventListener('click', e => { if (userMenuBtn && !userMenuBtn.contains(e.target) && userDropdown) userDropdown.classList.remove('show'); });

    if (goToAdmin) goToAdmin.addEventListener('click', () => {
        if (userDropdown) userDropdown.classList.remove('show');
        if (homeView) homeView.classList.add('hide');
        if (detailView) detailView.classList.add('hide');
        if (adminPanel) adminPanel.style.display = 'block';
        renderBucketsCards();
        startQueueInfoPolling();
    });

    if (backHomeBtn) backHomeBtn.addEventListener('click', () => {
        if (adminPanel) adminPanel.style.display = 'none';
        if (homeView) homeView.classList.remove('hide');
        stopQueueInfoPolling();
    });

    if (logoutBtn) logoutBtn.addEventListener('click', () => { setLoggedIn(false); if (userDropdown) userDropdown.classList.remove('show'); });

    const openCustomProject = safeGet('openCustomProject');
    const customProjectModal = safeGet('customProjectModal');
    const closeCustomModal = safeGet('closeCustomModal');
    const saveCustomProjects = safeGet('saveCustomProjects');
    if (openCustomProject) openCustomProject.addEventListener('click', () => {
        const list = safeGet('customProjectList');
        if (list) list.innerHTML = githubProjects.concat(dockerProjects).map(p => \`<div class="project-item"><input type="checkbox" value="\${p.name}"> \${p.name}</div>\`).join('');
        if (customProjectModal) customProjectModal.style.display = 'flex';
    });
    if (closeCustomModal) closeCustomModal.addEventListener('click', () => { if (customProjectModal) customProjectModal.style.display = 'none'; });
    if (saveCustomProjects) saveCustomProjects.addEventListener('click', () => { if (customProjectModal) customProjectModal.style.display = 'none'; alert('已保存自定义项目选择（演示）'); });
    if (customProjectModal) customProjectModal.addEventListener('click', e => { if (e.target === customProjectModal) customProjectModal.style.display = 'none'; });

    document.addEventListener('click', (e) => {
        if (e.target.closest('.git-link-btn')) alert('复制 Git 链接演示 (本站代理链接)');
        else if (e.target.closest('.btn-download:not(.btn-stream)')) alert('下载项目ZIP / pull (通过本站代理)');
        else if (e.target.closest('.btn-stream')) alert('流式代理下载 (流量经过B2)');
    });

    // ============================================================================
    // 20. 日志挂件
    // ============================================================================
    const logFab = safeGet('log-widget-fab');
    const logBadge = safeGet('log-widget-badge');
    const logModal = safeGet('log-modal-overlay');
    const closeLogModalBtn = safeGet('closeLogModal');
    const logContainer = safeGet('log-modal-container');

    function updateLogView(logs) {
        if (!logs || logs.length === 0) return;
        
        const isScrolledToBottom = logContainer.scrollHeight - logContainer.clientHeight <= logContainer.scrollTop + 5;

        // 只追加新的、不存在的日志
        const newLogMessages = logs.filter(log => !globalLogs.includes(log));
        if (newLogMessages.length > 0) {
            globalLogs.push(...newLogMessages);
        }
        // 始终用最新的全局日志更新视图
        if(logContainer) logContainer.textContent = globalLogs.join('\\n');

        if (logModal.style.display !== 'flex' && newLogMessages.length > 0) {
            newLogCount += newLogMessages.length;
            if (logBadge) {
                logBadge.textContent = newLogCount > 99 ? '99+' : newLogCount;
                logBadge.style.display = 'flex';
            }
        }
        
        if (isScrolledToBottom) {
            logContainer.scrollTop = logContainer.scrollHeight;
        }
    }
    
    // 清空日志
    function clearLogs() {
        globalLogs = [];
        newLogCount = 0;
        if (logContainer) logContainer.textContent = '';
        if (logBadge) logBadge.style.display = 'none';
    }

    if (logFab) {
        logFab.addEventListener('click', () => {
            if (logModal) logModal.style.display = 'flex';
            newLogCount = 0;
            if (logBadge) {
                logBadge.style.display = 'none';
                logBadge.textContent = '';
            }
            if (logContainer) {
                 logContainer.scrollTop = logContainer.scrollHeight;
            }
        });
    }

    if (closeLogModalBtn) {
        closeLogModalBtn.addEventListener('click', () => {
            if (logModal) logModal.style.display = 'none';
        });
    }
    
    if (logModal) {
        logModal.addEventListener('click', (e) => {
            if (e.target === logModal) logModal.style.display = 'none';
        });
    }

    // ============================================================================
    // 21. 初始化
    // ============================================================================

    await loadData();
    await loadGithubTokens();
    await loadDockerTokens();
    renderGrid();
    setActiveTab('github');
    if (modeText) modeText.innerText = '存储库';
})();
`;
