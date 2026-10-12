const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

let DATA_DIR = process.env.NYAN_MEM_DIR || path.join(require('node:os').homedir(), '.nyan-mem');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let DB_PATH = path.join(DATA_DIR, 'memory.db');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.NYAN_MEM_PORT || 37788;

let db = new DatabaseSync(DB_PATH);

// Initialize schema
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (
      name TEXT PRIMARY KEY,
      description TEXT,
      path TEXT DEFAULT '',
      model_override TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT DEFAULT 'global',
      category TEXT,
      target TEXT,
      raw_content TEXT,
      technical_summary TEXT,
      layman_summary TEXT,
      tags TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      project,
      technical_summary,
      layman_summary,
      raw_content,
      tags,
      content='memories',
      content_rowid='id'
    );

    CREATE TABLE IF NOT EXISTS work_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      status TEXT,
      project TEXT DEFAULT 'global',
      updated_at TEXT
    );

    INSERT OR IGNORE INTO app_settings (key, value) VALUES ('active_project', 'global');
    INSERT OR IGNORE INTO app_settings (key, value) VALUES ('omniroute_url', 'http://localhost:20128/v1');
    INSERT OR IGNORE INTO app_settings (key, value) VALUES ('omniroute_key', 'sk-6451587ff6bf1027-26cf6a-20e04ac1');
    INSERT OR IGNORE INTO app_settings (key, value) VALUES ('omniroute_model', 'only-groq');
    INSERT OR IGNORE INTO app_settings (key, value) VALUES ('db_path', '${DB_PATH.replace(/\\/g, '\\\\')}');
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_links (
      parent_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      source_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      relation TEXT NOT NULL CHECK(relation IN ('merge','promotion')),
      created_at TEXT NOT NULL,
      PRIMARY KEY(parent_id, source_id, relation),
      CHECK(parent_id != source_id)
    );
  `);
  const hasColumn = (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
  const migrations = [
    [1, () => { if (!hasColumn('projects','path')) db.exec("ALTER TABLE projects ADD COLUMN path TEXT DEFAULT ''"); if (!hasColumn('projects','model_override')) db.exec("ALTER TABLE projects ADD COLUMN model_override TEXT DEFAULT ''"); if (!hasColumn('projects','updated_at')) db.exec("ALTER TABLE projects ADD COLUMN updated_at TEXT DEFAULT ''"); }],
    [2, () => { if (!hasColumn('memories','status')) db.exec("ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'"); if (!hasColumn('memories','deleted_at')) db.exec("ALTER TABLE memories ADD COLUMN deleted_at TEXT DEFAULT NULL"); }],
    [3, () => {
      if (!hasColumn('memories','updated_at')) db.exec("ALTER TABLE memories ADD COLUMN updated_at TEXT DEFAULT NULL");
      db.exec(`CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN INSERT INTO memories_fts(rowid,project,technical_summary,layman_summary,raw_content,tags) VALUES(new.id,new.project,new.technical_summary,new.layman_summary,new.raw_content,new.tags); END;
        CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN INSERT INTO memories_fts(memories_fts,rowid,project,technical_summary,layman_summary,raw_content,tags) VALUES('delete',old.id,old.project,old.technical_summary,old.layman_summary,old.raw_content,old.tags); END;
        CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN INSERT INTO memories_fts(memories_fts,rowid,project,technical_summary,layman_summary,raw_content,tags) VALUES('delete',old.id,old.project,old.technical_summary,old.layman_summary,old.raw_content,old.tags); INSERT INTO memories_fts(rowid,project,technical_summary,layman_summary,raw_content,tags) VALUES(new.id,new.project,new.technical_summary,new.layman_summary,new.raw_content,new.tags); END;
        INSERT INTO memories_fts(memories_fts) VALUES('rebuild');`);
    }]
  ];
  for (const [version, up] of migrations) {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try { up(); db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)').run(version,new Date().toISOString()); db.exec('COMMIT'); }
    catch (err) { db.exec('ROLLBACK'); throw err; }
  }

  db.exec(`
    INSERT OR IGNORE INTO projects (name, description, path, model_override, created_at, updated_at)
    VALUES ('global', 'Proyek default / catatan universal', '', '', datetime('now'), datetime('now'));
  `);
}

initDb();

function getSetting(k, fallback = '') {
  const r = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(k);
  return r ? r.value : fallback;
}

function setSetting(k, v) {
  db.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(k, String(v));
}

function cleanProject(p) {
  if (!p) return 'global';
  const c = String(p).trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '-');
  return c || 'global';
}

function getActiveProject() {
  return getSetting('active_project', 'global');
}

function setActiveProject(name) {
  const clean = cleanProject(name);
  db.prepare(`
    INSERT INTO projects (name, description, path, model_override, created_at, updated_at)
    VALUES (?, 'Project', '', '', datetime('now'), datetime('now'))
    ON CONFLICT(name) DO NOTHING
  `).run(clean);
  setSetting('active_project', clean);
  return clean;
}

async function processWithOmniRoute(rawContent, target, userCategory, project) {
  const baseUrl = getSetting('omniroute_url', 'http://localhost:20128/v1').replace(/\/+$/, '');
  const chatUrl = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  const apiKey = getSetting('omniroute_key', 'sk-6451587ff6bf1027-26cf6a-20e04ac1');

  // Check if project has model override
  let model = getSetting('omniroute_model', 'only-groq');
  if (project && project !== 'global') {
    const prjRow = db.prepare('SELECT model_override FROM projects WHERE name = ?').get(project);
    if (prjRow && prjRow.model_override) {
      model = prjRow.model_override;
    }
  }

  const systemPrompt = `Kamu adalah teknisi dokumentasi yang objektif, jujur, faktual, dan ANTI-LEBAY (anti-slop, zero-hyperbole).
