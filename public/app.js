/* ==================== WPS表格导入工具 - 前端逻辑 ==================== */

// ==================== WPS 用户登录 ====================

let _wpsUser = null; // { logged_in, name, id, avatar, expires }

async function checkWpsLoginStatus() {
  try {
    const resp = await fetch('/api/wps-user');
    const data = await resp.json();
    _wpsUser = data;
    updateLoginUI();
  } catch (e) {
    _wpsUser = { logged_in: false };
    updateLoginUI();
  }
}

function updateLoginUI() {
  const loginBtn = document.getElementById('btn-wps-login');
  const userInfo = document.getElementById('nav-user-info');
  const userName = document.getElementById('nav-user-name');
  const userAvatar = document.getElementById('nav-user-avatar');
  const loginBanner = document.getElementById('login-required-banner');
  const importContent = document.getElementById('import-content');

  const logsLink = document.getElementById('nav-logs-link');

  if (_wpsUser && _wpsUser.logged_in) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (userInfo) userInfo.style.display = 'flex';
    if (userInfo) userInfo.style.alignItems = 'center';
    if (userInfo) userInfo.style.gap = '8px';
    if (userName) userName.textContent = _wpsUser.name;
    if (userAvatar) {
      if (_wpsUser.avatar) {
        userAvatar.src = _wpsUser.avatar;
        userAvatar.style.display = 'block';
        userAvatar.onerror = function() { this.style.display = 'none'; };
      } else {
        userAvatar.style.display = 'none';
      }
    }
    if (loginBanner) loginBanner.style.display = 'none';
    if (importContent) importContent.style.display = 'block';
    if (logsLink) logsLink.style.display = '';
  } else {
    if (loginBtn) loginBtn.style.display = 'block';
    if (userInfo) userInfo.style.display = 'none';
    if (logsLink) logsLink.style.display = 'none';
    // 仅在导入页显示登录提示
    const hash = (location.hash || '#/import').replace('#/', '');
    if (hash === 'import' || hash === '') {
      if (loginBanner) loginBanner.style.display = 'block';
      if (importContent) importContent.style.display = 'none';
    } else {
      if (loginBanner) loginBanner.style.display = 'none';
      if (importContent) importContent.style.display = 'block';
    }
  }
}

function wpsLogin() {
  window.location.href = '/api/wps-login';
}

async function wpsLogout() {
  try {
    await fetch('/api/wps-logout', { method: 'POST' });
    _wpsUser = { logged_in: false };
    updateLoginUI();
    toast('已登出', 'info');
    // 如果在导入页，刷新页面状态
    const hash = (location.hash || '#/import').replace('#/', '');
    if (hash === 'import' || hash === '') {
      router();
    }
  } catch (e) {
    toast('登出失败', 'error');
  }
}

// API 基础封装（真实环境调用后端API，演示环境回退到模拟数据）
let _isDemoMode = false;
async function api(path, options = {}) {
  const opts = { headers: { 'Content-Type': 'application/json' }, ...options };
  if (opts.body && typeof opts.body === 'object') opts.body = JSON.stringify(opts.body);
  try {
    const resp = await fetch('/api/' + path, opts);
    const data = await resp.json().catch(() => ({ error: '响应解析失败' }));
    if (!resp.ok) {
      // 401 需要登录：不回退到演示模式
      if (resp.status === 401 && data.need_login) {
        _wpsUser = { logged_in: false };
        updateLoginUI();
        throw new Error(data.error || '请先登录WPS账号');
      }
      throw new Error(data.error || `请求失败 (${resp.status})`);
    }
    return data;
  } catch (e) {
    // 登录相关错误不回退演示模式
    if (e.message && (e.message.includes('登录') || e.message.includes('WPS账号'))) throw e;
    const demo = demoApi(path, options);
    if (demo !== null) {
      if (!_isDemoMode) { _isDemoMode = true; const b = document.getElementById('demo-banner'); if (b) b.style.display = 'block'; }
      return demo;
    }
    throw e;
  }
}

// 通知
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  setTimeout(() => el.className = 'toast', 3000);
}

// 弹窗
function showModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').style.display = 'flex';
}
function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
}

// 转义HTML
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==================== 路由 ====================

function router() {
  const hash = (location.hash || '#/import').replace('#/', '');
  const pages = ['import', 'config', 'settings', 'logs'];
  const page = pages.includes(hash) ? hash : 'import';

  document.querySelectorAll('.page').forEach(el => el.style.display = 'none');
  document.getElementById('page-' + page).style.display = 'block';

  document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
  document.querySelectorAll(`[data-page="${page}"]`)?.forEach(el => el.classList.add('active'));

  // 页面初始化
  if (page === 'import') {
    updateLoginUI();
    if (_wpsUser && _wpsUser.logged_in) loadShopsForImport();
  }
  if (page === 'config') checkConfigAccess();
  if (page === 'settings') checkSettingsAccess();
  if (page === 'logs') {
    if (!_wpsUser || !_wpsUser.logged_in) {
      location.hash = '#/import';
      return;
    }
    loadLogs();
  }
}

window.addEventListener('hashchange', router);

// ==================== 站点设置（动态加载 favicon/title/logo）====================

let _siteSettings = null;

async function loadSiteSettings() {
  try {
    const resp = await fetch('/api/site-settings');
    _siteSettings = await resp.json();
    applySiteSettings(_siteSettings);
  } catch (e) {
    // 静默失败，用默认值
  }
}

function applySiteSettings(s) {
  // Favicon
  const fav = document.getElementById('favicon-link');
  if (s.favicon) {
    fav.href = s.favicon;
  } else {
    fav.href = 'data:,';
  }
  // Title
  if (s.title) {
    document.title = s.title;
  }
  // Header logo
  const logoImg = document.getElementById('nav-logo-img');
  const logoEmoji = document.getElementById('nav-logo-emoji');
  const titleText = document.getElementById('nav-title-text');

  if (s.logo_url) {
    logoImg.src = s.logo_url;
    logoImg.style.height = (s.logo_size || 24) + 'px';
    logoImg.style.display = 'inline';
    logoEmoji.style.display = 'none';
  } else {
    logoImg.style.display = 'none';
    logoEmoji.style.display = 'inline';
  }

  if (s.logo_text) {
    titleText.textContent = s.logo_text;
  }
  if (s.logo_font) {
    titleText.style.fontFamily = s.logo_font;
  }
  if (s.logo_font_size) {
    titleText.style.fontSize = s.logo_font_size + 'px';
  }
}

// ==================== 密码门禁 ====================

let _pwdSession = { admin: false, developer: false };

async function checkPwdSession() {
  try {
    const resp = await fetch('/api/password/status');
    _pwdSession = await resp.json();
  } catch (e) {
    _pwdSession = { admin: false, developer: false };
  }
}

async function checkConfigAccess() {
  await checkPwdSession();
  if (_pwdSession.admin) {
    document.getElementById('config-lock').style.display = 'none';
    document.getElementById('config-content').style.display = 'block';
    loadShopsForConfig();
  } else {
    document.getElementById('config-lock').style.display = 'block';
    document.getElementById('config-content').style.display = 'none';
    const input = document.getElementById('config-pwd-input');
    if (input) input.value = '';
    if (input) input.focus();
  }
}

async function unlockConfig() {
  const pwd = document.getElementById('config-pwd-input').value;
  if (!pwd) { toast('请输入密码', 'error'); return; }
  try {
    const resp = await fetch('/api/password/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'admin', password: pwd }),
    });
    const data = await resp.json();
    if (!resp.ok) { toast(data.error || '密码错误', 'error'); return; }
    _pwdSession.admin = true;
    toast('解锁成功', 'success');
    checkConfigAccess();
  } catch (e) {
    toast('解锁失败: ' + e.message, 'error');
  }
}

async function checkSettingsAccess() {
  await checkPwdSession();
  if (_pwdSession.developer) {
    document.getElementById('settings-lock').style.display = 'none';
    document.getElementById('settings-content').style.display = 'block';
    loadSettings();
    loadSiteSettingsForm();
  } else {
    document.getElementById('settings-lock').style.display = 'block';
    document.getElementById('settings-content').style.display = 'none';
    const input = document.getElementById('settings-pwd-input');
    if (input) input.value = '';
    if (input) input.focus();
  }
}

