const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

(async () => {
  const dir = path.join(os.tmpdir(), 'nyan-mem-lifecycle-isolated');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'memory.db');
  spawnSync('python', ['-c', "import shutil; shutil.copy2(r'C:\\Users\\yudah\\.nyan-mem\\memory.db',r'C:\\Users\\yudah\\AppData\\Local\\Temp\\nyan-mem-lifecycle-isolated\\memory.db')"], { stdio: 'inherit' });
  process.env.NYAN_MEM_DIR = dir;
  const { startServer } = require('./dashboard.cjs');
  const db = new DatabaseSync(dbPath);
  let server;
  try {
    db.prepare("UPDATE app_settings SET value='global' WHERE key='active_project'").run();
    db.prepare("UPDATE app_settings SET value=? WHERE key='db_path'").run(dbPath);
    db.prepare("UPDATE memories SET status='new' WHERE id=(SELECT MIN(id) FROM memories)").run();
    server = await startServer(37889);
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (p, method = 'GET') => {
      const response = await fetch(base + p, { method });
      if (!response.ok) throw new Error(`${method} ${p}: HTTP ${response.status}`);
      return response.json();
    };
    let rows = (await request('/api/memories?all_projects=true&limit=100')).memories;
    const pending = rows.find(x => x.status === 'new');
    if (!pending) throw new Error('seeded pending record missing');
    if ((await request(`/api/memories/${pending.id}`, 'DELETE')).trashed !== pending.id) throw new Error('soft-delete failed');
    rows = (await request('/api/memories?all_projects=true&limit=100')).memories;
    if (rows.some(x => x.id === pending.id)) throw new Error('trashed memory remains in regular list');
    if (!(await request('/api/trash')).memories.some(x => x.id === pending.id)) throw new Error('trash listing missing record');
    if ((await request(`/api/memories/${pending.id}/restore`, 'POST')).status !== 'approved') throw new Error('restore failed');
    if ((await request('/api/trash')).memories.some(x => x.id === pending.id)) throw new Error('restored record still in trash');
    if ((await request(`/api/memories/${pending.id}/approve`, 'POST')).status !== 'approved') throw new Error('approval failed');
    if (!(await request(`/api/memories/${pending.id}`, 'DELETE')).trashed) throw new Error('second trash failed');
    if ((await request(`/api/trash/${pending.id}`, 'DELETE')).purged !== pending.id) throw new Error('purge failed');
    if (db.prepare('SELECT 1 FROM memories WHERE id=?').get(pending.id)) throw new Error('purge left row behind');
    console.log('PASS: Trash, hidden listing, restore, approval, and permanent purge');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db.close();
  }
})();
