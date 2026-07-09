/**
 * WPS 365 企业自建应用 - 在线表格导入工具
 * Cloudflare Pages Functions 通配路由
 * 处理所有 /api/* 请求
 *
 * 认证方式：client_credentials（企业自建应用，无需用户OAuth授权）
 * API基础URL：https://openapi.wps.cn
 */

const WPS_API_BASE = 'https://openapi.wps.cn';

// ==================== 工具函数 ====================

/** btoa 安全封装 — 支持中文等非 Latin1 字符 */
function safeBtoa(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** atob 安全封装 — 与 safeBtoa 配对使用 */
function safeAtob(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

/** 从WPS链接或纯file_id中提取 file_id */
function parseFileToken(input) {
  if (!input) return null;
  const str = String(input).trim();
  // 纯token（不含斜杠和点，长度>10）
  if (!str.includes('/') && !str.includes('.') && str.length > 10) {
    return str;
  }
  // 从URL提取: kdocs.cn/l/xxxx 或 wps.cn/l/xxxx 或 带 file 参数
  const lMatch = str.match(/(?:kdocs|wps)\.cn\/l\/([A-Za-z0-9_\-]+)/);
  if (lMatch) return lMatch[1];
  const dMatch = str.match(/[?&]file=([A-Za-z0-9_\-]+)/);
  if (dMatch) return dMatch[1];
  // 从 /drive/ 或 /d/ 路径提取
  const driveMatch = str.match(/\/(?:drive|d)\/([A-Za-z0-9_\-]+)/);
  if (driveMatch) return driveMatch[1];
  // 尝试提取路径最后一段
  const parts = str.split('/').filter(Boolean);
  if (parts.length > 0) {
    const last = parts[parts.length - 1];
    if (last.length > 8) return last;
  }
  return str;
}

/** 从Cookie中提取用户登录token */
function getUserToken(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/wps_user=([^;]+)/);
  if (!match) return null;
  try {
    const data = JSON.parse(safeAtob(match[1]));
    if (Date.now() > data.expires) return null;
    return data;
  } catch (e) {
    return null;
  }
}

/** 渲染OAuth2回调结果页面 */
function renderAuthPage(success, userName, error) {
  if (success) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>登录成功</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}div{text-align:center}h2{color:#4ecca3}p{color:#a0a0a0}</style></head><body><div><h2>✅ 登录成功</h2><p>欢迎，${userName}！</p><p>正在跳转...</p><script>setTimeout(()=>location.href='/',1000)</script></div></body></html>`;
  }
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>登录失败</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}div{text-align:center}h2{color:#e74c3c}p{color:#a0a0a0}a{color:#4ecca3}</style></head><body><div><h2>❌ 登录失败</h2><p>${error || '未知错误'}</p><a href="/">返回首页</a></div></body></html>`;
}

// ==================== Token 管理 ====================

async function getSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row?.value || '';
}

async function setSetting(env, key, value) {
  await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, value).run();
}

/**
 * 获取有效的 access_token（企业自建应用 client_credentials 方式）
 * token有效期2小时，过期自动重新获取
 */
async function getValidAccessToken(env) {
  const accessToken = await getSetting(env, 'access_token');
  const expiresAt = await getSetting(env, 'token_expires_at');
  const now = Date.now();

  // token存在且未过期（提前5分钟刷新）
  if (accessToken && expiresAt && now < parseInt(expiresAt) - 300000) {
    return { ok: true, access_token: accessToken };
  }

  // 重新获取token（client_credentials方式，不需要refresh_token）
  const appId = await getSetting(env, 'app_id');
  const appKey = await getSetting(env, 'app_key');
  if (!appId || !appKey) return { ok: false, error: '未配置 app_id / app_key' };

  const result = await doClientCredentials(env, appId, appKey);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, access_token: result.access_token };
}

/**
 * 企业自建应用获取租户access_token
 * POST https://openapi.wps.cn/oauth2/token
 * Body: grant_type=client_credentials&client_id=APPID&client_secret=APPKEY
 */
async function doClientCredentials(env, appId, appKey) {
  const resp = await fetch(`${WPS_API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appKey)}`,
  });
  const data = await resp.json();

  if (data.code !== undefined && data.code !== 0) {
    return { ok: false, error: data.msg || '获取access_token失败' };
  }
  if (!data.access_token) {
    return { ok: false, error: data.msg || '获取access_token失败' };
  }

  const expiresIn = parseInt(data.expires_in) || 7200;
  await setSetting(env, 'access_token', data.access_token);
  await setSetting(env, 'token_expires_at', String(Date.now() + expiresIn * 1000));

  return { ok: true, access_token: data.access_token };
}

// ==================== WPS 365 API 调用 ====================

/**
 * 调用 WPS 365 API
 * access_token 放在 Authorization: Bearer 头中（query参数方式会报authorization header not found）
 * 可选 KSO-1 签名（用 client_id/client_secret 当 appid/appkey 兜底）
 */
function wpsHeaders(accessToken, env) {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  // 如果配置了签名密钥，添加 KSO-1 签名头
  const ksoSignKey = env?.KSO_SIGN_KEY;
  if (ksoSignKey) {
    headers['KSO-1'] = `sign=...`; // 简化：暂不实现签名，按文档要求appid/appkey查询参数保留
  }
  return headers;
}

/**
 * 获取表格的所有工作表
 * GET https://openapi.wps.cn/v7/sheets/{file_id}/worksheets
 * Header: Authorization: Bearer {access_token}
 */
async function wpsGetWorksheets(accessToken, fileId) {
  const url = `${WPS_API_BASE}/v7/sheets/${fileId}/worksheets`;
  const resp = await fetch(url, { headers: wpsHeaders(accessToken) });
  return resp.json();
}

/**
 * 读取区域数据
 * GET https://openapi.wps.cn/v7/sheets/{file_id}/worksheets/{worksheet_id}/range_data
 * Query: row_from, row_to, col_from, col_to
 * Header: Authorization: Bearer {access_token}
 */