async function unlockSettings() {
  const pwd = document.getElementById('settings-pwd-input').value;
  if (!pwd) { toast('请输入密码', 'error'); return; }
  try {
    const resp = await fetch('/api/password/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'developer', password: pwd }),
    });
    const data = await resp.json();
    if (!resp.ok) { toast(data.error || '密码错误', 'error'); return; }
    _pwdSession.developer = true;
    toast('解锁成功', 'success');
    checkSettingsAccess();
  } catch (e) {
    toast('解锁失败: ' + e.message, 'error');
  }
}

async function updatePassword(type) {
  const oldPwd = document.getElementById(`pwd-${type}-old`).value;
  const newPwd = document.getElementById(`pwd-${type}-new`).value;
  if (!oldPwd || !newPwd) { toast('请输入原密码和新密码', 'error'); return; }
  try {
    const resp = await fetch('/api/password/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, old_password: oldPwd, new_password: newPwd }),
    });
    const data = await resp.json();
    if (!resp.ok) { toast(data.error || '修改失败', 'error'); return; }
    toast('密码已更新', 'success');
    document.getElementById(`pwd-${type}-old`).value = '';
    document.getElementById(`pwd-${type}-new`).value = '';
  } catch (e) {
    toast('修改失败: ' + e.message, 'error');
  }
}

// ==================== 站点外观设置 ====================

async function loadSiteSettingsForm() {
  try {
    const resp = await fetch('/api/site-settings');
    const s = await resp.json();
    document.getElementById('setting-favicon').value = s.favicon || '';
    document.getElementById('setting-title').value = s.title || '';
    document.getElementById('setting-logo-url').value = s.logo_url || '';
    document.getElementById('setting-logo-size').value = s.logo_size || 24;
    document.getElementById('setting-logo-text').value = s.logo_text || '';
    document.getElementById('setting-logo-font').value = s.logo_font || 'system-ui, -apple-system, sans-serif';
    document.getElementById('setting-logo-font-size').value = s.logo_font_size || 16;
  } catch (e) {
    toast('加载站点设置失败', 'error');
  }
}

async function saveSiteSettings() {
  const body = {
    favicon: document.getElementById('setting-favicon').value.trim(),
    title: document.getElementById('setting-title').value.trim(),
    logo_url: document.getElementById('setting-logo-url').value.trim(),
    logo_size: parseInt(document.getElementById('setting-logo-size').value) || 24,
    logo_text: document.getElementById('setting-logo-text').value.trim(),
    logo_font: document.getElementById('setting-logo-font').value,
    logo_font_size: parseInt(document.getElementById('setting-logo-font-size').value) || 16,
  };
  try {
    const resp = await fetch('/api/site-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) { toast(data.error || '保存失败', 'error'); return; }
    toast('外观设置已保存', 'success');
    // 立即应用
    applySiteSettings(data.settings || body);
  } catch (e) {
    toast('保存失败: ' + e.message, 'error');
  }
}

// ==================== 导入页 ====================

let importState = { shopId: null, configs: [], fileData: null };

async function loadShopsForImport() {
  try {
    const shops = await api('shops');
    const sel = document.getElementById('import-shop');
    sel.innerHTML = '<option value="">请选择店铺...</option>' +
      shops.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  } catch (e) {
    document.getElementById('import-shop').innerHTML = '<option value="">加载失败</option>';
  }
}

// 选店铺后：显示上传区域，加载该店铺的配置
document.getElementById('import-shop').addEventListener('change', async e => {
  importState.shopId = e.target.value;
  const uploadStep = document.getElementById('import-upload-step');
  const previewEl = document.getElementById('import-config-preview');
  const actionStep = document.getElementById('import-action-step');
  const btnImport = document.getElementById('btn-import');

  // 重置
  previewEl.style.display = 'none';
  actionStep.style.display = 'none';
  btnImport.disabled = true;
  importState.fileData = null;
  document.getElementById('file-info').style.display = 'none';
  document.getElementById('import-file').value = '';

  if (!importState.shopId) {
    uploadStep.style.display = 'none';
    return;
  }

  uploadStep.style.display = 'block';

  // 预加载该店铺的表格类型+子表映射配置
  try {
    const tableTypes = await api(`table-types?shop_id=${importState.shopId}`);
    const configsWithMappings = [];
    for (const tt of tableTypes) {
      const mappings = await api(`mappings?table_type_id=${tt.id}`);
      configsWithMappings.push({ tableType: tt, mappings });
    }
    importState.configs = configsWithMappings;
  } catch (e) {
    importState.configs = [];
  }
});

// 文件上传：点击触发选择
document.getElementById('file-upload-area').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

// 文件上传：拖拽
document.getElementById('file-upload-area').addEventListener('dragover', e => {
  e.preventDefault();
  e.currentTarget.classList.add('dragover');
});
document.getElementById('file-upload-area').addEventListener('dragleave', e => {
  e.currentTarget.classList.remove('dragover');
});
document.getElementById('file-upload-area').addEventListener('drop', async e => {
  e.preventDefault();
  e.currentTarget.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) await parseUploadedFile(file);
});

// 文件选择
document.getElementById('import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (file) await parseUploadedFile(file);
});

// 解析上传的文件
async function parseUploadedFile(file) {
  const fileInfo = document.getElementById('file-info');
  const previewEl = document.getElementById('import-config-preview');
  const actionStep = document.getElementById('import-action-step');
  const btnImport = document.getElementById('btn-import');

  previewEl.style.display = 'none';
  actionStep.style.display = 'none';
  btnImport.disabled = true;

  // 显示文件信息
  const sizeKB = (file.size / 1024).toFixed(1);
  fileInfo.style.display = 'block';
  fileInfo.innerHTML = `<div class="file-info-row"><span>📄 ${esc(file.name)}</span><span>${sizeKB} KB</span></div><div class="file-parsing">正在解析文件...</div>`;

  try {
    // 检查 SheetJS 是否加载
    if (typeof XLSX === 'undefined') {
      throw new Error('SheetJS库未加载，请刷新页面重试');
    }

    const buf = await file.arrayBuffer();
    const workbook = XLSX.read(buf, { type: 'array' });

    // 提取每个子表的数据（保留原始行，供后续按配置切片）
    const sheets = [];
    workbook.SheetNames.forEach((name, idx) => {
      const worksheet = workbook.Sheets[name];
      // 修复百分比Bug：SheetJS会把 3.42% 解析为数值 0.0342，导致写入后变成 0.0342%
      // 检测百分比格式的单元格，恢复为原始文本值（如 '3.42%'）
      for (const cellAddr in worksheet) {
        if (cellAddr[0] === '!') continue;
        const cell = worksheet[cellAddr];
        if (cell && cell.w && typeof cell.w === 'string' && cell.w.includes('%') && typeof cell.v === 'number') {
          cell.v = cell.w;  // 用格式化文本替换数值
          cell.t = 's';     // 标记为文本类型
        }
      }
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
      const nonEmptyRows = jsonData.filter(row => row.some(v => v !== '' && v != null));
      sheets.push({ idx, name, allRows: jsonData, rowCount: nonEmptyRows.length });
    });

    importState.fileData = { fileName: file.name, sheets };

    fileInfo.innerHTML = `<div class="file-info-row"><span>📄 ${esc(file.name)}</span><span>${sizeKB} KB · ${sheets.length}个子表</span></div>`;

    // 匹配配置并渲染
    renderSheetSelection(sheets);

  } catch (e) {
    fileInfo.innerHTML = `<div class="file-info-row"><span>📄 ${esc(file.name)}</span><span class="error-text">解析失败</span></div><div class="error-text">${esc(e.message)}</div>`;
  }
}

