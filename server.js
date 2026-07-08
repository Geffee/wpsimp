/**
 * 本地预览服务器 — 模拟 Cloudflare Pages Functions 后端
 * 用于本地测试和 CloudStudio 预览（不调用真实WPS API）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ==================== 模拟数据库 ====================
let nextId = 1;
const id = () => nextId++;

const db = {
  shops: [
    { id: 1, name: '示例店铺A', created_at: '2025-07-06 10:00:00' },
    { id: 2, name: '示例店铺B', created_at: '2025-07-06 10:01:00' },
  ],
  table_types: [
    { id: 1, shop_id: 1, name: '销售表', target_file_token: 'demo_target_token_001', target_sheet_idx: 0, created_at: '2025-07-06 10:02:00' },
    { id: 2, shop_id: 1, name: '库存表', target_file_token: 'demo_target_token_002', target_sheet_idx: 0, created_at: '2025-07-06 10:03:00' },
    { id: 3, shop_id: 2, name: '销售表', target_file_token: 'demo_target_token_003', target_sheet_idx: 0, created_at: '2025-07-06 10:04:00' },
  ],
  sub_table_mappings: [
    { id: 1, table_type_id: 1, source_sheet_idx: 0, source_sheet_name: '销售数据', created_at: '2025-07-06 10:05:00' },
    { id: 2, table_type_id: 2, source_sheet_idx: 1, source_sheet_name: '库存数据', created_at: '2025-07-06 10:06:00' },
    { id: 3, table_type_id: 3, source_sheet_idx: 0, source_sheet_name: '销售数据', created_at: '2025-07-06 10:07:00' },
  ],
  import_logs: [
    { id: 1, shop_id: 1, table_type_id: 1, source_file_token: 'demo_source_001', rows_imported: 42, status: 'success', message: '导入42行', created_at: '2025-07-06 11:00:00', shop_name: '示例店铺A', table_type_name: '销售表' },
    { id: 2, shop_id: 1, table_type_id: 2, source_file_token: 'demo_source_001', rows_imported: 18, status: 'success', message: '导入18行', created_at: '2025-07-06 11:00:01', shop_name: '示例店铺A', table_type_name: '库存表' },
  ],
  settings: {
    app_id: 'demo_app_id',
    app_key: 'demo_app_key_****',
    app_key_configured: true,
    access_token: 'demo_token',
    token_valid: true,
    token_expires_at: String(Date.now() + 86400000),
  },
};
nextId = 100;

// ==================== 工具函数 ====================
const json = (data, status = 200) => ({
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(data),
});

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveStatic(req, res) {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';
  const filePath = path.join(PUBLIC_DIR, url);
  if (!filePath.startsWith(PUBLIC_DIR)) return false;
  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

function parseBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
  });
}

// ==================== API 路由 ====================
async function handleApi(req, res, url) {
  const method = req.method;
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'shops', ...]
  const route = parts[1] || '';
  const sub = parts.slice(2);
  const q = url.searchParams;

  // 设置
  if (route === 'settings') {
    if (method === 'GET') return json(db.settings);
    if (method === 'PUT') {
      const body = await parseBody(req);
      if (body.app_id !== undefined) db.settings.app_id = body.app_id;
      if (body.app_key !== undefined) { db.settings.app_key = body.app_key.slice(0,4)+'****'; db.settings.app_key_configured = true; }
      return json({ ok: true, message: '设置已保存' });
    }
  }

  // 认证
  if (route === 'auth') {
    if (sub[0] === 'url' && method === 'GET') return json({ auth_url: 'https://developer.kdocs.cn/h5/auth?app_id=' + db.settings.app_id + '&scope=demo' });
    if (sub[0] === 'status' && method === 'GET') return json({ authorized: true, access_token: 'demo_token', error: null });
    if (sub[0] === 'refresh' && method === 'POST') return json({ ok: true, message: 'token已刷新（演示）' });
    if (sub[0] === 'callback') {
      res.writeHead(302, { Location: '/#/import?auth=success' });
      return { status: 302, direct: true, res };
    }
  }

  // 店铺
  if (route === 'shops') {
    if (method === 'GET') return json(db.shops);
    if (method === 'POST') {
      const body = await parseBody(req);
      if (db.shops.some(s => s.name === body.name)) return json({ error: '店铺名称已存在' }, 400);
      const shop = { id: id(), name: body.name, created_at: new Date().toISOString().replace('T',' ').slice(0,19) };
      db.shops.push(shop);
      return json(shop, 201);
    }
    if (method === 'PUT' && sub[0]) {
      const body = await parseBody(req);
      const shop = db.shops.find(s => s.id == sub[0]);
      if (!shop) return json({ error: '未找到' }, 404);
      shop.name = body.name;
      return json({ ok: true });
    }
    if (method === 'DELETE' && sub[0]) {
      db.shops = db.shops.filter(s => s.id != sub[0]);
      db.table_types = db.table_types.filter(t => t.shop_id != sub[0]);
      return json({ ok: true });
    }
  }

  // 表格类型
  if (route === 'table-types') {
    if (method === 'GET') {
      const shopId = q.get('shop_id');
      let types = shopId ? db.table_types.filter(t => t.shop_id == shopId) : db.table_types;
      return json(types);
    }
    if (method === 'POST') {
      const body = await parseBody(req);
      const tt = { id: id(), shop_id: body.shop_id, name: body.name, target_file_token: body.target_file_token || '', target_sheet_idx: body.target_sheet_idx || 0, created_at: new Date().toISOString().replace('T',' ').slice(0,19) };
      db.table_types.push(tt);
      return json(tt, 201);
    }
    if (method === 'PUT' && sub[0]) {
      const body = await parseBody(req);
      const tt = db.table_types.find(t => t.id == sub[0]);
      if (!tt) return json({ error: '未找到' }, 404);
      tt.name = body.name; tt.target_file_token = body.target_file_token; tt.target_sheet_idx = body.target_sheet_idx;
      return json({ ok: true });
    }
    if (method === 'DELETE' && sub[0]) {
      db.table_types = db.table_types.filter(t => t.id != sub[0]);
      db.sub_table_mappings = db.sub_table_mappings.filter(m => m.table_type_id != sub[0]);
      return json({ ok: true });
    }
  }

  // 子表映射
  if (route === 'mappings') {
    if (method === 'GET') {
      const ttId = q.get('table_type_id');
      let mappings = ttId ? db.sub_table_mappings.filter(m => m.table_type_id == ttId) : db.sub_table_mappings;
      return json(mappings);
    }
    if (method === 'POST') {
      const body = await parseBody(req);
      const m = { id: id(), table_type_id: body.table_type_id, source_sheet_idx: body.source_sheet_idx, source_sheet_name: body.source_sheet_name || '', created_at: new Date().toISOString().replace('T',' ').slice(0,19) };
      db.sub_table_mappings.push(m);
      return json(m, 201);
    }
    if (method === 'DELETE' && sub[0]) {
      db.sub_table_mappings = db.sub_table_mappings.filter(m => m.id != sub[0]);
      return json({ ok: true });
    }
  }

  // 表格操作（模拟）
  if (route === 'sheets') {
    if (sub[0] === 'list' && method === 'GET') {
      return json({
        file_token: q.get('file_token') || 'demo_token',
        sheets: [
          { sheet_idx: 0, sheet_name: '销售数据', visible: true },
          { sheet_idx: 1, sheet_name: '库存数据', visible: true },
          { sheet_idx: 2, sheet_name: '订单明细', visible: true },
        ],
      });
    }
    if (sub[0] === 'preview' && method === 'GET') {
      const idx = parseInt(q.get('sheet_idx') || '0');
      const headers = ['日期', '商品名称', '数量', '单价', '金额'];
      const dataRows = [];
      const products = ['商品A', '商品B', '商品C', '商品D', '商品E'];
      for (let i = 0; i < 15; i++) {
        const qty = Math.floor(Math.random() * 100) + 1;
        const price = Math.floor(Math.random() * 200) + 10;
        dataRows.push([
          `2025-07-${String(i+1).padStart(2,'0')}`,
          products[i % products.length],
          String(qty),
          String(price),
          String(qty * price),
        ]);
      }
      return json({ file_token: q.get('file_token') || 'demo', sheet_idx: idx, headers, dataRows, totalRows: dataRows.length + 1 });
    }
  }

  // 导入（模拟）
  if (route === 'import' && method === 'POST') {
    const body = await parseBody(req);
    const shopId = body.shop_id;
    const types = db.table_types.filter(t => t.shop_id == shopId);
    const results = [];
    for (const tt of types) {
      const mappings = db.sub_table_mappings.filter(m => m.table_type_id == tt.id);
      if (mappings.length === 0 || !tt.target_file_token) {
        results.push({ table_type: tt.name, status: 'skipped', message: '未配置子表映射或目标表格' });
        continue;
      }
      const rows = Math.floor(Math.random() * 50) + 10;
      results.push({ table_type: tt.name, sheet: mappings[0].source_sheet_name, status: 'success', rows_imported: rows });
      db.import_logs.unshift({
        id: id(), shop_id: shopId, table_type_id: tt.id, source_file_token: body.source_file_token || 'demo',
        rows_imported: rows, status: 'success', message: `导入${rows}行`,
        created_at: new Date().toISOString().replace('T',' ').slice(0,19),
        shop_name: db.shops.find(s => s.id == shopId)?.name || '-',
        table_type_name: tt.name,
      });
    }
    return json({ ok: true, results });
  }

  // 日志
  if (route === 'logs' && method === 'GET') {
    return json(db.import_logs.slice(0, 50));
  }

  // 初始化数据库
  if (route === 'init-db' && method === 'GET') {
    return json({ ok: true, message: '数据库初始化成功（演示模式已预置数据）' });
  }

  return json({ error: `未知路由: /api/${route}` }, 404);
}

// ==================== 服务器 ====================
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API 请求
  if (url.pathname.startsWith('/api/')) {
    const result = await handleApi(req, res, url);
    if (result?.direct) return;
    if (result) {
      res.writeHead(result.status, result.headers);
      res.end(result.body);
      return;
    }
  }

  // 静态文件
  if (serveStatic(req, res)) return;

  // SPA 回退
  try {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`WPS表格导入工具（演示模式）已启动: http://localhost:${PORT}`);
  console.log('这是模拟服务器，WPS API调用返回演示数据。');
  console.log('要使用真实功能，请部署到 Cloudflare Pages。');
});
