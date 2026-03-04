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
    let githubDeleteMode = false;          // GitHub 面板是否处于删除模式
    let dockerDeleteMode = false;          // Docker 面板是否处于删除模式
    let githubSelectedTokens = new Set();  // 选中的 GitHub 令牌索引
    let dockerSelectedTokens = new Set();  // 选中的 Docker 令牌索引

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

            // 为每个桶添加模拟使用量（实际应从B2获取）
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

        // 点击卡片切换复选框
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

        // 绑定编辑图标事件
        document.querySelectorAll('.edit-icon').forEach(icon => {
            icon.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(icon.dataset.index);
                openBucketModal('edit', index);
            });
        });

        // 更新Snippets JSON显示（使用 snippetId）
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
    // 6. 桶管理（添加、编辑、删除模式、导入/保存JSON、验证连接）
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
            // 生成新内部ID并显示
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
            // 显示内部ID
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
        // 移除所有卡片的选中类
        document.querySelectorAll('.bucket-card').forEach(card => {
            card.classList.remove('bucket-card-selected');
        });
        const cancelBtn = document.getElementById('cancelDeleteBtn');
        if (cancelBtn) cancelBtn.remove();
        if (deleteModeBtn) {
            deleteModeBtn.innerHTML = '<i class="fas fa-trash"></i>';
            deleteModeBtn.classList.add('btn-danger'); // 保持红色
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

    // 添加桶按钮
    if (addBucketBtn) {
        addBucketBtn.addEventListener('click', () => openBucketModal('add'));
    }

    // 删除模式按钮
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

    // 监听复选框变化
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
            console.log('当前选中索引:', Array.from(selectedBuckets));
        }
    });

    // 关闭模态框
    if (closeBucketModal) {
        closeBucketModal.addEventListener('click', () => { if (bucketModal) bucketModal.style.display = 'none'; });
    }
    if (bucketModal) {
        bucketModal.addEventListener('click', (e) => { if (e.target === bucketModal) bucketModal.style.display = 'none'; });
    }

    // 提交桶表单
    if (bucketForm) {
        bucketForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const customName = bucketCustomName.value.trim();
            const keyID = bucketKeyID.value.trim();
            const appKey = bucketAppKey.value.trim();
            const bktName = bucketName.value.trim();
            const endpoint = bucketEndpoint.value.trim();
            const idValue = internalId.value.trim(); // 从隐藏字段取值
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

    // 导入 JSON
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

    // 保存 JSON
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

    // 桶连接验证
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

    // 加载 GitHub 令牌
    async function loadGithubTokens() {
        try {
            const res = await fetch(apiBase + '/tokens/github');
            if (!res.ok) throw new Error('加载失败');
            githubTokens = await res.json(); // 数组，每个对象有 index, name, usageCount
            renderGithubTokens();
        } catch (e) {
            console.error('加载 GitHub 令牌失败', e);
        }
    }

    // 加载 Docker 令牌
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

    // 渲染 GitHub 令牌（无复选框）
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

        // 绑定卡片点击事件（用于选择）
        document.querySelectorAll('#githubTokensList .bucket-card').forEach(card => {
            card.addEventListener('click', (e) => {
                // 只有在删除模式下才处理选择
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

    // 渲染 Docker 令牌（无复选框）
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

        // 绑定卡片点击事件
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

    // GitHub 删除模式切换（始终保留 btn-danger 类）
    function toggleGithubDeleteMode() {
        const deleteBtn = safeGet('deleteGithubTokenBtn');
        if (!deleteBtn) return;
        
        if (!githubDeleteMode) {
            // 进入删除模式
            githubDeleteMode = true;
            deleteBtn.innerHTML = '<i class="fas fa-trash"></i> 删除'; // 改变文字，保留图标
            // 添加取消按钮
            let cancelBtn = document.getElementById('cancelGithubDelete');
            if (!cancelBtn) {
                cancelBtn = document.createElement('button');
                cancelBtn.className = 'btn-icon';
                cancelBtn.id = 'cancelGithubDelete';
                cancelBtn.innerHTML = '<i class="fas fa-times"></i> 取消';
                deleteBtn.parentNode.appendChild(cancelBtn);
                cancelBtn.addEventListener('click', () => {
                    githubDeleteMode = false;
                    deleteBtn.innerHTML = '<i class="fas fa-trash"></i>'; // 恢复文字，仍保留红色
                    cancelBtn.remove();
                    githubSelectedTokens.clear();
                    renderGithubTokens();
                });
            }
            renderGithubTokens();
        } else {
            // 执行删除
            if (githubSelectedTokens.size === 0) {
                alert('请至少选择一个令牌');
                return;
            }
            const indices = Array.from(githubSelectedTokens).sort((a,b)=>b-a);
            Promise.all(indices.map(async idx => {
                await fetch(apiBase + '/tokens/github?index=' + idx, { method: 'DELETE' });
            })).then(() => {
                loadGithubTokens();
                // 退出删除模式
                githubDeleteMode = false;
                deleteBtn.innerHTML = '<i class="fas fa-trash"></i>'; // 恢复文字
                document.getElementById('cancelGithubDelete')?.remove();
                githubSelectedTokens.clear();
            }).catch(e => alert('删除失败：' + e.message));
        }
    }

    // Docker 删除模式切换（始终保留 btn-danger 类）
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

    // GitHub 添加令牌模态框
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

    // Docker 添加令牌模态框
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
            const token = dockerTokenValue.value.trim();
            if (!name || !token) {
                alert('请填写名称和令牌');
                return;
            }
            const res = await fetch(apiBase + '/tokens/docker', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, token })
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

    // 标签页切换（同时切换操作按钮）
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

    // 绑定添加和删除按钮
    const addGithubBtn = safeGet('addGithubTokenBtn');
    if (addGithubBtn) addGithubBtn.addEventListener('click', openGithubTokenModal);

    const addDockerBtn = safeGet('addDockerTokenBtn');
    if (addDockerBtn) addDockerBtn.addEventListener('click', openDockerTokenModal);

    const deleteGithubBtn = safeGet('deleteGithubTokenBtn');
    if (deleteGithubBtn) deleteGithubBtn.addEventListener('click', toggleGithubDeleteMode);

    const deleteDockerBtn = safeGet('deleteDockerTokenBtn');
    if (deleteDockerBtn) deleteDockerBtn.addEventListener('click', toggleDockerDeleteMode);

    // ============================================================================
    // 10. 首页搜索功能（保持不变）
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

            // 事件委托处理 Releases 按钮点击
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
                            const url = \`https://hub.docker.com/v2/repositories/library/\${proj.repo}/tags/?page_size=20\`;
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
    // 11. 后台项目添加搜索（保持不变）
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
            adminHasMore = newItems.length === 10 && (page * 10) < adminTotal;

            if (page === 1 && searchResultList) searchResultList.innerHTML = '';
            else document.getElementById('admin-loading-item')?.remove();

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
                            <button class="save-btn backup-btn" data-name="\${item.name}" data-type="\${item.type}">完整备份</button>
                        </div>
                    </div>\`;
                if (searchResultList) searchResultList.insertAdjacentHTML('beforeend', itemHtml);
            });

            if (adminHasMore && searchResultsScroll) {
                const newLoadingItem = document.createElement('div');
                newLoadingItem.className = 'loading-indicator hide';
                newLoadingItem.id = 'admin-loading-item';
                newLoadingItem.innerText = '加载中...';
                searchResultsScroll.appendChild(newLoadingItem);
            }

            // 绑定完整备份按钮事件
            document.querySelectorAll('.backup-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const name = e.target.dataset.name;
                    const type = e.target.dataset.type;
                    currentProjectToBackup = { name, type };
                    openSelectBucketModal();
                });
            });

        } catch (error) {
            alert('搜索出错：' + error.message);
        } finally {
            adminLoading = false;
            const li = document.getElementById('admin-loading-item');
            if (li) li.classList.add('hide');
        }
    }

    if (searchResultsScroll) {
        searchResultsScroll.addEventListener('scroll', () => {
            if (!adminHasMore || adminLoading) return;
            const { scrollTop, scrollHeight, clientHeight } = searchResultsScroll;
            if (scrollTop + clientHeight >= scrollHeight - 50) {
                const li = document.getElementById('admin-loading-item');
                if (li) li.classList.remove('hide');
                adminCurrentPage++;
                loadAdminResults(adminQuery, adminType, adminCurrentPage);
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

    // 桶选择模态框（卡片样式）
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

            // 添加点击选中效果
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
    // 12. 队列信息显示（仅显示任务状态，无进度）
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

            // 更新队列信息显示（只显示第一个任务名称）
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

            // 更新队列详情面板（仅显示项目名称和状态）
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
    // 13. 项目卡片渲染（保持不变）
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
        const displayName = isGitHub ? proj.name : proj.name + (proj.versions[0].tags ? \`:\${proj.versions[0].tags[0]}\` : '');
        const hasAnyReleases = proj.versions.some(v => v.releases && v.releases.length > 0);
        const releasesButton = hasAnyReleases ? \`<div class="releases-group"><button class="btn-icon btn-release"><i class="fas fa-tag"></i> Releases</button></div>\` : '';
        const officialButton = \`<a href="\${proj.homepage}" target="_blank" class="official-link-btn" title="访问官网"><i class="fas fa-external-link-alt"></i></a>\`;
        const bgIconClass = type === 'github' ? 'fab fa-github' : 'fab fa-docker';
        card.innerHTML = \`
            <div class="card-bg-icon"><i class="\${bgIconClass}"></i></div>
            <div class="card-header">
                <a class="project-name" data-detail='\${JSON.stringify(proj).replace(/'/g, "&apos;")}' data-type="\${type}">\${displayName}</a>
                <div class="header-right">\${officialButton}</div>
            </div>
            <div class="project-meta">
                <span class="meta-item"><i class="far fa-calendar-alt"></i> 最后更新: \${proj.lastUpdate}</span>
                <span class="meta-item"><i class="far fa-clock"></i> 存入: \${proj.versions[0].date}</span>
            </div>
            <div class="action-buttons">
                <button class="btn-icon git-link-btn"><i class="far fa-copy"></i> Git链接</button>
                <div style="display: flex; gap:0.3rem;"><button class="btn-icon btn-download"><i class="fas fa-file-zipper"></i> 下载ZIP</button></div>
                \${releasesButton}
            </div>\`;
        const nameLink = card.querySelector('.project-name');
        if (nameLink) {
            nameLink.addEventListener('click', (e) => { e.preventDefault(); showDetail(type, JSON.parse(e.target.dataset.detail)); });
        }
        const releaseBtn = card.querySelector('.btn-release');
        if (releaseBtn) {
            releaseBtn.addEventListener('click', (e) => { e.stopPropagation(); showReleasesPopup(proj.versions, proj.name, type, 0, false); });
        }
        return card;
    }

    function showDetail(type, project) {
        if (homeView) homeView.classList.add('hide');
        if (detailView) detailView.classList.remove('hide');
        let currentVersionIndex = 0;
        const renderDetailContent = (versionIdx) => {
            const version = project.versions[versionIdx];
            let filesHtml = '', releasesHtml = '';
            if (type === 'github') {
                filesHtml = \`<div class="file-list">\${version.files.map(f => \`<div class="file-row"><i class="far fa-file-code file-icon"></i><span class="file-name">\${f}</span><span class="file-meta">\${(Math.random()*4+1).toFixed(1)} KB</span></div>\`).join('')}</div>\`;
                if (version.releases && version.releases.length > 0) {
                    releasesHtml = \`<div class="section-title">Releases</div><div class="releases-list">\${version.releases.map(r => \`<div class="release-row"><i class="fas fa-tag release-icon"></i><div class="release-info"><span class="release-tag">\${r.tag}</span><span class="release-date">\${r.date}</span></div><div class="release-download"><button class="btn-icon btn-download"><i class="fas fa-download"></i> 下载</button></div></div>\`).join('')}</div>\`;
                }
            } else {
                filesHtml = \`<div class="docker-tag-list">\${version.tags.map(tag => \`<div class="tag-row"><span><i class="fas fa-tag"></i> \${tag}</span><span><button class="btn-icon"><i class="fas fa-download"></i> pull</button><button class="btn-icon btn-stream"><i class="fas fa-water"></i> 流式</button></span></div>\`).join('')}</div>\`;
                if (version.releases && version.releases.length > 0) {
                    releasesHtml = \`<div class="section-title">版本发布</div><div class="releases-list">\${version.releases.map(r => \`<div class="release-row"><i class="fas fa-tag release-icon"></i><div class="release-info"><span class="release-tag">\${r.tag}</span><span class="release-date">\${r.date}</span>\${r.digest ? '<span style="font-size:0.8rem;">' + r.digest + '</span>' : ''}</div><div class="release-download"><button class="btn-icon btn-download"><i class="fas fa-download"></i> pull</button></div></div>\`).join('')}</div>\`;
                }
            }
            return { filesHtml, releasesHtml };
        };
        const buildFullHtml = (versionIdx) => {
            const { filesHtml, releasesHtml } = renderDetailContent(versionIdx);
            const versionDates = project.versions.map(v => v.date);
            const currentDate = project.versions[versionIdx].date;
            return \`<div class="detail-header"><button class="back-btn" id="backBtn"><i class="fas fa-arrow-left"></i> 返回列表</button><h2><i class="\${type === 'github' ? 'fab fa-github' : 'fab fa-docker'}"></i> \${project.name}</h2><div class="version-selector" id="versionSelector"><span id="selectedVersion">\${currentDate}</span><i class="fas fa-chevron-down"></i><div class="version-dropdown" id="versionDropdown">\${versionDates.map((date, idx) => \`<div class="version-item \${idx === versionIdx ? 'current' : ''}" data-version-index="\${idx}">\${date}</div>\`).join('')}</div></div></div>\${filesHtml}\${releasesHtml || ''}<p style="margin-top:1rem; color:#475569;"><i class="fas fa-info-circle"></i> \${type === 'github' ? '文件列表和Releases随版本切换' : '标签列表和Releases随版本切换'}</p>\`;
        };
        if (detailView) detailView.innerHTML = buildFullHtml(currentVersionIndex);
        const backBtn = safeGet('backBtn');
        if (backBtn) backBtn.addEventListener('click', () => { if (detailView) detailView.classList.add('hide'); if (homeView) homeView.classList.remove('hide'); });
        const selector = safeGet('versionSelector');
        const dropdown = safeGet('versionDropdown');
        if (selector) {
            selector.addEventListener('click', (e) => { e.stopPropagation(); if (dropdown) dropdown.classList.toggle('show'); });
        }
        if (dropdown) {
            dropdown.querySelectorAll('.version-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(item.dataset.versionIndex);
                    if (idx !== currentVersionIndex) {
                        currentVersionIndex = idx;
                        if (detailView) detailView.innerHTML = buildFullHtml(currentVersionIndex);
                        showDetail(type, project);
                    }
                    if (dropdown) dropdown.classList.remove('show');
                });
            });
        }
        document.addEventListener('click', function closeDropdown(e) { if (selector && !selector.contains(e.target) && dropdown) dropdown.classList.remove('show'); }, { once: true });
    }

    // ============================================================================
    // 14. 悬浮窗（Releases）保持不变
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
    // 15. 标签切换（保持不变）
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
    // 16. 任务轮询（保持不变）
    // ============================================================================

    function pollTaskStatus(taskId) {
        const interval = setInterval(async () => {
            const res = await fetch(\`\${apiBase}/task/\${taskId}\`);
            const task = await res.json();
            if (task.status === 'completed') {
                clearInterval(interval);
                const failedCount = task.failedFiles ? task.failedFiles.length : 0;
                if (failedCount > 0) {
                    alert(\`备份完成！共上传 \${task.processedFiles} 个文件，失败 \${failedCount} 个文件。\`);
                } else {
                    alert(\`备份完成！共上传 \${task.totalFiles} 个文件\`);
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
    // 17. 事件绑定（登录等，保持不变）
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

    // 自定义项目模态框（演示）
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

    // 全局演示提示
    document.addEventListener('click', (e) => {
        if (e.target.closest('.git-link-btn')) alert('复制 Git 链接演示 (本站代理链接)');
        else if (e.target.closest('.btn-download:not(.btn-stream)')) alert('下载项目ZIP / pull (通过本站代理)');
        else if (e.target.closest('.btn-stream')) alert('流式代理下载 (流量经过B2)');
    });

    // ============================================================================
    // 18. 初始化
    // ============================================================================

    await loadData();
    await loadGithubTokens(); // 加载 GitHub 令牌
    await loadDockerTokens(); // 加载 Docker 令牌
    renderGrid();
    setActiveTab('github');
    if (modeText) modeText.innerText = '存储库';
})();
`;