// 渲染子表选择列表（匹配配置）
function renderSheetSelection(sheets) {
  const previewEl = document.getElementById('import-config-preview');
  const actionStep = document.getElementById('import-action-step');
  const btnImport = document.getElementById('btn-import');

  // 构建配置索引：source_sheet_idx → mapping
  const configMap = {};
  const prefixMatches = []; // 文件名前缀匹配的表格类型
  const fileName = (importState.fileData?.fileName || '').toLowerCase();

  for (const cfg of importState.configs) {
    for (const m of cfg.mappings) {
      configMap[m.source_sheet_idx] = { mapping: m, tableType: cfg.tableType };
    }
    // 文件名前缀匹配
    const prefix = (cfg.tableType.file_name_prefix || '').toLowerCase();
    if (prefix && fileName.includes(prefix)) {
      if (!prefixMatches.includes(cfg.tableType.name)) {
        prefixMatches.push(cfg.tableType.name);
      }
    }
  }

  // 文件名匹配 + 子表映射（双条件）：仅保留在「子表映射」里也配过的子表
  // 先按文件名匹配找出候选 tableType，再从这些 tableType 的 mappings 中筛 source_sheet_idx
  const allowedSourceIdx = new Set();
  const prefixMatchedTableTypes = [];
  if (prefixMatches.length > 0) {
    for (const cfg of importState.configs) {
      if (prefixMatches.includes(cfg.tableType.name)) {
        prefixMatchedTableTypes.push(cfg.tableType);
        // 该 tableType 配置里所有的 source_sheet_idx 都算作"被允许导入的子表"
        for (const m of cfg.mappings) {
          allowedSourceIdx.add(m.source_sheet_idx);
        }
      }
    }
  }

  // 构建可导入项列表
  const importItems = [];
  let html = '';
  // 文件名前缀匹配提示
  if (prefixMatches.length > 0) {
    html += `<div class="config-preview-header" style="background:var(--success);color:#fff">✅ 文件名匹配：${esc(prefixMatches.join('、'))}（仅显示已配置子表映射的子表）</div>`;
  }
  html += '<div class="config-preview-header">📋 选择要导入的子表</div>';
  let hasMatchable = false;

  for (const sheet of sheets) {
    // 双条件匹配：1) 文件名前缀匹配  2) 该 sheet.idx 在子表映射中
    const matchedByPrefix = prefixMatchedTableTypes.length > 0 && allowedSourceIdx.has(sheet.idx);
    // 文件名匹配上时，cfg 优先用 prefixMatchedTableTypes 的 tableType（避免被其他 tableType 抢走）
    let cfg = null;
    if (matchedByPrefix) {
      // 找哪个 prefixMatchedTableType 配了该 source_sheet_idx
      const owner = prefixMatchedTableTypes.find(tt =>
        importState.configs.some(c => c.tableType.id === tt.id && c.mappings.some(m => m.source_sheet_idx === sheet.idx))
      );
      const tt = owner || prefixMatchedTableTypes[0];
      const m = importState.configs.find(c => c.tableType.id === tt.id)?.mappings.find(mm => mm.source_sheet_idx === sheet.idx);
      cfg = { mapping: m || { id: -1, source_sheet_idx: sheet.idx }, tableType: tt };
    } else if (prefixMatches.length === 0) {
      cfg = configMap[sheet.idx];
    }
    const matched = !!cfg;
    const targetOk = cfg && cfg.tableType.target_file_token && cfg.tableType.target_file_token.length > 5;
    const canImport = matched && targetOk && sheet.allRows.length > 0;

    // 文件名匹配上了但该子表未配子表映射，跳过不显示
    if (prefixMatches.length > 0 && !matched) continue;
    // 没文件名匹配时，按 source_sheet_idx 找映射，没找到的也跳过
    if (prefixMatches.length === 0 && !matched) continue;

    if (canImport) hasMatchable = true;

    html += `<div class="config-preview-item ${!canImport ? 'incomplete' : ''}">`;
    html += `<div class="config-preview-title">`;
    html += `子表${sheet.idx} · ${esc(sheet.name)}`;
    html += ` <span class="tag ${canImport ? 'tag-ok' : 'tag-warn'}">${sheet.rowCount}行</span>`;
    if (!targetOk) {
      html += ' <span class="tag tag-warn">未配置目标表格</span>';
    } else if (matchedByPrefix) {
      html += ` <span class="tag tag-ok">→ ${esc(cfg.tableType.name)}（文件名匹配）</span>`;
    } else {
      html += ` <span class="tag tag-ok">→ ${esc(cfg.tableType.name)}</span>`;
    }
    html += '</div>';

    if (canImport) {
      // 根据源文件起始行/列配置，从 allRows 中切片出数据
      const sourceStartRow = cfg.tableType.source_start_row || 0;
      const sourceStartCol = cfg.tableType.source_start_col || 0;
      const allRows = sheet.allRows;
      // 数据行：从 sourceStartRow 开始（0-based，即文件的第 N+1 行）
      const dataRows = allRows.slice(sourceStartRow).map(row => row.slice(sourceStartCol)).filter(row => row.some(v => v !== '' && v != null));

      const itemIdx = importItems.length;
      importItems.push({
        mapping_id: cfg.mapping.id,
        headers: [],
        dataRows: dataRows,
        tableTypeName: cfg.tableType.name,
        tableType: cfg.tableType,
        sheetName: sheet.name,
        sourceSheetIdx: sheet.idx, // 记录上传文件中的子表索引
      });
      html += `<label class="mapping-check-item">
        <input type="checkbox" class="import-check" value="${itemIdx}" checked>
        <span>导入到「${esc(cfg.tableType.name)}」（目标: ${esc(cfg.tableType.target_file_token.slice(0, 20))}...）</span>
      </label>`;
    }

    html += '</div>';
  }

  importState.importItems = importItems;

  if (!hasMatchable) {
    html += '<div class="empty" style="margin-top:8px">没有可导入的子表。请先在「配置」页面配置表格类型和子表映射（源文件子表索引需与上传文件的子表索引对应）</div>';
  }

  previewEl.style.display = 'block';
  previewEl.innerHTML = html;
  actionStep.style.display = hasMatchable ? 'block' : 'none';
  btnImport.disabled = !hasMatchable;

  // 设置导入时间默认值为昨天
  const timeInput = document.getElementById('import-time');
  if (timeInput && !timeInput.value) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const pad = (n) => String(n).padStart(2, '0');
    timeInput.value = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
  }

  updateImportButton();
  document.querySelectorAll('.import-check').forEach(cb => {
    cb.addEventListener('change', updateImportButton);
  });
}

function updateImportButton() {
  const checked = document.querySelectorAll('.import-check:checked');
  const btn = document.getElementById('btn-import');
  btn.disabled = checked.length === 0;
  btn.textContent = checked.length > 0 ? `开始导入 (${checked.length}个子表)` : '开始导入';
}