async function wpsGetRangeData(accessToken, fileId, worksheetId, rowFrom, rowTo, colFrom, colTo) {
  const url = `${WPS_API_BASE}/v7/sheets/${fileId}/worksheets/${worksheetId}/range_data`
    + `?row_from=${rowFrom}&row_to=${rowTo}&col_from=${colFrom}&col_to=${colTo}`;
  const resp = await fetch(url, { headers: wpsHeaders(accessToken) });
  return resp.json();
}

/**
 * 批量更新区域数据（写入单元格）
 * POST https://openapi.wps.cn/v7/sheets/{file_id}/worksheets/{worksheet_id}/range_data/batch_update
 * Header: Authorization: Bearer {access_token}
 * Body: { range_data: [{ op_type, col_from, col_to, row_from, row_to, formula }] }
 */
async function wpsBatchUpdateRange(accessToken, fileId, worksheetId, rangeData) {
  const url = `${WPS_API_BASE}/v7/sheets/${fileId}/worksheets/${worksheetId}/range_data/batch_update`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: wpsHeaders(accessToken),
    body: JSON.stringify({ range_data: rangeData }),
  });
  return resp.json();
}

/**
 * 读取源表格的一个子表全部数据（自动跳过表头）
 * worksheetId 可以是字符串sheet_id或数字索引
 * 返回 { headers, dataRows, totalRows, sheetName }
 */
async function readSheetData(env, fileId, worksheetIdOrIdx, maxRows = 5000, maxCols = 50) {
  const tokenResult = await getValidAccessToken(env);
  if (!tokenResult.ok) throw new Error(tokenResult.error);

  // 如果传入的是数字，需要先获取worksheets列表，按索引找到sheet_id
  let sheetId = worksheetIdOrIdx;
  let sheetName = '';
  if (typeof worksheetIdOrIdx === 'number' || /^\d+$/.test(String(worksheetIdOrIdx))) {
    const idx = parseInt(worksheetIdOrIdx);
    const wsResult = await wpsGetWorksheets(tokenResult.access_token, fileId);
    if (wsResult.code !== 0) throw new Error(wsResult.msg || '获取子表列表失败');
    const sheets = wsResult.data?.sheets || [];
    if (idx >= sheets.length) throw new Error(`子表索引${idx}超出范围（共${sheets.length}个子表）`);
    // 按index排序后取第idx个
    sheets.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    sheetId = sheets[idx].sheet_id;
    sheetName = sheets[idx].name || '';
  }

  const result = await wpsGetRangeData(tokenResult.access_token, fileId, sheetId, 0, maxRows, 0, maxCols);
  if (result.code !== 0) throw new Error(result.msg || '读取数据失败');

  const cells = result.data?.range_data || [];
  if (cells.length === 0) return { headers: [], dataRows: [], totalRows: 0, sheetName };

  // 将单元格数据组织成二维数组
  const grid = {};
  let maxRow = 0, maxCol = 0;
  for (const cell of cells) {
    const r = cell.row_from;
    const c = cell.col_from;
    grid[`${r}_${c}`] = cell.cell_text || '';
    if (r > maxRow) maxRow = r;
    if (c > maxCol) maxCol = c;
  }

  // 构建二维数组
  const allRows = [];
  for (let r = 0; r <= maxRow; r++) {
    const row = [];
    for (let c = 0; c <= maxCol; c++) {
      row.push(grid[`${r}_${c}`] || '');
    }
    allRows.push(row);
  }

  // 第一行是表头，其余是数据
  const headers = allRows.length > 0 ? allRows[0] : [];
  const dataRows = allRows.slice(1).filter(row => row.some(v => v !== ''));
  return { headers, dataRows, totalRows: allRows.length, sheetName };
}

/**
 * 找到目标表格最后一个有数据的行号
 * 只扫描指定的 scanCol 列，找到该列最后一个非空单元格
 * maxRow 来自 WPS API 的 max_row（WPS 表格的逻辑总行数，可超过 10000）
 * 按 BATCH_ROWS 分批循环读取，避免单次请求过大导致 API 返回空
 */
async function findLastRow(env, fileId, sheetId, maxRow, scanCol, token = null) {
  let accessToken = token;
  if (!accessToken) {
    const tokenResult = await getValidAccessToken(env);
    if (!tokenResult.ok) throw new Error(tokenResult.error);
    accessToken = tokenResult.access_token;
  }

  // 起始扫描上限：maxRow 可能偏低（如旧表格返回 16384），至少扫 50000 行
  // 如果扫描到边界仍有数据，会自动向下扩展
  let readRowTo = Math.max(maxRow || 0, 50000);
  const BATCH_ROWS = 2000; // 每批最多2000行
  let lastRow = -1;

  while (true) {
    let batchStart = 0;
    // 从上次已知 lastRow 之后开始续扫（避免每次从头）
    if (lastRow >= 0) batchStart = Math.max(0, lastRow - BATCH_ROWS + 1);

    let foundDataInLastBatch = false;
    for (; batchStart <= readRowTo; batchStart += BATCH_ROWS) {
      const batchEnd = Math.min(batchStart + BATCH_ROWS - 1, readRowTo);
      // 只读 scanCol 这一列，减少数据量
      const result = await wpsGetRangeData(accessToken, fileId, sheetId, batchStart, batchEnd, scanCol, scanCol);
      if (result.code !== 0) continue;
      const cells = result.data?.range_data || [];
      for (const cell of cells) {
        if (cell.cell_text && String(cell.cell_text).trim() !== '') {
          if (cell.row_from > lastRow) lastRow = cell.row_from;
        }
      }
      // 标记最后一批是否有数据（用于判断是否需要扩展扫描）
      if (batchEnd >= readRowTo && cells.length > 0) {
        foundDataInLastBatch = true;
      }
    }

    // 如果扫描到当前上限时最后一批还有数据，说明 maxRow 偏低，继续扩展
    if (foundDataInLastBatch && lastRow >= readRowTo - BATCH_ROWS) {
      readRowTo += 50000; // 再向下扩展 5 万行
      continue; // 继续扫描
    }
    break; // 边界已无数据或已确认找到末行
  }

  return lastRow;
}

