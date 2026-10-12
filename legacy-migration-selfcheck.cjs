const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyan-mem-legacy-'));
  const dbPath = path.join(dir, 'memory.db');
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE projects(name TEXT PRIMARY KEY, description TEXT, created_at TEXT); CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE memories(id INTEGER PRIMARY KEY AUTOINCREMENT,project TEXT,category TEXT,target TEXT,raw_content TEXT,technical_summary TEXT,layman_summary TEXT,tags TEXT,created_at TEXT); CREATE VIRTUAL TABLE memories_fts USING fts5(project,technical_summary,layman_summary,raw_content,tags,content='memories',content_rowid='id'); CREATE TABLE work_state(key TEXT PRIMARY KEY,value TEXT,status TEXT,project TEXT,updated_at TEXT); INSERT INTO projects VALUES('global','Global',datetime('now')); INSERT INTO projects VALUES('ibt-laravel','Project',datetime('now')); INSERT INTO memories(project,category,technical_summary,layman_summary,raw_content,tags,created_at) VALUES('ibt-laravel','decision','legacy unique token','legacy','legacy','[]',datetime('now')); INSERT INTO memories_fts(rowid,project,technical_summary,layman_summary,raw_content,tags) VALUES(1,'ibt-laravel','legacy unique token','legacy','legacy','[]');");
  db.close();
  const port = 64000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [path.join(__dirname, 'dashboard.cjs')], { env: { ...process.env, NYAN_MEM_DIR: dir, NYAN_MEM_PORT: String(port) }, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/memories?q=legacy&project=ibt-laravel`)).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 50)); }
    assert.ok(ready, 'legacy DB dashboard starts');
    let migrated = new DatabaseSync(dbPath);
    assert.equal(migrated.prepare('SELECT max(version) AS v FROM schema_migrations').get().v, 3);
    assert.equal(migrated.prepare('SELECT status FROM memories WHERE id=1').get().status, 'approved');
    assert.equal(migrated.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name='memories_au'").get().n, 1);
    migrated.close();
    const res = await fetch(`http://127.0.0.1:${port}/api/memories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'ibt-laravel', content: 'trigger follows row update', target: 'fixture', category: 'decision' }) });
    const saved = await res.json();
    assert.equal(saved.success, true);
    migrated = new DatabaseSync(dbPath);
    assert.equal(migrated.prepare("SELECT count(*) AS n FROM memories_fts WHERE memories_fts MATCH 'trigger' ").get().n, 1);
    migrated.close();
    console.log('PASS: Legacy migrations are transactional; old row preserved; FTS insert trigger works');
  } finally { child.kill(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