// 导入时间加减日期（delta: -1=前一天, +1=后一天）
function shiftImportTime(delta) {
  const timeInput = document.getElementById('import-time');
  if (!timeInput || !timeInput.value) return;
  const d = new Date(timeInput.value);
  if (isNaN(d.getTime())) return;
  d.setDate(d.getDate() + delta);
  const pad = (n) => String(n).padStart(2, '0');
  timeInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

document.getElementById('btn-select-all').addEventListener('click', () => {
  document.querySelectorAll('.import-check:not(:disabled)').forEach(cb => cb.checked = true);
  updateImportButton();
});
document.getElementById('btn-select-none').addEventListener('click', () => {
  document.querySelectorAll('.import-check:not(:disabled)').forEach(cb => cb.checked = false);
  updateImportButton();
});

document.getElementById('btn-import').addEventListener('click', async () => {
  if (!importState.shopId) { toast('请先选择店铺', 'error'); return; }

  const checked = Array.from(document.querySelectorAll('.import-check:checked'));
  if (checked.length === 0) { toast('请选择要导入的子表', 'error'); return; }

  // 从 importState.importItems 收集选中的导入项（每项含全部 dataRows）
  const allItems = checked.map(cb => {
    const idx = parseInt(cb.value);
    const item = importState.importItems[idx];
    return {
      mapping_id: item.mapping_id,
      headers: item.headers,
      dataRows: item.dataRows,
      source_sheet_idx: item.sourceSheetIdx,
      table_type: item.tableType ? { id: item.tableType.id, name: item.tableType.name } : null,
    };
  });

  const btn = document.getElementById('btn-import');
  btn.textContent = '导入中...';
  btn.disabled = true;
  const resultEl = document.getElementById('import-result');
  resultEl.innerHTML = '<div class="loading">正在准备导入任务...</div>';

  // 获取导入时间
  const importTime = document.getElementById('import-time')?.value || '';

  // 预计算分块计划：按列数动态决定每块行数，确保单次调用的子请求数 < 50（Cloudflare 免费档上限）
  // 后端每批最多写 2000 个单元格；单块控制在 ~30 批以内，加上 findLastRow/获取子表等约 5 次，合计 < 50
  const tasks = [];
  for (const it of allItems) {
    const rows = it.dataRows || [];
    let colCount = (it.headers || []).length;
    for (const r of rows) if (r.length > colCount) colCount = r.length;
    const rowsPerBatch = Math.max(1, Math.floor(2000 / Math.max(1, colCount + 1)));
    const chunkRows = Math.max(1, rowsPerBatch * 30); // 单块约 30 批
    const totalChunks = Math.max(1, Math.ceil(rows.length / chunkRows));
    for (let c = 0; c < totalChunks; c++) {
      const start = c * chunkRows;
      const end = Math.min(start + chunkRows, rows.length);
      tasks.push({
        item: { ...it, dataRows: rows.slice(start, end) },
        row_offset: start,          // 固定起始行模式下用于避免分块重叠
        chunk_index: c + 1,
        total_chunks: totalChunks,
      });
    }
  }

  // 按 item 聚合结果
  const byItem = {};
  let done = 0;

  try {
    for (const t of tasks) {
      done++;
      resultEl.innerHTML = `<div class="loading">正在导入数据... (${done}/${tasks.length})</div>`;
      try {
        const result = await api('import', {
          method: 'POST',
          body: {
            shop_id: parseInt(importState.shopId),
            items: [t.item],
            import_time: importTime,
            row_offset: t.row_offset,
            chunk_index: t.chunk_index,
          },
        });
        (result.results || []).forEach(r => {
          const key = r.table_type || r.mapping_id || '-';
          if (!byItem[key]) byItem[key] = { key, sheet: r.sheet, rows: 0, status: r.status, msg: '', start: null, last: null };
          const agg = byItem[key];
          agg.rows += (r.rows_imported || 0);
          if (r.status === 'error') agg.status = 'error';
          if (r.message && !agg.msg) agg.msg = r.message;
          if (r.start_row != null) {
            if (agg.start == null || r.start_row < agg.start) agg.start = r.start_row;
            if (agg.last == null || r.last_row > agg.last) agg.last = r.last_row;
          }
        });
      } catch (e) {
        const key = t.item.table_type?.name || t.item.mapping_id || '-';
        if (!byItem[key]) byItem[key] = { key, sheet: '', rows: 0, status: 'error', msg: '', start: null, last: null };
        byItem[key].status = 'error';
        if (!byItem[key].msg) byItem[key].msg = (e.message || '网络错误') + ` (分块 ${t.chunk_index}/${t.total_chunks})`;
      }
    }

    // 汇总展示
    let html = '<h3>导入结果</h3>';
    const keys = Object.keys(byItem);
    if (keys.length) {
      keys.forEach(key => {
        const r = byItem[key];
        const cls = r.status;
        const statusText = { success: '成功', error: '失败', skipped: '跳过' }[r.status] || r.status;
        html += `<div class="result-item ${cls}">
          <div><strong>${esc(r.key)}</strong>${r.sheet ? ' / ' + esc(r.sheet) : ''}</div>
          <div class="result-status ${cls}">${statusText}${r.rows != null ? ' (' + r.rows + '行)' : ''}</div>
        </div>`;
        if (r.start != null) html += `<div class="result-msg ${cls}">数据从第 ${r.start + 1} 行开始写入（末行: ${r.last + 1}）</div>`;
        if (r.msg) html += `<div class="result-msg ${cls}">${esc(r.msg)}</div>`;
      });
    } else {
      html += '<div class="empty">无导入结果</div>';
    }
    resultEl.innerHTML = html;

    const successRows = keys.reduce((s, k) => s + (byItem[k].rows || 0), 0);
    const hasError = keys.some(k => byItem[k].status === 'error');
    if (hasError) toast(`导入完成，成功 ${successRows} 行，部分分块失败`, 'error');
    else toast(`导入完成，成功写入 ${successRows} 行`, 'success');
  } catch (e) {
    // 检查是否需要登录
    if (e.message && e.message.includes('登录')) {
      _wpsUser = { logged_in: false };
      updateLoginUI();
      toast('登录已过期，请重新登录', 'error');
    }
    resultEl.innerHTML = `<div class="result-item error"><div>${esc(e.message)}</div></div>`;
    toast('导入失败: ' + e.message, 'error');
  } finally {
    updateImportButton();
  }
});

// ==================== 配置页 ====================

let configState = { selectedShopId: null };

async function loadShopsForConfig() {
  try {
    const shops = await api('shops');
    const container = document.getElementById('shops-list');
    if (shops.length === 0) {
      container.innerHTML = '<div class="empty">暂无店铺，点击上方添加</div>';
      return;
    }
    container.innerHTML = shops.map(s => `
      <div class="list-item ${configState.selectedShopId == s.id ? 'active' : ''}" onclick="selectShop(${s.id})">
        <span class="list-item-name">${esc(s.name)}</span>
        <div class="list-item-actions">
          <button class="btn btn-small btn-secondary" onclick="event.stopPropagation();copyShop(${s.id}, '${esc(s.name)}')">复制</button>
          <button class="btn btn-small btn-secondary" onclick="event.stopPropagation();editShop(${s.id}, '${esc(s.name)}')">编辑</button>
          <button class="btn btn-small btn-danger" onclick="event.stopPropagation();deleteShop(${s.id})">删除</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    toast('加载店铺失败: ' + e.message, 'error');
  }
}

function addShop() {
  showModal(`
    <h3>添加店铺</h3>
    <div class="modal-form">
      <div class="form-group">
        <label>店铺名称</label>
        <input type="text" id="modal-shop-name" class="input" placeholder="如：店铺A">
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="saveShop()">保存</button>
    </div>
  `);
  document.getElementById('modal-shop-name').focus();
}

async function saveShop(id) {
  const name = document.getElementById('modal-shop-name').value.trim();
  if (!name) { toast('请输入店铺名称', 'error'); return; }
  try {
    if (id) {
      await api(`shops/${id}`, { method: 'PUT', body: { name } });
    } else {
      await api('shops', { method: 'POST', body: { name } });
    }
    closeModal();
    toast('保存成功', 'success');
    loadShopsForConfig();
  } catch (e) {
    toast('保存失败: ' + e.message, 'error');
  }
}

function editShop(id, name) {
  showModal(`
    <h3>编辑店铺</h3>
    <div class="modal-form">
      <div class="form-group">
        <label>店铺名称</label>
        <input type="text" id="modal-shop-name" class="input" value="${esc(name)}">
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="saveShop(${id})">保存</button>
    </div>
  `);
}

function copyShop(id, name) {
  showModal(`
    <h3>复制店铺</h3>
    <div class="modal-form">
      <div class="form-group">
        <label>源店铺</label>
        <input type="text" class="input" value="${esc(name)}" disabled>
      </div>
      <div class="form-group">
        <label>新店铺名称</label>
        <input type="text" id="modal-shop-name" class="input" placeholder="如：${esc(name)}_副本">
        <p class="hint">将复制该店铺下所有表格类型和子表映射配置到新店铺</p>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="doCopyShop(${id})">复制</button>
    </div>
  `);
  document.getElementById('modal-shop-name').focus();
}

async function doCopyShop(sourceId) {
  const newName = document.getElementById('modal-shop-name').value.trim();
  if (!newName) { toast('请输入新店铺名称', 'error'); return; }
  try {
    const result = await api('shops/copy', {
      method: 'POST',
      body: { source_shop_id: parseInt(sourceId), new_name: newName },
    });
    closeModal();
    const msg = result.copied_types > 0
      ? `复制成功，已复制 ${result.copied_types} 个表格类型、${result.copied_mappings} 个子表映射`
      : '复制成功（源店铺无表格类型配置）';
    toast(msg, 'success');
    loadShopsForConfig();
  } catch (e) {
    toast('复制失败: ' + e.message, 'error');
  }
}

async function deleteShop(id) {
  if (!confirm('确定删除该店铺及其所有配置？')) return;
  try {
    await api(`shops/${id}`, { method: 'DELETE' });
    if (configState.selectedShopId == id) {
      configState.selectedShopId = null;
      document.getElementById('config-detail').innerHTML = '<p>选择左侧店铺查看配置</p>';
      document.getElementById('config-detail').className = 'config-detail-empty';
    }
    toast('删除成功', 'success');
    loadShopsForConfig();
  } catch (e) {
    toast('删除失败: ' + e.message, 'error');
  }
}

async function selectShop(shopId) {
  configState.selectedShopId = shopId;
  loadShopsForConfig();
  await loadTableTypes(shopId);
}

async function loadTableTypes(shopId) {
  try {
    const types = await api(`table-types?shop_id=${shopId}`);
    const detail = document.getElementById('config-detail');
    detail.className = '';

    let html = `
      <div class="card">
        <div class="card-header">
          <h3>表格类型</h3>
          <button class="btn btn-small btn-primary" onclick="addTableType()">+ 添加</button>
        </div>
        <div id="table-types-list">
    `;

    if (types.length === 0) {
      html += '<div class="empty">暂无表格类型，点击上方添加</div>';
    } else {
      for (const t of types) {
        const targetOk = t.target_file_token && t.target_file_token.length > 5;
        const startColDisplay = (t.start_col || 0) + 1;
        const timeColDisplay = t.time_col != null && t.time_col >= 0 ? (t.time_col + 1) : 0;
        const colLetter = (n) => String.fromCharCode(64 + n); // 1=A, 2=B...
        html += `
          <div class="list-item" style="flex-direction:column;align-items:stretch;cursor:default">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="list-item-name">${esc(t.name)}${t.european_number ? ' <span class="tag tag-ok" style="font-size:11px;margin-left:6px">欧洲数字</span>' : ''}</span>
              <div class="list-item-actions">
                <button class="btn btn-small btn-secondary" onclick="editTableType(${t.id}, '${esc(t.name)}', '${esc(t.target_file_token || '')}', ${t.target_sheet_idx || 0}, ${t.start_col || 0}, ${t.time_col != null ? t.time_col : -1}, '${esc(t.file_name_prefix || '')}', ${t.start_row != null ? t.start_row : -1}, ${t.source_start_row != null ? t.source_start_row : 0}, ${t.source_start_col != null ? t.source_start_col : 0}, ${t.european_number ? 1 : 0})">编辑</button>
                <button class="btn btn-small btn-danger" onclick="deleteTableType(${t.id})">删除</button>
              </div>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">
              文件名前缀: ${esc(t.file_name_prefix || '（未设置）')}
              | 目标子表: ${t.target_sheet_idx || 0}
              | 起始列: ${colLetter(startColDisplay)}（第${startColDisplay}列）
              | 时间列: ${timeColDisplay > 0 ? colLetter(timeColDisplay) + '（第' + timeColDisplay + '列）' : '无'}
              | 起始行: ${t.start_row != null && t.start_row >= 0 ? ('第' + (t.start_row + 1) + '行（固定位置）') : '自动追加'}
              | 源数据位置: 第${(t.source_start_row || 0) + 1}行/第${(t.source_start_col || 0) + 1}列
            </div>
            <div id="mappings-${t.id}" style="margin-top:8px"></div>
          </div>
        `;
      }
    }

    html += '</div></div>';
    detail.innerHTML = html;

    // 加载每个表格类型的子表映射
    for (const t of types) {
      loadMappings(t.id);
    }
  } catch (e) {
    toast('加载表格类型失败: ' + e.message, 'error');
  }
}

async function loadMappings(tableTypeId) {
  try {
    const mappings = await api(`mappings?table_type_id=${tableTypeId}`);
    const container = document.getElementById(`mappings-${tableTypeId}`);
    if (!container) return;

    let html = '<div style="font-size:13px;color:var(--text-secondary);margin-top:8px;font-weight:500">子表映射:</div>';
    html += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">配置上传文件中的子表索引，导入时按索引匹配数据</div>';

    if (mappings.length === 0) {
      html += '<div style="font-size:12px;color:var(--text-muted);padding:4px 0">暂无映射</div>';
    } else {
      mappings.forEach(m => {
        html += `<div class="mapping-row">
          <span>子表${m.source_sheet_idx}</span>
          <span>${esc(m.source_sheet_name || '')}</span>
          <button class="btn btn-small btn-danger" onclick="deleteMapping(${m.id}, ${tableTypeId})">移除</button>
        </div>`;
      });
    }
    html += `<button class="btn btn-small btn-secondary" onclick="addMapping(${tableTypeId})" style="margin-top:4px">+ 添加映射</button>`;
    container.innerHTML = html;
  } catch (e) {
    console.error('加载映射失败:', e);
  }
}

function addTableType() {
  const srcRowDisplay = 1, srcColDisplay = 1;
  showModal(`
    <h3>添加表格类型</h3>
    <div class="modal-form">
      <div class="form-group">
        <label>类型名称</label>
        <input type="text" id="modal-tt-name" class="input" placeholder="如：销售表">
      </div>
      <div class="form-group">
        <label>上传文件名前缀</label>
        <input type="text" id="modal-tt-prefix" class="input" placeholder="如：销售表，上传时会自动匹配">
        <p class="hint">上传文件名包含此前缀时，自动匹配到此表格类型</p>
      </div>
      <div class="form-group">
        <label>目标表格链接 / file_token</label>
        <div style="display:flex;gap:8px">
          <input type="text" id="modal-tt-token" class="input" placeholder="目标WPS在线表格的链接或file_token" style="flex:1">
          <button class="btn btn-secondary btn-small" type="button" onclick="fetchTargetSheets(this)">获取子表</button>
        </div>
      </div>
      <div class="form-group" id="target-sheets-container" style="display:none">
        <label>选择目标子表</label>
        <div id="target-sheets-list" class="sheet-radio-list"></div>
      </div>
      <div class="form-row" style="display:flex;gap:16px">
        <div class="form-group" style="flex:1">
          <label>数据起始列</label>
          <input type="number" id="modal-tt-start-col" class="input" value="1" min="1" placeholder="从第几列开始写入（1=A列）">
          <p class="hint">1=A列，2=B列，以此类推</p>
        </div>
        <div class="form-group" style="flex:1">
          <label>导入时间列</label>
          <input type="number" id="modal-tt-time-col" class="input" value="0" min="0" placeholder="时间写入到第几列">
          <p class="hint">填0表示不写入时间，1=A列，2=B列</p>
        </div>
      </div>
      <div class="form-row" style="display:flex;gap:16px">
        <div class="form-group" style="flex:1">
          <label>源文件起始行</label>
          <input type="number" id="modal-tt-source-start-row" class="input" value="1" min="1" placeholder="数据从第几行开始（1=第1行）">
          <p class="hint">上传文件的数据起始行，1=第1行</p>
        </div>
        <div class="form-group" style="flex:1">
          <label>源文件起始列</label>
          <input type="number" id="modal-tt-source-start-col" class="input" value="1" min="1" placeholder="数据从第几列开始（1=A列）">
          <p class="hint">上传文件的数据起始列，1=A列</p>
        </div>
      </div>
      <div class="form-group">
        <label>写入起始行</label>
        <div style="display:flex;gap:8px;align-items:center">
          <select id="modal-tt-row-mode" class="input" style="max-width:160px" onchange="toggleStartRowInput()">
            <option value="-1">自动追加（找到末行后追加）</option>
            <option value="0">指定位置（手动填写起始行）</option>
          </select>
          <input type="number" id="modal-tt-start-row" class="input" value="2" min="1" placeholder="行号" style="max-width:100px;display:none">
        </div>
        <p class="hint">选择"指定位置"后，可手动填写从第几行开始写入（1=第1行）</p>
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="modal-tt-european"> 欧洲数字格式（千分为“.”，小数为“,”）
        </label>
        <p class="hint">部分国家数字格式：1.000.000 当作 1000000、11,55% 当作 11.55%，勾选后导入自动转换</p>
      </div>
      <input type="hidden" id="modal-tt-idx" value="0">
      <input type="hidden" id="modal-tt-sheet-name" value="">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="saveTableType()">保存</button>
    </div>
  `);
}

function toggleStartRowInput() {
  const mode = document.getElementById('modal-tt-row-mode').value;
  const input = document.getElementById('modal-tt-start-row');
  input.style.display = mode === '0' ? 'inline-block' : 'none';
}

async function saveTableType(id) {
  const name = document.getElementById('modal-tt-name').value.trim();
  const prefix = document.getElementById('modal-tt-prefix')?.value.trim() || '';
  const token = document.getElementById('modal-tt-token').value.trim();
  const idx = parseInt(document.getElementById('modal-tt-idx').value) || 0;
  const startCol = (parseInt(document.getElementById('modal-tt-start-col').value) || 1) - 1; // 1-based → 0-based
  const timeColInput = parseInt(document.getElementById('modal-tt-time-col').value) || 0;
  const timeCol = timeColInput > 0 ? timeColInput - 1 : -1; // 0=不写, 1-based → 0-based
  const rowMode = parseInt(document.getElementById('modal-tt-row-mode')?.value) || -1;
  const startRowInput = parseInt(document.getElementById('modal-tt-start-row')?.value) || 2;
  const startRow = rowMode === 0 ? (startRowInput - 1) : -1; // 0=指定位置, -1=自动追加
  const sourceStartRow = (parseInt(document.getElementById('modal-tt-source-start-row')?.value) || 1) - 1; // 1-based → 0-based
  const sourceStartCol = (parseInt(document.getElementById('modal-tt-source-start-col')?.value) || 1) - 1; // 1-based → 0-based
  const europeanNumber = document.getElementById('modal-tt-european')?.checked ? 1 : 0;
  if (!name) { toast('请输入类型名称', 'error'); return; }
  if (!configState.selectedShopId) { toast('请先选择店铺', 'error'); return; }

  try {
    if (id) {
      await api(`table-types/${id}`, { method: 'PUT', body: { name, target_file_token: token, target_sheet_idx: idx, start_col: startCol, time_col: timeCol, file_name_prefix: prefix, start_row: startRow, source_start_row: sourceStartRow, source_start_col: sourceStartCol, european_number: europeanNumber } });
    } else {
      await api('table-types', { method: 'POST', body: { shop_id: parseInt(configState.selectedShopId), name, target_file_token: token, target_sheet_idx: idx, start_col: startCol, time_col: timeCol, file_name_prefix: prefix, start_row: startRow, source_start_row: sourceStartRow, source_start_col: sourceStartCol, european_number: europeanNumber } });
    }
    closeModal();
    toast('保存成功', 'success');
    loadTableTypes(configState.selectedShopId);
  } catch (e) {
    toast('保存失败: ' + e.message, 'error');
  }
}

function editTableType(id, name, token, idx, startCol, timeCol, prefix, startRow, sourceStartRow, sourceStartCol, europeanNumber) {
  const startColDisplay = (startCol || 0) + 1;  // 0-based → 1-based
  const timeColDisplay = timeCol != null && timeCol >= 0 ? (timeCol + 1) : 0;
  const rowMode = (startRow != null && startRow >= 0) ? '0' : '-1';
  const startRowDisplay = (startRow != null && startRow >= 0) ? (startRow + 1) : 2;
  const srcRowDisplay = (sourceStartRow != null && sourceStartRow >= 0) ? (sourceStartRow + 1) : 1;
  const srcColDisplay = (sourceStartCol != null && sourceStartCol >= 0) ? (sourceStartCol + 1) : 1;
  showModal(`
    <h3>编辑表格类型</h3>
    <div class="modal-form">
      <div class="form-group">
        <label>类型名称</label>
        <input type="text" id="modal-tt-name" class="input" value="${esc(name)}">
      </div>
      <div class="form-group">
        <label>上传文件名前缀</label>
        <input type="text" id="modal-tt-prefix" class="input" value="${esc(prefix || '')}">
        <p class="hint">上传文件名包含此前缀时，自动匹配到此表格类型</p>
      </div>
      <div class="form-group">
        <label>目标表格链接 / file_token</label>
        <div style="display:flex;gap:8px">
          <input type="text" id="modal-tt-token" class="input" value="${esc(token)}" style="flex:1">
          <button class="btn btn-secondary btn-small" type="button" onclick="fetchTargetSheets(this)">获取子表</button>
        </div>
      </div>
      <div class="form-group" id="target-sheets-container" style="display:none">
        <label>选择目标子表</label>
        <div id="target-sheets-list" class="sheet-radio-list"></div>
      </div>
      <div class="form-row" style="display:flex;gap:16px">
        <div class="form-group" style="flex:1">
          <label>数据起始列</label>
          <input type="number" id="modal-tt-start-col" class="input" value="${startColDisplay}" min="1" placeholder="从第几列开始写入（1=A列）">
          <p class="hint">1=A列，2=B列，以此类推</p>
        </div>
        <div class="form-group" style="flex:1">
          <label>导入时间列</label>
          <input type="number" id="modal-tt-time-col" class="input" value="${timeColDisplay}" min="0" placeholder="时间写入到第几列">
          <p class="hint">填0表示不写入时间，1=A列，2=B列</p>
        </div>
      </div>
      <div class="form-row" style="display:flex;gap:16px">
        <div class="form-group" style="flex:1">
          <label>源文件起始行</label>
          <input type="number" id="modal-tt-source-start-row" class="input" value="${srcRowDisplay}" min="1" placeholder="数据从第几行开始（1=第1行）">
          <p class="hint">上传文件的数据起始行，1=第1行</p>
        </div>
        <div class="form-group" style="flex:1">
          <label>源文件起始列</label>
          <input type="number" id="modal-tt-source-start-col" class="input" value="${srcColDisplay}" min="1" placeholder="数据从第几列开始（1=A列）">
          <p class="hint">上传文件的数据起始列，1=A列</p>
        </div>
      </div>
      <div class="form-group">
        <label>写入起始行</label>
        <div style="display:flex;gap:8px;align-items:center">
          <select id="modal-tt-row-mode" class="input" style="max-width:160px" onchange="toggleStartRowInput()">
            <option value="-1" ${rowMode === '-1' ? 'selected' : ''}>自动追加（找到末行后追加）</option>
            <option value="0" ${rowMode === '0' ? 'selected' : ''}>指定位置（手动填写起始行）</option>
          </select>
          <input type="number" id="modal-tt-start-row" class="input" value="${startRowDisplay}" min="1" placeholder="行号" style="max-width:100px;${rowMode === '0' ? '' : 'display:none'}">
        </div>
        <p class="hint">选择"指定位置"后，可手动填写从第几行开始写入（1=第1行）</p>
      </div>
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="modal-tt-european" ${europeanNumber ? 'checked' : ''}> 欧洲数字格式（千分为“.”，小数为“,”）
        </label>
        <p class="hint">部分国家数字格式：1.000.000 当作 1000000、11,55% 当作 11.55%，勾选后导入自动转换</p>
      </div>
      <input type="hidden" id="modal-tt-idx" value="${idx}">
      <input type="hidden" id="modal-tt-sheet-name" value="">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="saveTableType(${id})">保存</button>
    </div>
  `);
  // 如果已有目标表格链接，自动获取子表
  if (token && token.length > 5) {
    setTimeout(() => {
      const btn = document.querySelector('#modal-content .btn-secondary');
      if (btn) fetchTargetSheets(btn);
    }, 100);
  }
}

// 获取目标表格的子表列表，展示为radio供选择
async function fetchTargetSheets(btn) {
  const token = document.getElementById('modal-tt-token').value.trim();
  if (!token) { toast('请先输入目标表格链接', 'error'); return; }

  const originalText = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '获取中...'; btn.disabled = true; }

  try {
    const result = await api(`sheets/list?file_token=${encodeURIComponent(token)}`);
    const sheets = result.sheets || [];
    if (sheets.length === 0) {
      toast('该表格没有子表', 'error');
      return;
    }

    const container = document.getElementById('target-sheets-container');
    const listEl = document.getElementById('target-sheets-list');
    const currentIdx = parseInt(document.getElementById('modal-tt-idx').value) || 0;

    listEl.innerHTML = sheets.map(s => `
      <label class="mapping-check-item">
        <input type="radio" name="target-sheet" value="${s.index}" ${s.index == currentIdx ? 'checked' : ''}>
        <span>子表${s.index} · ${esc(s.name || '')}</span>
      </label>
    `).join('');

    container.style.display = 'block';

    // 选择变化时更新隐藏字段
    document.querySelectorAll('input[name="target-sheet"]').forEach(radio => {
      radio.addEventListener('change', e => {
        document.getElementById('modal-tt-idx').value = e.target.value;
        const label = e.target.nextElementSibling;
        if (label) document.getElementById('modal-tt-sheet-name').value = label.textContent.replace(/^子表\d+\s*·\s*/, '');
      });
    });

    // 设置初始值
    const checked = document.querySelector('input[name="target-sheet"]:checked');
    if (checked) {
      document.getElementById('modal-tt-idx').value = checked.value;
      const label = checked.nextElementSibling;
      if (label) document.getElementById('modal-tt-sheet-name').value = label.textContent.replace(/^子表\d+\s*·\s*/, '');
    }

    toast(`获取到 ${sheets.length} 个子表`, 'success');
  } catch (e) {
    toast('获取子表失败: ' + e.message, 'error');
  } finally {
    if (btn) { btn.textContent = originalText; btn.disabled = false; }
  }
}

async function deleteTableType(id) {
  if (!confirm('确定删除该表格类型及其子表映射？')) return;
  try {
    await api(`table-types/${id}`, { method: 'DELETE' });
    toast('删除成功', 'success');
    loadTableTypes(configState.selectedShopId);
  } catch (e) {
    toast('删除失败: ' + e.message, 'error');
  }
}

function addMapping(tableTypeId) {
  showModal(`
    <h3>添加子表映射</h3>
    <div class="modal-form">
      <div class="form-group">
        <label>源文件子表索引（从0开始）</label>
        <input type="number" id="modal-m-idx" class="input" value="0" min="0" placeholder="上传文件中子表的索引位置">
        <p class="hint">如：上传文件的第1个子表填0，第2个填1，以此类推</p>
      </div>
      <div class="form-group">
        <label>子表名称（可选，用于展示）</label>
        <input type="text" id="modal-m-name" class="input" placeholder="如：销售数据">
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="saveMapping(${tableTypeId})">保存</button>
    </div>
  `);
}

async function saveMapping(tableTypeId) {
  const idx = parseInt(document.getElementById('modal-m-idx').value);
  const name = document.getElementById('modal-m-name').value.trim();
  if (isNaN(idx) || idx < 0) { toast('请输入有效的子表索引', 'error'); return; }

  try {
    await api('mappings', { method: 'POST', body: { table_type_id: tableTypeId, source_sheet_idx: idx, source_sheet_name: name } });
    closeModal();
    toast('保存成功', 'success');
    loadMappings(tableTypeId);
  } catch (e) {
    toast('保存失败: ' + e.message, 'error');
  }
}

async function deleteMapping(id, tableTypeId) {
  if (!confirm('确定移除该映射？')) return;
  try {
    await api(`mappings/${id}`, { method: 'DELETE' });
    toast('已移除', 'success');
    loadMappings(tableTypeId);
  } catch (e) {
    toast('移除失败: ' + e.message, 'error');
  }
}

// ==================== 设置页 ====================

async function loadSettings() {
  try {
    // 显示回调地址
    const callbackEl = document.getElementById('callback-url');
    if (callbackEl) callbackEl.textContent = window.location.origin + '/api/wps-callback';

    const s = await api('settings');
    document.getElementById('setting-app-id').value = s.app_id || '';
    document.getElementById('setting-app-key').value = s.app_key_configured ? '' : '';
    document.getElementById('setting-app-key').placeholder = s.app_key_configured ? `已配置 (${s.app_key})` : '应用的 APPKEY';

    const statusEl = document.getElementById('auth-status');
    if (s.token_valid) {
      const exp = new Date(parseInt(s.token_expires_at));
      statusEl.className = 'auth-status ok';
      statusEl.innerHTML = `✅ 已连接，Token 有效至 ${exp.toLocaleString('zh-CN')}`;
    } else if (s.has_token) {
      statusEl.className = 'auth-status fail';
      statusEl.innerHTML = '⚠️ Token 已过期，请点击"测试连接"重新获取';
    } else {
      statusEl.className = 'auth-status fail';
      statusEl.innerHTML = '❌ 未连接，请保存凭证后点击"测试连接"';
    }
  } catch (e) {
    toast('加载设置失败: ' + e.message, 'error');
  }
}

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const appId = document.getElementById('setting-app-id').value.trim();
  const appKey = document.getElementById('setting-app-key').value.trim();
  const body = {};
  if (appId) body.app_id = appId;
  if (appKey) body.app_key = appKey;
  try {
    const result = await api('settings', { method: 'PUT', body });
    if (result.token_ok) {
      toast('凭证保存成功，已自动连接', 'success');
    } else {
      toast('凭证已保存，但连接失败: ' + (result.token_error || '未知错误'), 'error');
    }
    loadSettings();
  } catch (e) {
    toast('保存失败: ' + e.message, 'error');
  }
});

document.getElementById('btn-authorize').addEventListener('click', async () => {
  const btn = document.getElementById('btn-authorize');
  btn.textContent = '连接中...';
  btn.disabled = true;
  try {
    await api('auth/connect', { method: 'POST' });
    toast('连接成功', 'success');
    loadSettings();
  } catch (e) {
    toast('连接失败: ' + e.message, 'error');
  } finally {
    btn.textContent = '测试连接';
    btn.disabled = false;
  }
});

document.getElementById('btn-refresh-token').addEventListener('click', async () => {
  const btn = document.getElementById('btn-refresh-token');
  btn.textContent = '刷新中...';
  btn.disabled = true;
  try {
    await api('auth/connect', { method: 'POST' });
    toast('Token 刷新成功', 'success');
    loadSettings();
  } catch (e) {
    toast('刷新失败: ' + e.message, 'error');
  } finally {
    btn.textContent = '刷新Token';
    btn.disabled = false;
  }
});

// ==================== 日志页 ====================

async function loadLogs() {
  const container = document.getElementById('logs-table');
  container.innerHTML = '<div class="loading">加载中...</div>';
  try {
    const logs = await api('logs?limit=50');
    if (logs.length === 0) {
      container.innerHTML = '<div class="empty">暂无导入日志</div>';
      return;
    }
    let html = `<table>
      <thead><tr><th>时间</th><th>店铺</th><th>表格类型</th><th>行数</th><th>状态</th><th>消息</th></tr></thead>
      <tbody>`;
    logs.forEach(l => {
      const time = l.created_at ? new Date(l.created_at + 'Z').toLocaleString('zh-CN') : '-';
      html += `<tr>
        <td>${esc(time)}</td>
        <td>${esc(l.shop_name || '-')}</td>
        <td>${esc(l.table_type_name || '-')}</td>
        <td>${l.rows_imported || 0}</td>
        <td><span class="log-status ${l.status}">${l.status === 'success' ? '成功' : '失败'}</span></td>
        <td>${esc(l.message || '')}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<div class="empty">加载失败: ${esc(e.message)}</div>`;
  }
}

// ==================== 初始化 ====================

// 点击弹窗外部关闭
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target.id === 'modal-overlay') closeModal();
});

// 首次加载
(async () => {
  await loadSiteSettings();
  await checkWpsLoginStatus();
  router();
})();

// ==================== 演示模式（无后端时自动启用） ====================
let _demoNextId = 100;
const DEMO_DB = {
  shops: [
    { id: 1, name: '示例店铺A', created_at: '2025-07-06 10:00:00' },
    { id: 2, name: '示例店铺B', created_at: '2025-07-06 10:01:00' },
  ],
  table_types: [
    { id: 1, shop_id: 1, name: '销售表', source_file_token: 'demo_source_001', target_file_token: 'demo_target_001', target_sheet_idx: 0, created_at: '2025-07-06 10:02:00' },
    { id: 2, shop_id: 1, name: '库存表', source_file_token: 'demo_source_002', target_file_token: 'demo_target_002', target_sheet_idx: 0, created_at: '2025-07-06 10:03:00' },
    { id: 3, shop_id: 2, name: '销售表', source_file_token: 'demo_source_003', target_file_token: 'demo_target_003', target_sheet_idx: 0, created_at: '2025-07-06 10:04:00' },
  ],
  mappings: [
    { id: 1, table_type_id: 1, source_sheet_idx: 0, source_sheet_name: '销售数据', created_at: '2025-07-06 10:05:00' },
    { id: 2, table_type_id: 2, source_sheet_idx: 1, source_sheet_name: '库存数据', created_at: '2025-07-06 10:06:00' },
    { id: 3, table_type_id: 3, source_sheet_idx: 0, source_sheet_name: '销售数据', created_at: '2025-07-06 10:07:00' },
  ],
  logs: [
    { id: 1, shop_id: 1, table_type_id: 1, source_file_token: 'demo_src', rows_imported: 42, status: 'success', message: '导入42行', created_at: '2025-07-06 11:00:00', shop_name: '示例店铺A', table_type_name: '销售表' },
    { id: 2, shop_id: 1, table_type_id: 2, source_file_token: 'demo_src', rows_imported: 18, status: 'success', message: '导入18行', created_at: '2025-07-06 11:00:01', shop_name: '示例店铺A', table_type_name: '库存表' },
  ],
  settings: { app_id: 'demo_app_id', app_key: 'demo****', app_key_configured: true, has_token: true, token_valid: true, token_expires_at: String(Date.now() + 86400000) },
};

function demoApi(path, options = {}) {
  const [base, queryStr] = path.split('?');
  const q = new URLSearchParams(queryStr || '');
  const method = (options.method || 'GET').toUpperCase();
  const parts = base.split('/').filter(Boolean);
  const route = parts[0];
  const id = parts[1];
  const body = options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : {};
  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

  // 店铺
  if (route === 'shops') {
    if (method === 'GET') return DEMO_DB.shops;
    if (method === 'POST') {
      // 复制店铺
      if (id === 'copy') {
        const srcShop = DEMO_DB.shops.find(x => x.id == body.source_shop_id);
        if (!srcShop) return { error: '源店铺不存在' };
        const newShop = { id: _demoNextId++, name: body.new_name, created_at: now() };
        DEMO_DB.shops.push(newShop);
        const srcTypes = DEMO_DB.table_types.filter(t => t.shop_id == body.source_shop_id);
        let copiedMappings = 0;
        for (const tt of srcTypes) {
          const newTt = { ...tt, id: _demoNextId++, shop_id: newShop.id, created_at: now() };
          DEMO_DB.table_types.push(newTt);
          const srcMappings = DEMO_DB.mappings.filter(m => m.table_type_id == tt.id);
          for (const m of srcMappings) {
            DEMO_DB.mappings.push({ ...m, id: _demoNextId++, table_type_id: newTt.id, created_at: now() });
            copiedMappings++;
          }
        }
        return { ok: true, shop: newShop, copied_types: srcTypes.length, copied_mappings: copiedMappings };
      }
      const s = { id: _demoNextId++, name: body.name, created_at: now() }; DEMO_DB.shops.push(s); return s;
    }
    if (method === 'PUT' && id) { const s = DEMO_DB.shops.find(x => x.id == id); if (s) s.name = body.name; return { ok: true }; }
    if (method === 'DELETE' && id) { DEMO_DB.shops = DEMO_DB.shops.filter(x => x.id != id); DEMO_DB.table_types = DEMO_DB.table_types.filter(t => t.shop_id != id); return { ok: true }; }
  }
  // 表格类型
  if (route === 'table-types') {
    if (method === 'GET') { const sid = q.get('shop_id'); return sid ? DEMO_DB.table_types.filter(t => t.shop_id == sid) : DEMO_DB.table_types; }
    if (method === 'POST') { const t = { id: _demoNextId++, shop_id: body.shop_id, name: body.name, source_file_token: body.source_file_token || '', target_file_token: body.target_file_token || '', target_sheet_idx: body.target_sheet_idx || 0, start_col: body.start_col || 0, time_col: body.time_col != null ? body.time_col : -1, file_name_prefix: body.file_name_prefix || '', start_row: body.start_row != null ? body.start_row : -1, created_at: now() }; DEMO_DB.table_types.push(t); return t; }
    if (method === 'PUT' && id) { const t = DEMO_DB.table_types.find(x => x.id == id); if (t) { t.name = body.name; t.source_file_token = body.source_file_token || ''; t.target_file_token = body.target_file_token || ''; t.target_sheet_idx = body.target_sheet_idx || 0; t.start_col = body.start_col || 0; t.time_col = body.time_col != null ? body.time_col : -1; t.file_name_prefix = body.file_name_prefix || ''; t.start_row = body.start_row != null ? body.start_row : -1; } return { ok: true }; }
    if (method === 'DELETE' && id) { DEMO_DB.table_types = DEMO_DB.table_types.filter(x => x.id != id); DEMO_DB.mappings = DEMO_DB.mappings.filter(m => m.table_type_id != id); return { ok: true }; }
  }
  // 映射
  if (route === 'mappings') {
    if (method === 'GET') { const tid = q.get('table_type_id'); return tid ? DEMO_DB.mappings.filter(m => m.table_type_id == tid) : DEMO_DB.mappings; }
    if (method === 'POST') {
      // 批量保存
      if (id === 'batch') {
        const ttId = body.table_type_id;
        DEMO_DB.mappings = DEMO_DB.mappings.filter(m => m.table_type_id != ttId);
        const newMappings = (body.sheets || []).map(s => ({ id: _demoNextId++, table_type_id: ttId, source_sheet_idx: s.source_sheet_idx, source_sheet_name: s.source_sheet_name || '', created_at: now() }));
        DEMO_DB.mappings.push(...newMappings);
        return { ok: true, count: newMappings.length, mappings: newMappings };
      }
      const m = { id: _demoNextId++, table_type_id: body.table_type_id, source_sheet_idx: body.source_sheet_idx, source_sheet_name: body.source_sheet_name || '', created_at: now() }; DEMO_DB.mappings.push(m); return m;
    }
    if (method === 'DELETE' && id) { DEMO_DB.mappings = DEMO_DB.mappings.filter(x => x.id != id); return { ok: true }; }
  }
  // 表格操作
  if (route === 'sheets' && parts[1] === 'list') {
    return { file_token: q.get('file_token') || 'demo', sheets: [
      { index: 0, name: '销售数据', sheet_id: 's0', max_row: 100, max_col: 10 },
      { index: 1, name: '库存数据', sheet_id: 's1', max_row: 80, max_col: 8 },
      { index: 2, name: '订单明细', sheet_id: 's2', max_row: 200, max_col: 12 },
    ]};
  }
  if (route === 'sheets' && parts[1] === 'preview') {
    const headers = ['日期', '商品名称', '数量', '单价', '金额'];
    const dataRows = []; const products = ['商品A','商品B','商品C','商品D','商品E'];
    for (let i = 0; i < 15; i++) { const qty = Math.floor(Math.random()*100)+1, price = Math.floor(Math.random()*200)+10; dataRows.push([`2025-07-${String(i+1).padStart(2,'0')}`, products[i%5], String(qty), String(price), String(qty*price)]); }
    return { file_token: q.get('file_token') || 'demo', sheet_idx: parseInt(q.get('sheet_idx')||'0'), headers, dataRows, totalRows: dataRows.length+1 };
  }
  // 导入
  if (route === 'import' && method === 'POST') {
    const items = body.items || [];
    const results = [];
    for (const item of items) {
      const mapping = DEMO_DB.mappings.find(m => m.id == item.mapping_id);
      if (!mapping) { results.push({ mapping_id: item.mapping_id, status: 'skipped', message: '映射不存在' }); continue; }
      const tt = DEMO_DB.table_types.find(t => t.id == mapping.table_type_id);
      if (!tt) { results.push({ mapping_id: item.mapping_id, status: 'skipped', message: '表格类型不存在' }); continue; }
      if (!tt.target_file_token) { results.push({ table_type: tt.name, sheet: mapping.source_sheet_name, status: 'skipped', message: '未配置目标表格' }); continue; }
      const rows = (item.dataRows || []).length;
      results.push({ table_type: tt.name, sheet: mapping.source_sheet_name || `子表${mapping.source_sheet_idx}`, status: 'success', rows_imported: rows });
      DEMO_DB.logs.unshift({ id: _demoNextId++, shop_id: body.shop_id, table_type_id: tt.id, source_file_token: 'upload', rows_imported: rows, status: 'success', message: `导入${rows}行`, created_at: now(), shop_name: DEMO_DB.shops.find(s=>s.id==body.shop_id)?.name||'-', table_type_name: tt.name });
    }
    return { ok: true, results };
  }
  // 日志
  if (route === 'logs') return DEMO_DB.logs.slice(0, 50);
  // 设置
  if (route === 'settings') {
    if (method === 'GET') return DEMO_DB.settings;
    if (method === 'PUT') { if (body.app_id !== undefined) DEMO_DB.settings.app_id = body.app_id; if (body.app_key !== undefined) { DEMO_DB.settings.app_key = body.app_key.slice(0,4)+'****'; DEMO_DB.settings.app_key_configured = true; } return { ok: true, message: '设置已保存' }; }
  }
  // 认证
  if (route === 'auth') {
    if (parts[1] === 'connect') return { ok: true, message: '连接成功（演示）' };
    if (parts[1] === 'status') return { authorized: true, error: null };
  }
  // WPS用户登录状态（演示模式模拟已登录）
  if (route === 'wps-user') return { logged_in: true, name: '演示用户', id: 'demo', avatar: '', expires: Date.now() + 7200000 };
  // 初始化
  if (route === 'init-db') return { ok: true, message: '演示模式已预置数据' };

  return null; // 无匹配，抛出原始错误
}