/**
 * 获取目标表格的sheet_id（按数字索引匹配）
 */
async function getTargetSheetId(env, fileId, sheetIdx, token = null) {
  let accessToken = token;
  if (!accessToken) {
    const tokenResult = await getValidAccessToken(env);
    if (!tokenResult.ok) throw new Error(tokenResult.error);
    accessToken = tokenResult.access_token;
  }
  const wsResult = await wpsGetWorksheets(accessToken, fileId);
  if (wsResult.code !== 0) {
    throw new Error(`获取目标子表列表失败: [${wsResult.code}] ${wsResult.msg || ''}`);
  }
  const sheets = wsResult.data?.sheets || [];
  if (sheetIdx >= sheets.length) throw new Error(`目标子表索引${sheetIdx}超出范围（共${sheets.length}个子表）`);
  sheets.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return sheets[sheetIdx].sheet_id;
}

// ==================== 路由处理 ====================

// --- 设置 ---
async function handleSettings(request, env) {
  if (request.method === 'GET') {
    const appId = await getSetting(env, 'app_id');
    const appKey = await getSetting(env, 'app_key');
    const hasToken = !!(await getSetting(env, 'access_token'));
    const expiresAt = await getSetting(env, 'token_expires_at');
    const tokenValid = hasToken && expiresAt && Date.now() < parseInt(expiresAt);
    return json({
      app_id: appId,
      app_key: appKey ? appKey.slice(0, 4) + '****' : '',
      app_key_configured: !!appKey,
      has_token: hasToken,
      token_valid: tokenValid,
      token_expires_at: expiresAt || '',
    });
  }
  if (request.method === 'PUT') {
    const body = await request.json();
    if (body.app_id !== undefined) await setSetting(env, 'app_id', body.app_id);
    if (body.app_key !== undefined) await setSetting(env, 'app_key', body.app_key);

    // 保存凭证后自动获取token
    const appId = body.app_id || await getSetting(env, 'app_id');
    const appKey = body.app_key || await getSetting(env, 'app_key');
    let tokenResult = null;
    if (appId && appKey) {
      tokenResult = await doClientCredentials(env, appId, appKey);
    }

    return json({
      ok: true,
      message: tokenResult?.ok ? '设置已保存，token获取成功' : '设置已保存，但token获取失败',
      token_ok: tokenResult?.ok || false,
      token_error: tokenResult?.error || null,
    });
  }
  return json({ error: 'Method not allowed' }, 405);
}

// --- 认证（企业自建应用 client_credentials）---
async function handleAuth(request, env, params) {
  const action = params[0] || '';

  // 测试连接 / 手动刷新token
  if (action === 'connect' && request.method === 'POST') {
    const appId = await getSetting(env, 'app_id');
    const appKey = await getSetting(env, 'app_key');
    if (!appId || !appKey) return json({ error: '请先配置 app_id / app_key' }, 400);

    const result = await doClientCredentials(env, appId, appKey);
    if (!result.ok) return json({ error: result.error }, 400);
    return json({ ok: true, message: '连接成功，token已获取' });
  }

  // 检查状态
  if (action === 'status' && request.method === 'GET') {
    const tokenResult = await getValidAccessToken(env);
    return json({
      authorized: tokenResult.ok,
      error: tokenResult.error || null,
    });
  }

  return json({ error: 'Unknown auth action' }, 404);
}

// --- WPS OAuth2 用户登录 ---
async function handleWpsLogin(request, env) {
  const appId = await getSetting(env, 'app_id');
  if (!appId) return json({ error: '未配置 app_id，请先在设置页面配置' }, 400);

  const url = new URL(request.url);
  const origin = url.origin;
  const redirectUri = `${origin}/api/wps-callback`;
  const state = Math.random().toString(36).substring(2, 15);

  const authUrl = `${WPS_API_BASE}/oauthapi/v2/authorize?response_type=code&appid=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user_info&state=${state}&style=dark`;

  return Response.redirect(authUrl, 302);
}

