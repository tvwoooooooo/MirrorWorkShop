// lib/d1.js
/**
 * D1 数据库表初始化工具
 * 集中管理所有表的创建和结构更新
 */

/**
 * 确保 tokens 表存在，并包含 round_used 列
 */
export async function ensureTokensTable(env) {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            username TEXT,
            token TEXT NOT NULL,
            usage_count INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            round_used INTEGER DEFAULT -1,
            UNIQUE(type, name)
        )
    `).run();
}

/**
 * 确保 token_round 表存在
 */
export async function ensureTokenRoundTable(env) {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS token_round (
            type TEXT PRIMARY KEY,
            round INTEGER NOT NULL
        )
    `).run();
}

/**
 * 确保 master_tasks 表存在
 */
export async function ensureMasterTasksTable(env) {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS master_tasks (
            task_id TEXT PRIMARY KEY,
            owner TEXT NOT NULL,
            repo TEXT NOT NULL,
            bucket_id TEXT NOT NULL,
            total_files INTEGER DEFAULT 0,
            total_file_batches INTEGER DEFAULT 0,
            completed_file_batches TEXT,
            processed_files INTEGER DEFAULT 0,
            failed_files TEXT,
            total_assets INTEGER DEFAULT 0,
            total_asset_batches INTEGER DEFAULT 0,
            completed_asset_batches TEXT,
            processed_assets INTEGER DEFAULT 0,
            failed_assets TEXT,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER,
            completed_at INTEGER
        )
    `).run();
}

/**
 * 确保 active_tasks 表存在
 */
export async function ensureActiveTasksTable(env) {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS active_tasks (
            task_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL
        )
    `).run();
}

/**
 * 确保 projects 表存在
 */
export async function ensureProjectsTable(env) {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            homepage TEXT NOT NULL,
            last_update TEXT,
            versions TEXT,
            UNIQUE(type, name)
        )
    `).run();
}

/**
 * 确保 buckets 表存在
 */
export async function ensureBucketsTable(env) {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS buckets (
            id TEXT PRIMARY KEY,
            custom_name TEXT NOT NULL,
            key_id TEXT NOT NULL,
            application_key TEXT NOT NULL,
            bucket_name TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            snippet_id TEXT,
            usage REAL DEFAULT 0,
            total REAL DEFAULT 10
        )
    `).run();
}

/**
 * 确保 config 表存在
 */
export async function ensureConfigTable(env) {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `).run();
}