Tugasmu merangkum informasi kejadian teknis menjadi DUA perspektif:
1. technical_summary: Ditujukan untuk AI & Software Engineer. Dingin, faktual, sebutkan file/baris/konfigurasi/error konkret. DILARANG menggunakan kata sifat bombastis (revolutionary, state-of-the-art, seamless, cutting-edge, robust, comprehensive). Jika perbaikan sepele (misal typo/ganti port), katakan apa adanya tanpa hiperbola.
2. layman_summary: Ditujukan untuk Orang Awam (manusia non-teknis). Gunakan bahasa Indonesia santai, jelas, 1-2 kalimat, mudah dipahami siapapun tanpa jargon membingungkan.
3. category: Pilih salah satu dari: bugfix, feature, config, refactor, decision, discovery, todo.
4. tags: Array 2-5 string kata kunci relevan.

Balas HANYA dengan JSON valid format:
{
  "category": "...",
  "technical_summary": "...",
  "layman_summary": "...",
  "tags": ["..."]
}`;

  const userMessage = `Input kejadian teknis:
${rawContent}
${project ? `Proyek: ${project}` : ''}
${target ? `Target file/komponen: ${target}` : ''}
${userCategory ? `Kategori usulan: ${userCategory}` : ''}`;

  try {
    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);
    return {
      category: parsed.category || userCategory || 'general',
      technical_summary: parsed.technical_summary || rawContent,
      layman_summary: parsed.layman_summary || rawContent,
      tags: Array.isArray(parsed.tags) ? parsed.tags : []
    };
  } catch (err) {
    return {
      category: userCategory || 'general',
      technical_summary: `[Raw Factual] ${rawContent}`,
      layman_summary: `[Catatan] ${rawContent}`,
      tags: [userCategory || 'note']
    };
  }
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  await handleDashboardRequest(req, res, new URL(req.url, `http://${req.headers.host || 'localhost'}`));
});

