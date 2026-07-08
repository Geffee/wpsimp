-- WPS导入工具 D1 数据库 Schema
-- 店铺表：管理不同店铺名称
CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 表格类型表：每个店铺下有多种表格类型（如销售表、库存表）
-- source_file_token: 源WPS在线表格的文档ID（配置时获取子表用）
-- target_file_token: 目标WPS在线表格的文档ID
-- target_sheet_idx: 目标表格中写入的子表索引（从0开始）
-- start_col: 数据写入的起始列（0-based，默认0=A列）
-- time_col: 导入时间写入的列（0-based，-1=不写入时间）
CREATE TABLE IF NOT EXISTS table_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  source_file_token TEXT DEFAULT '',
  target_file_token TEXT DEFAULT '',
  target_sheet_idx INTEGER DEFAULT 0,
  start_col INTEGER DEFAULT 0,
  time_col INTEGER DEFAULT -1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

-- 子表映射表：配置源表格的哪些子表需要导入
-- source_sheet_idx: 源表格中子表的索引（从0开始）
-- source_sheet_name: 源子表名称（用于展示）
CREATE TABLE IF NOT EXISTS sub_table_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_type_id INTEGER NOT NULL,
  source_sheet_idx INTEGER NOT NULL,
  source_sheet_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (table_type_id) REFERENCES table_types(id) ON DELETE CASCADE
);

-- 导入日志：记录每次导入操作
CREATE TABLE IF NOT EXISTS import_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER,
  table_type_id INTEGER,
  source_file_token TEXT,
  rows_imported INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  message TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 设置表：存储API凭证、token等配置
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- 初始化默认设置
INSERT OR IGNORE INTO settings (key, value) VALUES ('app_id', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('app_key', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('access_token', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('refresh_token', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('token_expires_at', '');