// --- WPS OAuth2 回调 ---
async function handleWpsCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    const errorDesc = url.searchParams.get('error_description') || error;
    return new Response(renderAuthPage(false, '', errorDesc), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (!code) {
    return new Response(renderAuthPage(false, '', '未收到授权码'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const appId = await getSetting(env, 'app_id');
  const appKey = await getSetting(env, 'app_key');
  if (!appId || !appKey) {
    return new Response(renderAuthPage(false, '', '未配置应用凭证'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // 用授权码换取 access_token（GET请求，参数在query中）
  const tokenUrl = `${WPS_API_BASE}/oauthapi/v2/token?appid=${encodeURIComponent(appId)}&appkey=${encodeURIComponent(appKey)}&code=${encodeURIComponent(code)}`;
  const resp = await fetch(tokenUrl);
  const data = await resp.json();

  if (data.result !== 0 || !data.token?.access_token) {
    const errMsg = data.msg || data.error || '获取access_token失败';
    return new Response(renderAuthPage(false, '', errMsg), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const accessToken = data.token.access_token;
  const refreshToken = data.token.refresh_token || '';
  const openId = data.token.openid || '';
  const expiresIn = parseInt(data.token.expires_in) || 7200;

  // 获取用户信息
  let userName = 'WPS用户';
  let userId = openId;
  let userAvatar = '';
  try {
    const userUrl = `${WPS_API_BASE}/oauthapi/v3/user?access_token=${encodeURIComponent(accessToken)}&appid=${encodeURIComponent(appId)}&openid=${encodeURIComponent(openId)}`;
    const userResp = await fetch(userUrl);
    const userData = await userResp.json();
    if (userData.result === 0 && userData.user) {
      userName = userData.user.nickname || userData.user.company_uid || 'WPS用户';
      userId = userData.user.company_uid || userData.user.openid || openId;
      userAvatar = userData.user.avatar || userData.user.logo || '';
    }
  } catch (e) {
    // 用户信息获取失败不影响登录
  }

  // 将用户token存入Cookie（使用 safeBtoa 支持中文用户名）
  const cookieValue = safeBtoa(JSON.stringify({
    token: accessToken,
    name: userName,
    id: userId,
    avatar: userAvatar,
    refresh_token: refreshToken,
    expires: Date.now() + expiresIn * 1000,
  }));

  return new Response(renderAuthPage(true, userName, ''), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': `wps_user=${cookieValue}; HttpOnly; Secure; SameSite=Lax; Max-Age=${expiresIn}; Path=/`,
    },
  });
}

// --- WPS 登出 ---
async function handleWpsLogout() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'wps_user=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/',
    },
  });
}

// --- WPS 用户状态 ---
async function handleWpsUser(request) {
  const userToken = getUserToken(request);
  if (!userToken) {
    return json({ logged_in: false });
  }
  return json({
    logged_in: true,
    name: userToken.name,
    id: userToken.id,
    avatar: userToken.avatar || '',
    expires: userToken.expires,
  });
}

// --- 店铺管理 ---
async function handleShops(request, env, subParams) {
  const id = subParams[0];

  if (request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT * FROM shops ORDER BY id').all();
    return json(rows.results);
  }

  if (request.method === 'POST') {
    const body = await request.json();

    // 复制店铺：连同表格类型和子表映射一起复制
    if (subParams[0] === 'copy') {
      const { source_shop_id, new_name } = body;
      if (!source_shop_id || !new_name) return json({ error: '源店铺ID和新店铺名称不能为空' }, 400);
      try {
        // 创建新店铺
        await env.DB.prepare('INSERT INTO shops (name) VALUES (?)').bind(new_name).run();
        const newShop = await env.DB.prepare('SELECT * FROM shops WHERE name = ?').bind(new_name).first();

        // 复制表格类型
        const tableTypes = await env.DB.prepare('SELECT * FROM table_types WHERE shop_id = ? ORDER BY id').bind(source_shop_id).all();
        let copiedTypes = 0, copiedMappings = 0;
        for (const tt of tableTypes.results) {
          await env.DB.prepare(
            'INSERT INTO table_types (shop_id, name, source_file_token, target_file_token, target_sheet_idx, start_col, time_col, file_name_prefix, start_row, source_start_row, source_start_col) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(newShop.id, tt.name, tt.source_file_token || '', tt.target_file_token || '', tt.target_sheet_idx || 0, tt.start_col || 0, tt.time_col != null ? tt.time_col : -1, tt.file_name_prefix || '', tt.start_row != null ? tt.start_row : -1, tt.source_start_row || 0, tt.source_start_col || 0).run();

          // 获取新创建的 table_type id
          const newTt = await env.DB.prepare('SELECT * FROM table_types ORDER BY id DESC LIMIT 1').first();

          // 复制子表映射
          const mappings = await env.DB.prepare('SELECT * FROM sub_table_mappings WHERE table_type_id = ? ORDER BY id').bind(tt.id).all();
          for (const m of mappings.results) {
            await env.DB.prepare(
              'INSERT INTO sub_table_mappings (table_type_id, source_sheet_idx, source_sheet_name) VALUES (?, ?, ?)'
            ).bind(newTt.id, m.source_sheet_idx, m.source_sheet_name || '').run();
            copiedMappings++;
          }
          copiedTypes++;
        }

        return json({ ok: true, shop: newShop, copied_types: copiedTypes, copied_mappings: copiedMappings }, 201);
      } catch (e) {
        return json({ error: '复制失败: ' + e.message }, 400);
      }
    }

    if (!body.name) return json({ error: '店铺名称不能为空' }, 400);
    try {
      await env.DB.prepare('INSERT INTO shops (name) VALUES (?)').bind(body.name).run();
      const row = await env.DB.prepare('SELECT * FROM shops WHERE name = ?').bind(body.name).first();
      return json(row, 201);
    } catch (e) {
      return json({ error: '店铺名称已存在' }, 400);
    }
  }

  if (request.method === 'PUT' && id) {
    const body = await request.json();
    if (!body.name) return json({ error: '店铺名称不能为空' }, 400);
    try {
      await env.DB.prepare('UPDATE shops SET name = ? WHERE id = ?').bind(body.name, id).run();
      return json({ ok: true });
    } catch (e) {
      return json({ error: '店铺名称已存在' }, 400);
    }
  }

  if (request.method === 'DELETE' && id) {
    await env.DB.prepare('DELETE FROM shops WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}

// --- 表格类型管理 ---
async function handleTableTypes(request, env, params) {
  const id = params[0];
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const shopId = url.searchParams.get('shop_id');
    let rows;
    if (shopId) {
      rows = await env.DB.prepare('SELECT * FROM table_types WHERE shop_id = ? ORDER BY id').bind(shopId).all();
    } else {
      rows = await env.DB.prepare('SELECT * FROM table_types ORDER BY id').all();
    }
    return json(rows.results);
  }

  if (request.method === 'POST') {
    const body = await request.json();
    if (!body.name || !body.shop_id) return json({ error: '名称和店铺ID不能为空' }, 400);
    await env.DB.prepare(
      'INSERT INTO table_types (shop_id, name, source_file_token, target_file_token, target_sheet_idx, start_col, time_col, file_name_prefix, start_row, source_start_row, source_start_col) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(body.shop_id, body.name, body.source_file_token || '', body.target_file_token || '', body.target_sheet_idx || 0, body.start_col || 0, body.time_col != null ? body.time_col : -1, body.file_name_prefix || '', body.start_row != null ? body.start_row : -1, body.source_start_row || 0, body.source_start_col || 0).run();
    const row = await env.DB.prepare('SELECT * FROM table_types ORDER BY id DESC LIMIT 1').first();
    return json(row, 201);
  }

  if (request.method === 'PUT' && id) {
    const body = await request.json();
    await env.DB.prepare(
      'UPDATE table_types SET name = ?, source_file_token = ?, target_file_token = ?, target_sheet_idx = ?, start_col = ?, time_col = ?, file_name_prefix = ?, start_row = ?, source_start_row = ?, source_start_col = ? WHERE id = ?'
    ).bind(body.name || '', body.source_file_token || '', body.target_file_token || '', body.target_sheet_idx || 0, body.start_col || 0, body.time_col != null ? body.time_col : -1, body.file_name_prefix || '', body.start_row != null ? body.start_row : -1, body.source_start_row || 0, body.source_start_col || 0, id).run();
    return json({ ok: true });
  }

  if (request.method === 'DELETE' && id) {
    await env.DB.prepare('DELETE FROM table_types WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}

// --- 子表映射管理 ---
async function handleMappings(request, env, params) {
  const id = params[0];
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const tableTypeId = url.searchParams.get('table_type_id');
    let rows;
    if (tableTypeId) {
      rows = await env.DB.prepare('SELECT * FROM sub_table_mappings WHERE table_type_id = ? ORDER BY id').bind(tableTypeId).all();
    } else {
      rows = await env.DB.prepare('SELECT * FROM sub_table_mappings ORDER BY id').all();
    }
    return json(rows.results);
  }

  if (request.method === 'POST') {
    const body = await request.json();

    // 批量保存：替换某个 table_type_id 下的所有映射
    if (params[0] === 'batch') {
      const tableTypeId = body.table_type_id;
      const sheets = body.sheets || [];
      if (!tableTypeId) return json({ error: 'table_type_id 不能为空' }, 400);

      // 先删除旧映射
      await env.DB.prepare('DELETE FROM sub_table_mappings WHERE table_type_id = ?').bind(tableTypeId).run();
      // 再批量插入
      for (const s of sheets) {
        await env.DB.prepare(
          'INSERT INTO sub_table_mappings (table_type_id, source_sheet_idx, source_sheet_name) VALUES (?, ?, ?)'
        ).bind(tableTypeId, s.source_sheet_idx, s.source_sheet_name || '').run();
      }
      const rows = await env.DB.prepare('SELECT * FROM sub_table_mappings WHERE table_type_id = ? ORDER BY id').bind(tableTypeId).all();
      return json({ ok: true, count: rows.results.length, mappings: rows.results });
    }

    if (!body.table_type_id || body.source_sheet_idx === undefined) {
      return json({ error: '表格类型ID和子表索引不能为空' }, 400);
    }
    await env.DB.prepare(
      'INSERT INTO sub_table_mappings (table_type_id, source_sheet_idx, source_sheet_name) VALUES (?, ?, ?)'
    ).bind(body.table_type_id, body.source_sheet_idx, body.source_sheet_name || '').run();
    const row = await env.DB.prepare('SELECT * FROM sub_table_mappings ORDER BY id DESC LIMIT 1').first();
    return json(row, 201);
  }

  if (request.method === 'DELETE' && id) {
    await env.DB.prepare('DELETE FROM sub_table_mappings WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}

// --- 表格操作（获取子表列表、读取数据）---
async function handleSheets(request, env, params) {
  const url = new URL(request.url);
  const action = params[0] || '';

  // 获取子表列表
  if (action === 'list' && request.method === 'GET') {
    const fileId = parseFileToken(url.searchParams.get('file_token') || url.searchParams.get('url'));
    if (!fileId) return json({ error: '请提供表格链接或file_id' }, 400);

    const tokenResult = await getValidAccessToken(env);
    if (!tokenResult.ok) return json({ error: tokenResult.error }, 401);

    const result = await wpsGetWorksheets(tokenResult.access_token, fileId);
    if (result.code !== 0) return json({ error: result.msg || '获取子表列表失败' }, 400);

    // 转换格式，保持前端兼容
    const sheets = (result.data?.sheets || []).map(s => ({
      index: s.index,
      name: s.name,
      sheet_id: s.sheet_id,
      max_row: s.max_row,
      max_col: s.max_col,
    }));
    return json({ file_id: fileId, sheets });
  }

  // 读取子表数据预览
  if (action === 'preview' && request.method === 'GET') {
    const fileId = parseFileToken(url.searchParams.get('file_token') || url.searchParams.get('url'));
    const sheetIdx = parseInt(url.searchParams.get('sheet_idx') || '0');
    if (!fileId) return json({ error: '请提供表格链接或file_id' }, 400);

    try {
      const data = await readSheetData(env, fileId, sheetIdx, 100, 30);
      return json({ file_id: fileId, sheet_idx: sheetIdx, ...data });
    } catch (e) {
      return json({ error: e.message }, 400);
    }
  }

  return json({ error: 'Unknown sheets action' }, 404);
}

// --- 导入数据 ---
// 请求体: { shop_id, items: [{ mapping_id, headers: [], dataRows: [[],...] }] }
// 前端解析上传的文件后，将每个子表的数据连同mapping_id一起发送
async function handleImport(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // 检查用户登录状态（登录=身份校验+审计；数据写入用租户token，文档权限由WPS分享设置控制）
  const userToken = getUserToken(request);
  if (!userToken) {
    return json({ error: '请先登录WPS账号后再导入数据', need_login: true }, 401);
  }

  const body = await request.json();
  const { shop_id, items, import_time } = body;

  if (!shop_id) return json({ error: '请选择店铺' }, 400);
  if (!items || !Array.isArray(items) || items.length === 0) {
    return json({ error: '没有要导入的数据' }, 400);
  }

  const results = [];

  for (const item of items) {
    try {
      // 查找映射
      // 查找映射：优先用 mapping_id，找不到时按 table_type_id 找
      let mapping = null;
      if (item.mapping_id && item.mapping_id > 0) {
        mapping = await env.DB.prepare(
          'SELECT * FROM sub_table_mappings WHERE id = ?'
        ).bind(item.mapping_id).first();
      }
      // 文件名匹配场景：item 里直接带 table_type 完整对象
      if (!mapping && item.table_type && item.table_type.id) {
        const tt0 = await env.DB.prepare('SELECT * FROM table_types WHERE id = ?').bind(item.table_type.id).first();
        if (tt0) {
          // 找一个属于该 table_type 的任意 mapping（用于记日志和 source_sheet_name）
          mapping = await env.DB.prepare(
            'SELECT * FROM sub_table_mappings WHERE table_type_id = ? ORDER BY id LIMIT 1'
          ).bind(tt0.id).first();
          // 用占位 mapping 指向这个 table_type（如果该 table_type 还没建 mapping）
          if (!mapping) {
            mapping = {
              id: 0,
              table_type_id: tt0.id,
              source_sheet_idx: 0,
              source_sheet_name: '',
            };
          }
        }
      }

      if (!mapping) {
        results.push({ mapping_id: item.mapping_id, status: 'skipped', message: '映射不存在' });
        continue;
      }

      // 查找表格类型配置
      const tt = await env.DB.prepare(
        'SELECT * FROM table_types WHERE id = ?'
      ).bind(mapping.table_type_id).first();

      if (!tt) {
        results.push({ mapping_id: item.mapping_id, status: 'skipped', message: '表格类型不存在' });
        continue;
      }

      if (!tt.target_file_token) {
        results.push({
          table_type: tt.name,
          sheet: mapping.source_sheet_name || `子表${mapping.source_sheet_idx}`,
          status: 'skipped',
          message: '未配置目标表格',
        });
        continue;
      }

      const dataRows = item.dataRows || [];
      const headers = item.headers || [];

      if (dataRows.length === 0) {
        results.push({
          table_type: tt.name,
          sheet: mapping.source_sheet_name || `子表${mapping.source_sheet_idx}`,
          status: 'skipped',
          message: '数据为空',
        });
        continue;
      }

      // 解析目标表格链接，提取 file_id
      const targetFileId = parseFileToken(tt.target_file_token);
      if (!targetFileId) {
        results.push({
          table_type: tt.name,
          sheet: mapping.source_sheet_name || `子表${mapping.source_sheet_idx}`,
          status: 'skipped',
          message: '目标表格链接无效，无法解析file_id',
        });
        continue;
      }

      // 获取租户token（WPS sheets API需要租户token，用户token无法调用服务端API）
      const tokenResult = await getValidAccessToken(env);
      if (!tokenResult.ok) {
        throw new Error(`获取租户token失败: ${tokenResult.error}`);
      }
      const tenantToken = tokenResult.access_token;

      // 获取目标子表信息（sheet_id + max_row），一次API调用
      const wsResult = await wpsGetWorksheets(tenantToken, targetFileId);
      if (wsResult.code !== 0) {
        throw new Error(`获取目标子表列表失败: [${wsResult.code}] ${wsResult.msg || ''}`);
      }
      const wsSheets = (wsResult.data?.sheets || []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      // 写入目标子表：始终用 table_types 配置的 target_sheet_idx（即「这个类型对应目标表格的第几个子表」）
      // 注意：item.source_sheet_idx 是上传文件中的子表序号，与目标表格的子表无关
      const targetSheetIdx = parseInt(tt.target_sheet_idx) || 0;
      if (targetSheetIdx >= wsSheets.length) {
        throw new Error(`目标子表索引${targetSheetIdx}超出范围（共${wsSheets.length}个子表）`);
      }
      const targetSheetId = wsSheets[targetSheetIdx].sheet_id;
      const targetMaxRow = wsSheets[targetSheetIdx].max_row || 0;

      // 列偏移、导入时间列、起始行（从table_types配置读取）
      const startCol = tt.start_col || 0;       // 数据从第几列开始写入（0-based）
      const timeCol = tt.time_col != null ? tt.time_col : -1; // 时间写入到第几列（-1=不写）
      const startRowCfg = tt.start_row != null ? parseInt(tt.start_row) : -1;

      // 确定写入起始行：start_row >= 0 时用固定位置，否则自动找末行追加
      let startRow;
      if (startRowCfg >= 0) {
        startRow = startRowCfg;
      } else {
        const lastRow = await findLastRow(env, targetFileId, targetSheetId, targetMaxRow, startCol, tenantToken);
        startRow = lastRow + 1;
      }

      // 格式化导入时间为 YYYY/M/D（仅保留日期）
      let formattedTime = '';
      if (import_time) {
        const d = new Date(import_time);
        if (!isNaN(d.getTime())) {
          formattedTime = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
        }
      }
      const hasTime = timeCol >= 0 && formattedTime;

      // 构建写入range_data并分批写入
      const colCount = Math.max(headers.length, ...dataRows.map(r => r.length));
      const MAX_CELLS = 2000;
      // 如果有时间列，每行多一个单元格
      const cellsPerRow = colCount + (hasTime ? 1 : 0);
      const rowsPerBatch = Math.max(1, Math.floor(MAX_CELLS / cellsPerRow));

      let importedRows = 0;
      for (let batchStart = 0; batchStart < dataRows.length; batchStart += rowsPerBatch) {
        const batchEnd = Math.min(batchStart + rowsPerBatch, dataRows.length);
        const batchRangeData = [];
        for (let r = batchStart; r < batchEnd; r++) {
          for (let c = 0; c < colCount; c++) {
            const value = dataRows[r][c];
            if (value !== '' && value != null && value !== undefined) {
              batchRangeData.push({
                op_type: 'cell_operation_type_formula',
                row_from: startRow + r,
                row_to: startRow + r,
                col_from: startCol + c,
                col_to: startCol + c,
                formula: String(value),
              });
            }
          }
          // 写入导入时间到指定列（仅日期，格式 YYYY/M/D）
          if (hasTime) {
            batchRangeData.push({
              op_type: 'cell_operation_type_formula',
              row_from: startRow + r,
              row_to: startRow + r,
              col_from: timeCol,
              col_to: timeCol,
              formula: String(formattedTime),
            });
          }
        }
        if (batchRangeData.length === 0) {
          importedRows += (batchEnd - batchStart);
          continue;
        }

        // 使用租户token写入数据
        const writeResult = await wpsBatchUpdateRange(
          tenantToken,
          targetFileId,
          targetSheetId,
          batchRangeData
        );
        if (writeResult.code !== 0) {
          throw new Error(writeResult.msg || '写入失败');
        }
        importedRows += (batchEnd - batchStart);
      }

      results.push({
        table_type: tt.name,
        sheet: mapping.source_sheet_name || `子表${mapping.source_sheet_idx}`,
        status: 'success',
        rows_imported: importedRows,
        start_row: startRow,
        last_row: startRow + importedRows - 1,
      });

      // 记录日志（含操作人身份）
      await env.DB.prepare(
        'INSERT INTO import_logs (shop_id, table_type_id, source_file_token, rows_imported, status, message) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(shop_id, tt.id, `upload:${mapping.source_sheet_name || mapping.source_sheet_idx}`, importedRows, 'success', `导入${importedRows}行 | 操作人: ${userToken.name}`).run();

    } catch (e) {
      results.push({
        mapping_id: item.mapping_id,
        status: 'error',
        message: e.message,
      });
      // 尝试记录错误日志
      try {
        const mapping = await env.DB.prepare('SELECT * FROM sub_table_mappings WHERE id = ?').bind(item.mapping_id).first();
        const tt = mapping ? await env.DB.prepare('SELECT * FROM table_types WHERE id = ?').bind(mapping.table_type_id).first() : null;
        await env.DB.prepare(
          'INSERT INTO import_logs (shop_id, table_type_id, source_file_token, rows_imported, status, message) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(shop_id, tt?.id || 0, 'upload', 0, 'error', `${e.message} | 操作人: ${userToken.name}`).run();
      } catch (_) {}
    }
  }

  return json({ ok: true, results });
}

// --- 导入日志 ---
async function cleanOldLogs(env) {
  try {
    await env.DB.prepare("DELETE FROM import_logs WHERE created_at < datetime('now', '-7 days')").run();
  } catch (e) {}
}

async function handleLogs(request, env) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  // 自动清理一周前的日志
  await cleanOldLogs(env);
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const rows = await env.DB.prepare(
    'SELECT l.*, s.name as shop_name, t.name as table_type_name FROM import_logs l '
    + 'LEFT JOIN shops s ON l.shop_id = s.id '
    + 'LEFT JOIN table_types t ON l.table_type_id = t.id '
    + 'ORDER BY l.id DESC LIMIT ?'
  ).bind(limit).all();
  return json(rows.results);
}

// --- 密码管理（KV 存储）---
const DEFAULT_PASSWORD = 'admin';

async function getPassword(env, type) {
  // type: 'admin' 或 'developer'
  const val = await env.SITE_KV.get(`pwd_${type}`);
  return val || DEFAULT_PASSWORD;
}

async function setPassword(env, type, value) {
  await env.SITE_KV.put(`pwd_${type}`, value);
}

/** 生成简单的会话 token */
function makeSessionToken(type) {
  return btoa(`${type}:${Date.now()}:${Math.random().toString(36).slice(2)}`);
}

/** 从请求中提取密码会话 */
function getPasswordSession(request) {
  const cookie = request.headers.get('Cookie') || '';
  const adminMatch = cookie.match(/pwd_admin=([^;]+)/);
  const devMatch = cookie.match(/pwd_developer=([^;]+)/);
  return {
    admin: !!adminMatch,
    developer: !!devMatch,
  };
}

async function handlePassword(request, env, subParams) {
  const action = subParams[0] || '';

  // 验证密码
  if (action === 'verify' && request.method === 'POST') {
    const body = await request.json();
    const { type, password } = body;
    if (!type || !password) return json({ error: '参数缺失' }, 400);
    const stored = await getPassword(env, type);
    if (password !== stored) return json({ error: '密码错误' }, 403);

    const token = makeSessionToken(type);
    const cookieName = `pwd_${type}`;
    return new Response(JSON.stringify({ ok: true, type }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
      },
    });
  }

  // 修改密码（需要已登录对应类型）
  if (action === 'update' && request.method === 'POST') {
    const body = await request.json();
    const { type, old_password, new_password } = body;
    if (!type || !new_password) return json({ error: '参数缺失' }, 400);
    const stored = await getPassword(env, type);
    if (old_password !== stored) return json({ error: '原密码错误' }, 403);
    await setPassword(env, type, new_password);
    return json({ ok: true, message: '密码已更新' });
  }

  // 检查密码会话状态
  if (action === 'status' && request.method === 'GET') {
    const session = getPasswordSession(request);
    return json(session);
  }

  // 登出
  if (action === 'logout' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const type = body.type || '';
    const cookieName = `pwd_${type}`;
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      },
    });
  }

  return json({ error: '未知操作' }, 404);
}

// --- 站点设置（KV 存储）---
const DEFAULT_SITE_SETTINGS = {
  favicon: '',
  title: 'WPS表格导入工具',
  logo_url: '',
  logo_size: '24',
  logo_text: 'WPS表格导入工具',
  logo_font: 'system-ui, -apple-system, sans-serif',
  logo_font_size: '16',
};

async function getSiteSettings(env) {
  const val = await env.SITE_KV.get('site_settings');
  if (!val) return DEFAULT_SITE_SETTINGS;
  try {
    return { ...DEFAULT_SITE_SETTINGS, ...JSON.parse(val) };
  } catch (e) {
    return DEFAULT_SITE_SETTINGS;
  }
}

async function handleSiteSettings(request, env) {
  if (request.method === 'GET') {
    return json(await getSiteSettings(env));
  }
  if (request.method === 'PUT') {
    const body = await request.json();
    const current = await getSiteSettings(env);
    const updated = { ...current };
    // 只更新提供的字段
    for (const key of Object.keys(DEFAULT_SITE_SETTINGS)) {
      if (body[key] !== undefined) updated[key] = body[key];
    }
    await env.SITE_KV.put('site_settings', JSON.stringify(updated));
    return json({ ok: true, settings: updated });
  }
  return json({ error: 'Method not allowed' }, 405);
}

async function handleWpsTest(request, env, subParams) {
  const userToken = getUserToken(request);
  const fileToken = subParams[0] || (await env.DB.prepare('SELECT target_file_token FROM table_types LIMIT 1').first())?.target_file_token;
  if (!fileToken) return json({ error: '未提供 file_token，也没有配置中的目标表格' }, 400);

  const fileId = parseFileToken(fileToken);

  // 测试1：租户token
  const tenantResult = await getValidAccessToken(env);
  let tenantRes = null;
  if (tenantResult.ok) {
    tenantRes = await wpsGetWorksheets(tenantResult.access_token, fileId);
  }

  // 测试2：用户token - 调用worksheets API
  let userRes = null;
  if (userToken) {
    userRes = await wpsGetWorksheets(userToken.token, fileId);
  }

  // 测试3：尝试用租户token 调金山文档的edit_token接口，看能不能拿到
  let editTokenInfo = null;
  if (tenantResult.ok) {
    try {
      const url = `${WPS_API_BASE}/api/v1/openapi/user/edit_token`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { ...wpsHeaders(tenantResult.access_token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId, type: 'read_write' }),
      });
      editTokenInfo = await resp.json();
    } catch (e) {
      editTokenInfo = { error: e.message };
    }
  }

  return json({
    file_id: fileId,
    logged_in: !!userToken,
    user_name: userToken?.name,
    user_token_prefix: userToken?.token?.substring(0, 20) + '...',
    tenant_token_ok: tenantResult.ok,
    tenant_api_response: tenantRes,
    user_api_response: userRes,
    edit_token_test: editTokenInfo,
  });
}

// --- 初始化数据库 ---
async function handleInitDb(env) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS shops (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS table_types (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER NOT NULL, name TEXT NOT NULL, source_file_token TEXT DEFAULT '', target_file_token TEXT DEFAULT '', target_sheet_idx INTEGER DEFAULT 0, start_col INTEGER DEFAULT 0, time_col INTEGER DEFAULT -1, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS sub_table_mappings (id INTEGER PRIMARY KEY AUTOINCREMENT, table_type_id INTEGER NOT NULL, source_sheet_idx INTEGER NOT NULL, source_sheet_name TEXT, created_at TEXT DEFAULT (datetime('now')), FOREIGN KEY (table_type_id) REFERENCES table_types(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS import_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER, table_type_id INTEGER, source_file_token TEXT, rows_imported INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', message TEXT, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
    `INSERT OR IGNORE INTO settings (key, value) VALUES ('app_id', '')`,
    `INSERT OR IGNORE INTO settings (key, value) VALUES ('app_key', '')`,
    `INSERT OR IGNORE INTO settings (key, value) VALUES ('access_token', '')`,
    `INSERT OR IGNORE INTO settings (key, value) VALUES ('token_expires_at', '')`,
  ];
  for (const stmt of statements) {
    await env.DB.prepare(stmt).run();
  }
  // 迁移：给已存在的 table_types 表添加 source_file_token 列（如果不存在）
  try {
    await env.DB.prepare('ALTER TABLE table_types ADD COLUMN source_file_token TEXT DEFAULT \'\'').run();
  } catch (e) {
    // 列已存在，忽略
  }
  // 迁移：添加 start_col 和 time_col 列
  try {
    await env.DB.prepare('ALTER TABLE table_types ADD COLUMN start_col INTEGER DEFAULT 0').run();
  } catch (e) {}
  try {
    await env.DB.prepare('ALTER TABLE table_types ADD COLUMN time_col INTEGER DEFAULT -1').run();
  } catch (e) {}
  // 迁移：添加 file_name_prefix 和 start_row 列
  try {
    await env.DB.prepare("ALTER TABLE table_types ADD COLUMN file_name_prefix TEXT DEFAULT ''").run();
  } catch (e) {}
  try {
    await env.DB.prepare('ALTER TABLE table_types ADD COLUMN start_row INTEGER DEFAULT -1').run();
  } catch (e) {}
  // 迁移：添加 source_start_row 和 source_start_col 列（源文件读取起始位置）
  try {
    await env.DB.prepare('ALTER TABLE table_types ADD COLUMN source_start_row INTEGER DEFAULT 0').run();
  } catch (e) {}
  try {
    await env.DB.prepare('ALTER TABLE table_types ADD COLUMN source_start_col INTEGER DEFAULT 0').run();
  } catch (e) {}
  return json({ ok: true, message: '数据库初始化成功' });
}

// ==================== 主路由 ====================

export async function onRequest(context) {
  const { request, env, params } = context;

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  // 检查 D1 绑定
  if (!env.DB) {
    return json({ error: '数据库未绑定，请先配置 D1 数据库。访问 /api/init-db 初始化。' }, 500);
  }

  const path = params.path || [];
  const route = path[0] || '';
  const subParams = path.slice(1);

  try {
    switch (route) {
      case 'settings': return await handleSettings(request, env);
      case 'auth': return await handleAuth(request, env, subParams);
      case 'wps-login': return await handleWpsLogin(request, env);
      case 'wps-callback': return await handleWpsCallback(request, env);
      case 'wps-logout': return await handleWpsLogout();
      case 'wps-user': return await handleWpsUser(request);
      case 'shops': return await handleShops(request, env, subParams);
      case 'table-types': return await handleTableTypes(request, env, subParams);
      case 'mappings': return await handleMappings(request, env, subParams);
      case 'sheets': return await handleSheets(request, env, subParams);
      case 'import': return await handleImport(request, env);
      case 'logs': return await handleLogs(request, env);
      case 'password': return await handlePassword(request, env, subParams);
      case 'site-settings': return await handleSiteSettings(request, env);
      case 'init-db': return await handleInitDb(env);
      case 'wps-test': return await handleWpsTest(request, env, subParams);
      default: return json({ error: `未知路由: /api/${route}` }, 404);
    }
  } catch (e) {
    console.error('API Error:', e);
    return json({ error: '服务器内部错误: ' + e.message }, 500);
  }
}