async function handleDashboardRequest(req, res, url) {
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // Serve Frontend
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(indexPath).pipe(res);
      return;
    }
  }

  // API: Get Settings
  if (req.method === 'GET' && pathname === '/api/settings') {
    sendJson(res, {
      omniroute_url: getSetting('omniroute_url', 'http://localhost:20128/v1'),
      omniroute_key: getSetting('omniroute_key', 'sk-6451587ff6bf1027-26cf6a-20e04ac1'),
      omniroute_model: getSetting('omniroute_model', 'only-groq'),
      db_path: getSetting('db_path', DB_PATH),
      active_project: getActiveProject()
    });
    return;
  }

  // API: Update Settings
  if (req.method === 'POST' && pathname === '/api/settings') {
    try {
      const b = await parseJsonBody(req);
      if (b.omniroute_url) setSetting('omniroute_url', b.omniroute_url);
      if (b.omniroute_key) setSetting('omniroute_key', b.omniroute_key);
      if (b.omniroute_model) setSetting('omniroute_model', b.omniroute_model);
      if (b.db_path && b.db_path !== DB_PATH) {
        let targetDbPath = b.db_path.trim();
        // If user selected or provided a folder path, place memory.db inside that folder
        try {
          if (fs.existsSync(targetDbPath) && fs.statSync(targetDbPath).isDirectory()) {
            targetDbPath = path.join(targetDbPath, 'memory.db');
          } else if (!targetDbPath.endsWith('.db')) {
            targetDbPath = path.join(targetDbPath, 'memory.db');
          }
        } catch (_) {}

        // Ensure parent directory exists
        const parentDir = path.dirname(targetDbPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }

        setSetting('db_path', targetDbPath);
        let oldDb = db;
        try {
          db = new DatabaseSync(targetDbPath);
          DB_PATH = targetDbPath;
          initDb(); // Auto-create schema and default global project if fresh DB
          oldDb.close();
        } catch (e) {
          try { db.close(); } catch (_) {}
          db = oldDb;
          throw new Error(`Gagal membuka atau membuat database di ${targetDbPath}: ${e.message}`);
        }
      }
      sendJson(res, { success: true, message: 'Settings saved successfully', db_path: DB_PATH });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
    return;
  }

  // API: Scan Models & Combos from endpoint
  if (req.method === 'POST' && pathname === '/api/scan-models') {
    try {
      const b = await parseJsonBody(req);
      const baseUrl = (b.url || getSetting('omniroute_url', 'http://localhost:20128/v1')).replace(/\/+$/, '');
      const apiKey = b.key || getSetting('omniroute_key', 'sk-6451587ff6bf1027-26cf6a-20e04ac1');
      const modelsUrl = baseUrl.endsWith('/models') ? baseUrl : `${baseUrl}/models`;

      const resp = await fetch(modelsUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000)
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }

      const data = await resp.json();
      const list = data.data || [];
      const combos = [];
      const regular = [];

      for (const m of list) {
        const id = m.id || m.name;
        if (!id) continue;
        if (id.startsWith('combo-') || id.startsWith('only-') || id.includes('router')) {
          combos.push(id);
        } else {
          regular.push(id);
        }
      }

      sendJson(res, {
        success: true,
        total: list.length,
        combos: combos.sort(),
        models: regular.slice(0, 100).sort()
      });
    } catch (err) {
      sendJson(res, { success: false, error: err.message }, 500);
    }
    return;
  }

  // API: Backup DB
  if (req.method === 'GET' && pathname === '/api/backup-db') {
    try {
      const backupDir = path.join(DATA_DIR, 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(backupDir, `memory-backup-${stamp}.db`);
      fs.copyFileSync(DB_PATH, backupFile);
      sendJson(res, { success: true, backup_path: backupFile });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
    return;
  }

  // API: Export Project Memories (JSON or Markdown)
  if (req.method === 'GET' && pathname === '/api/projects/export') {
    const prj = url.searchParams.get('project') || getActiveProject();
    const format = url.searchParams.get('format') || 'json';

    let sql = "SELECT id, project, category, target, technical_summary, layman_summary, tags, created_at, status, deleted_at FROM memories WHERE status != 'trash'";
    const params = [];
    if (prj && prj !== 'all') {
      sql += ' AND project = ?';
      params.push(prj);
    }
    sql += ' ORDER BY id DESC';
    const rows = db.prepare(sql).all(...params);

    if (format === 'markdown') {
      let md = `# nyan-mem Export: Proyek [${prj}]\nTanggal: ${new Date().toLocaleString()}\nTotal Catatan: ${rows.length}\n\n---\n\n`;
      for (const r of rows) {
        md += `### #${r.id} [${(r.category || 'general').toUpperCase()}] ${r.target ? `\`${r.target}\`` : ''}\n`;
        md += `*Tanggal: ${r.created_at}*\n\n`;
        md += `**🔬 AI / Technical Summary:**\n${r.technical_summary || r.raw_content}\n\n`;
        md += `**🌱 Bahasa Awam:**\n${r.layman_summary || '-'}\n\n`;
        md += `*Tags:* ${r.tags}\n\n---\n\n`;
      }
      res.writeHead(200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="nyan-mem-${prj}.md"`
      });
      res.end(md);
      return;
    }

    sendJson(res, {
      project: prj,
      total: rows.length,
      memories: rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }))
    });
    return;
  }

  // API: Get Active Project
  if (req.method === 'GET' && pathname === '/api/project/active') {
    sendJson(res, { active_project: getActiveProject() });
    return;
  }

  // API: Set Active Project
  if (req.method === 'POST' && pathname === '/api/project/active') {
    try {
      const body = await parseJsonBody(req);
      const active = setActiveProject(body.project);
      sendJson(res, { success: true, active_project: active });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
    return;
  }

  // API: List Projects with detailed metadata
  if (req.method === 'GET' && pathname === '/api/projects') {
    const active = getActiveProject();
    const pRows = db.prepare('SELECT name, description, path, model_override, created_at, updated_at FROM projects').all();
    const counts = db.prepare('SELECT COALESCE(project, \'global\') as name, COUNT(*) as count FROM memories GROUP BY COALESCE(project, \'global\')').all();
    const countMap = {};
    for (const c of counts) countMap[c.name] = c.count;

    const projects = pRows.map(p => ({
      name: p.name,
      description: p.description || '',
      path: p.path || '',
      model_override: p.model_override || '',
      count: countMap[p.name] || 0,
      is_active: p.name === active,
      created_at: p.created_at,
      updated_at: p.updated_at
    }));

    for (const c of counts) {
      if (!projects.some(p => p.name === c.name)) {
        projects.push({
          name: c.name,
          description: '',
          path: '',
          model_override: '',
          count: c.count,
          is_active: c.name === active
        });
      }
    }

    sendJson(res, { active_project: active, projects });
    return;
  }

  // API: Create New Project
  if (req.method === 'POST' && pathname === '/api/projects') {
    try {
      const body = await parseJsonBody(req);
      const name = cleanProject(body.name);
      const desc = body.description || '';
      const pPath = body.path || '';
      const modelOverride = body.model_override || '';
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO projects (name, description, path, model_override, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          description = excluded.description,
          path = excluded.path,
          model_override = excluded.model_override,
          updated_at = excluded.updated_at
      `).run(name, desc, pPath, modelOverride, now, now);

      if (body.set_active) {
        setActiveProject(name);
      }

      sendJson(res, { success: true, project: name, description: desc, path: pPath, model_override: modelOverride });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
    return;
  }

  // API: Update Existing Project (Settings for a project)
  if (req.method === 'PUT' && pathname.startsWith('/api/projects/')) {
    try {
      const pName = cleanProject(pathname.replace('/api/projects/', ''));
      const body = await parseJsonBody(req);
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE projects SET
          description = COALESCE(?, description),
          path = COALESCE(?, path),
          model_override = COALESCE(?, model_override),
          updated_at = ?
        WHERE name = ?
      `).run(body.description, body.path, body.model_override, now, pName);

      sendJson(res, { success: true, project: pName, message: `Project [${pName}] updated.` });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
    return;
  }

  // API: Delete Project
  if (req.method === 'DELETE' && pathname.startsWith('/api/projects/')) {
    try {
      const pName = cleanProject(pathname.replace('/api/projects/', ''));
      if (pName === 'global') {
        throw new Error('Proyek "global" adalah sistem inti dan tidak boleh dihapus.');
      }

      // Reassign memories of deleted project to 'global'
      db.prepare("UPDATE memories SET project = 'global' WHERE project = ?").run(pName);
      db.prepare("UPDATE memories SET project='global' WHERE id IN (SELECT source_id FROM memory_links WHERE relation='merge' AND parent_id IN (SELECT id FROM memories WHERE project='global')) AND id IN (SELECT id FROM memories WHERE project='global')").run();
      db.prepare("DELETE FROM memory_links WHERE parent_id NOT IN (SELECT id FROM memories) OR source_id NOT IN (SELECT id FROM memories)").run();
      db.prepare("UPDATE work_state SET project = 'global' WHERE project = ?").run(pName);
      db.prepare('DELETE FROM projects WHERE name = ?').run(pName);

      // If active was deleted, reset to global
      if (getActiveProject() === pName) {
        setActiveProject('global');
      }

      sendJson(res, { success: true, deleted: pName, message: `Project [${pName}] deleted. Memories reassigned to global.` });
    } catch (err) {
      sendJson(res, { error: err.message }, 400);
    }
    return;
  }

  // API: Get Memories
  if (req.method === 'GET' && pathname === '/api/memories') {
    const q = url.searchParams.get('q');
    const category = url.searchParams.get('category');
    const project = url.searchParams.get('project') || getActiveProject();
    const scopeAll = url.searchParams.get('all_projects') === 'true';
    const limit = Math.min(100,Math.max(1,parseInt(url.searchParams.get('limit') || '50', 10) || 50));
    const sort = url.searchParams.get('sort') === 'oldest' ? 'ASC' : 'DESC';

    let rows;
    if (q) {
      const cleanQ = q.replace(/[^a-zA-Z0-9_\-\s]/g, ' ').trim();
      let sql = `
        SELECT m.id, COALESCE(m.project, 'global') as project, m.category, m.target, m.technical_summary, m.layman_summary, m.tags, m.created_at, m.status, m.deleted_at, m.updated_at
        FROM memories_fts f
        JOIN memories m ON f.rowid = m.id
        WHERE memories_fts MATCH ?
          AND m.status != 'trash'
      `;
      const params = [cleanQ];
      if (category) {
        sql += ' AND m.category = ?';
        params.push(category);
      }
      if (!scopeAll && project && project !== 'all') {
        sql += ' AND (m.project = ? OR m.project = \'global\')';
        params.push(project);
      }
      sql += ` ORDER BY m.id ${sort} LIMIT ?`;
      params.push(limit);
      try {
        rows = db.prepare(sql).all(...params);
      } catch {
        rows = [];
      }
    } else {
      let sql = `
        SELECT id, COALESCE(project, 'global') as project, category, target, technical_summary, layman_summary, tags, created_at, status, deleted_at, updated_at
        FROM memories
      `;
      const where = [];
      const params = [];
      where.push("status != 'trash'");
      if (category) {
        where.push('category = ?');
        params.push(category);
      }
      if (!scopeAll && project && project !== 'all') {
        where.push('(project = ? OR project = \'global\')');
        params.push(project);
      }
      if (where.length) {
        sql += ' WHERE ' + where.join(' AND ');
      }
      sql += ` ORDER BY id ${sort} LIMIT ?`;
      params.push(limit);
      rows = db.prepare(sql).all(...params);
    }

    const memories = rows.map(r => ({
      ...r,
      tags: JSON.parse(r.tags || '[]')
    }));
    sendJson(res, { active_project: getActiveProject(), memories });
    return;
  }

  // API: Create Memory
  if (req.method === 'POST' && pathname === '/api/memories') {
    try {
      const body = await parseJsonBody(req);
      const rawContent = body.content || '';
      const target = body.target || '';
      const userCategory = body.category || '';
      const project = cleanProject(body.project || getActiveProject());
      const manualTags = Array.isArray(body.tags) ? body.tags : [];

      const distilled = await processWithOmniRoute(rawContent, target, userCategory, project);
      const finalTags = Array.from(new Set([...distilled.tags, ...manualTags]));
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO projects (name, description, created_at) VALUES (?, 'Project', datetime('now'))
        ON CONFLICT(name) DO NOTHING
      `).run(project);

      db.prepare(`
        INSERT INTO memories (project, category, target, raw_content, technical_summary, layman_summary, tags, created_at, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
      `).run(
        project,
        distilled.category,
        target,
        rawContent,
        distilled.technical_summary,
        distilled.layman_summary,
        JSON.stringify(finalTags),
        now,
        now
      );

      const lastId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
      sendJson(res, { success: true, id: lastId, project, updated_at: now, ...distilled, tags: finalTags });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/review') {
    const project=url.searchParams.get('project')||getActiveProject();
    const scopeAll=url.searchParams.get('all_projects')==='true';
    const rows=scopeAll?db.prepare("SELECT id,project,category,target,technical_summary,layman_summary,tags,created_at,updated_at,status FROM memories WHERE status='new' ORDER BY id DESC LIMIT 100").all():db.prepare("SELECT id,project,category,target,technical_summary,layman_summary,tags,created_at,updated_at,status FROM memories WHERE status='new' AND (project=? OR project='global') ORDER BY id DESC LIMIT 100").all(project);
    const approved=scopeAll?db.prepare("SELECT id,project,technical_summary FROM memories WHERE status!='trash'").all():db.prepare("SELECT id,project,technical_summary FROM memories WHERE status!='trash' AND (project=? OR project='global')").all(project);
    const exactDuplicate=m=>approved.find(a=>a.id!==m.id&&a.project===m.project&&String(a.technical_summary||'').trim().toLowerCase()===String(m.technical_summary||'').trim().toLowerCase())||null;
    const duplicateRows=rows.map(m=>({...m,duplicate_of:exactDuplicate(m)})).filter(m=>m.duplicate_of);
    const newRows=rows.filter(m=>!exactDuplicate(m));
    sendJson(res,{new_memories:newRows,duplicates:duplicateRows,needs_confirmation:[],counts:{new:newRows.length,duplicates:duplicateRows.length,needs_confirmation:0}});
    return;
  }

  if (req.method === 'GET' && pathname === '/api/trash') {
    const purgeExpired = db.prepare("DELETE FROM memories WHERE status = 'trash' AND deleted_at IS NOT NULL AND julianday(deleted_at) <= julianday('now', '-30 days')").run();
    if (purgeExpired.changes) db.prepare("DELETE FROM memory_links WHERE parent_id NOT IN (SELECT id FROM memories) OR source_id NOT IN (SELECT id FROM memories)").run();
    const rows = db.prepare("SELECT id, project, category, target, technical_summary, layman_summary, tags, created_at, deleted_at FROM memories WHERE status = 'trash' ORDER BY deleted_at DESC").all();
    sendJson(res,{memories:rows.map(r=>({...r,tags:JSON.parse(r.tags||'[]')}))});
    return;
  }
  if (req.method === 'POST' && pathname === '/api/trash/empty') {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = db.prepare("DELETE FROM memories WHERE status = 'trash'").run();
      db.prepare("DELETE FROM memory_links WHERE parent_id NOT IN (SELECT id FROM memories) OR source_id NOT IN (SELECT id FROM memories)").run();
      db.exec('COMMIT');
      sendJson(res, { success: true, purged: result.changes });
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/review/global-promotion') {
    const body=await parseJsonBody(req), ids=Array.isArray(body.source_ids)?[...new Set(body.source_ids.map(Number))]:[];
    const summary=typeof body.technical_summary==='string'?body.technical_summary.trim():'';
    if(ids.length<2||ids.length>20||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||!summary||summary.length>20000)return sendJson(res,{error:'At least two valid sources and a summary are required'},400);
    const sources=db.prepare(`SELECT id,project,status FROM memories WHERE id IN (${ids.map(()=>'?').join(',')}) AND status!='trash'`).all(...ids);
    if(sources.length!==ids.length||new Set(sources.map(s=>s.project)).size<2)return sendJson(res,{error:'Sources must exist in at least two projects'},409);
    const now=new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      const saved=db.prepare("INSERT INTO memories(project,category,target,raw_content,technical_summary,layman_summary,tags,created_at,status,updated_at) VALUES('global','decision','global promotion',? ,?,?,'[]',?,'new',?)").run(summary,summary,summary,now,now);
      const id=Number(saved.lastInsertRowid);
      for(const source of sources)db.prepare("INSERT INTO memory_links(parent_id,source_id,relation,created_at) VALUES(?,?,?,?)").run(id,source.id,'promotion',now);
      db.exec('COMMIT');sendJson(res,{success:true,id,source_ids:ids,project:'global',status:'new'});
    } catch(err){db.exec('ROLLBACK');throw err;}
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/memories/') && pathname.endsWith('/approve')) {
    const id = Number(pathname.split('/')[3]);
    if (!Number.isSafeInteger(id) || id <= 0) return sendJson(res, { error: 'Invalid ID' }, 400);
    const memory=db.prepare("SELECT project,status FROM memories WHERE id=? AND status!='trash'").get(id);
    if(!memory)return sendJson(res,{error:'Memory not found'},404);
    if(memory.project==='global'&&db.prepare("SELECT 1 FROM memory_links WHERE parent_id=? AND relation='promotion'").get(id)&&url.searchParams.get('confirm')!=='true')return sendJson(res,{error:'Global promotion requires explicit confirmation',confirmation_required:true},409);
    db.prepare("UPDATE memories SET status = 'approved', deleted_at = NULL WHERE id = ? AND status != 'trash'").run(id);
    sendJson(res, { success: true, id, status: 'approved' });
    return;
  }

  if (req.method === 'PATCH' && pathname.startsWith('/api/memories/') && pathname.endsWith('/edit')) {
    const id = Number(pathname.split('/')[3]);
    if (!Number.isSafeInteger(id) || id <= 0) return sendJson(res, { error: 'Invalid ID' }, 400);
    const body = await parseJsonBody(req);
    const summary = typeof body.technical_summary === 'string' ? body.technical_summary.trim() : '';
    if (!summary || summary.length > 20000) return sendJson(res, { error: 'A non-empty summary under 20,000 characters is required' }, 400);
      const expectedUpdatedAt = body.expected_updated_at;
    if (!expectedUpdatedAt || typeof expectedUpdatedAt !== 'string') return sendJson(res, { error: 'expected_updated_at is required' }, 400);
    const now = new Date().toISOString();
      const current = db.prepare('SELECT technical_summary,updated_at,created_at,project FROM memories WHERE id = ? AND status != \'trash\'').get(id);
      if (!current) return sendJson(res, { error: 'Memory not found' }, 404);
      if ((current.updated_at || current.created_at || '') !== expectedUpdatedAt) {
        const latest = db.prepare('SELECT id,technical_summary,updated_at,created_at FROM memories WHERE id=?').get(id);
        return sendJson(res,{error:'Edit conflict',latest},409);
      }
      const result = db.prepare("UPDATE memories SET technical_summary=?,updated_at=? WHERE id=? AND status!='trash' AND COALESCE(updated_at,created_at)=?").run(summary,now,id,expectedUpdatedAt);
      if (!result.changes) return sendJson(res,{error:'Edit conflict',latest:db.prepare('SELECT id,technical_summary,updated_at,created_at FROM memories WHERE id=?').get(id)},409);
    sendJson(res, { success: true, id, technical_summary: summary, updated_at: now });
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/memories/') && pathname.endsWith('/merge')) {
    const id = Number(pathname.split('/')[3]);
    if (!Number.isSafeInteger(id) || id <= 0) return sendJson(res, { error: 'Invalid ID' }, 400);
    const body = await parseJsonBody(req);
    const sourceId = Number(body.source_id);
    const expected = body.expected_updated_at;
    if (!Number.isSafeInteger(sourceId) || sourceId <= 0 || sourceId === id) return sendJson(res, { error: 'Invalid source ID' }, 400);
    if (!expected || typeof expected !== 'string') return sendJson(res,{error:'expected_updated_at is required'},400);
    const kept = db.prepare("SELECT id, project, status, updated_at, created_at FROM memories WHERE id = ? AND status != 'trash'").get(id);
    const source = db.prepare("SELECT id, project, status FROM memories WHERE id = ? AND status != 'trash'").get(sourceId);
    if (!kept || !source) return sendJson(res, { error: 'Memory not found' }, 404);
    if (kept.project !== source.project) return sendJson(res, { error: 'Cross-project merge is not supported' }, 409);
    if ((kept.updated_at || kept.created_at || '') !== expected) return sendJson(res,{error:'Edit conflict',latest:{id:kept.id,updated_at:kept.updated_at,created_at:kept.created_at}},409);
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE memories SET status = 'approved', deleted_at = NULL WHERE id = ?").run(id);
      db.prepare("UPDATE memories SET status = 'trash', deleted_at = ? WHERE id = ?").run(now, sourceId);
      db.prepare("INSERT OR IGNORE INTO memory_links(parent_id,source_id,relation,created_at) VALUES(?,?,?,?)").run(id,sourceId,'merge',now);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    sendJson(res, { success: true, kept: id, source_trashed: sourceId, retention_days: 30 });
    return;
  }

  if (req.method === 'POST' && pathname.startsWith('/api/memories/') && pathname.endsWith('/restore')) {
    const id = Number(pathname.split('/')[3]);
    if (!Number.isSafeInteger(id) || id <= 0) return sendJson(res, { error: 'Invalid ID' }, 400);
    const sourceProject = db.prepare("SELECT project FROM memories WHERE id=? AND status='trash'").get(id)?.project;
    const availableProject = sourceProject && db.prepare('SELECT 1 FROM projects WHERE name=?').get(sourceProject);
    const now = new Date().toISOString();
    const restoredProject = availableProject ? sourceProject : 'global';
    const result = db.prepare("UPDATE memories SET status='approved', deleted_at=NULL, project=?, updated_at=? WHERE id=? AND status='trash'").run(restoredProject,now,id);
    if (result.changes) {
      const parents = db.prepare("SELECT parent_id FROM memory_links WHERE source_id=? AND relation='merge'").all(id);
      if (parents.length) db.prepare("UPDATE memories SET project=? WHERE id=?").run(restoredProject,id);
    }
    sendJson(res, { success: true, id, status: 'approved', project: restoredProject, assignment_restored: Boolean(availableProject) });
    return;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/trash/')) {
    const id = Number(pathname.split('/').pop());
    if (!Number.isSafeInteger(id) || id <= 0) return sendJson(res, { error: 'Invalid ID' }, 400);
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = db.prepare("DELETE FROM memories WHERE id=? AND status='trash'").run(id);
      db.prepare('DELETE FROM memory_links WHERE parent_id=? OR source_id=?').run(id,id);
      db.exec('COMMIT');
      sendJson(res, { success:true, purged:result.changes ? id : null });
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    return;
  }

  // API: Move Memory to 30-day Trash
  if (req.method === 'DELETE' && pathname.startsWith('/api/memories/')) {
    const id = parseInt(pathname.split('/').pop(), 10);
    if (id) {
      db.prepare("UPDATE memories SET status = 'trash', deleted_at = ? WHERE id = ? AND status != 'trash'").run(new Date().toISOString(), id);
      sendJson(res, { success: true, trashed: id, retention_days: 30 });
    } else {
      sendJson(res, { error: 'Invalid ID' }, 400);
    }
    return;
  }

  // API: Stats
  if (req.method === 'GET' && pathname === '/api/stats') {
    const project = url.searchParams.get('project') || getActiveProject();
    const scopeAll = url.searchParams.get('all_projects') === 'true';

    let totalSql = 'SELECT COUNT(*) AS c FROM memories';
    let catSql = 'SELECT category, COUNT(*) as c FROM memories GROUP BY category';
    const params = [];

    if (!scopeAll && project && project !== 'all') {
      totalSql += ' WHERE (project = ? OR project = \'global\')';
      catSql = 'SELECT category, COUNT(*) as c FROM memories WHERE (project = ? OR project = \'global\') GROUP BY category';
      params.push(project);
    }

    const total = db.prepare(totalSql).get(...params).c;
    const catRows = db.prepare(catSql).all(...params);
    const byCategory = {};
    for (const r of catRows) byCategory[r.category] = r.c;
    sendJson(res, { active_project: getActiveProject(), total, by_category: byCategory });
    return;
  }

  // API: Work State
  if (req.method === 'GET' && pathname === '/api/state') {
    const project = url.searchParams.get('project') || getActiveProject();
    const scopeAll = url.searchParams.get('all_projects') === 'true';
    let sql = 'SELECT key, value, status, COALESCE(project, \'global\') as project, updated_at FROM work_state';
    const params = [];
    if (!scopeAll && project && project !== 'all') {
      sql += ' WHERE (project = ? OR project = \'global\')';
      params.push(project);
    }
    sql += ' ORDER BY updated_at DESC';
    const rows = db.prepare(sql).all(...params);
    sendJson(res, { active_project: getActiveProject(), states: rows });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/state') {
    try {
      const body = await parseJsonBody(req);
      const project = cleanProject(body.project || getActiveProject());
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO work_state (key, value, status, project, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          status = excluded.status,
          project = excluded.project,
          updated_at = excluded.updated_at
      `).run(body.key, body.value, body.status || 'todo', project, now);
      sendJson(res, { success: true, key: body.key, project });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
    return;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/state/')) {
    const key = decodeURIComponent(pathname.replace('/api/state/', ''));
    db.prepare('DELETE FROM work_state WHERE key = ?').run(key);
    sendJson(res, { success: true, key });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

function startServer(port = PORT, mcpHandler = null) {
  return new Promise((resolve, reject) => {
    const onRequest = async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      try {
        if (mcpHandler && await mcpHandler(req, res, url)) return;
        await handleDashboardRequest(req, res, url);
      } catch {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        if (!res.writableEnded) res.end('Internal Server Error');
      }
    };
    const server = http.createServer(onRequest);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      process.stderr.write(`[nyan-mem-web] Dashboard live at http://127.0.0.1:${server.address().port}\n`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer(PORT).catch(err => {
    process.stderr.write(`[nyan-mem-web] Failed to bind dashboard: ${err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { startServer, getActiveProject, setActiveProject, cleanProject, getSetting, setSetting, closeDatabase: () => db.close() };
