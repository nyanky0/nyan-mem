const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { startServer, getActiveProject, setActiveProject, cleanProject } = require('./dashboard.cjs');
const MCP_HTTP = process.env.NYAN_MEM_MCP_HTTP === '1';

// Configuration
const DATA_DIR = process.env.NYAN_MEM_DIR || path.join(require('node:os').homedir(), '.nyan-mem');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'memory.db');
const OMNIROUTE_URL = process.env.OMNIROUTE_URL || 'http://localhost:20128/v1/chat/completions';
const OMNIROUTE_KEY = process.env.OMNIROUTE_KEY || 'sk-6451587ff6bf1027-26cf6a-20e04ac1';
const OMNIROUTE_MODEL = process.env.OMNIROUTE_MODEL || 'only-groq';
const DASHBOARD_PORT = process.env.NYAN_MEM_PORT || 37788;

function log(...args) {
  process.stderr.write(`[nyan-mem] ${args.join(' ')}\n`);
}

// Start companion dashboard and unified MCP HTTP endpoint (Dashboard UI + MCP HTTP on port 37788).
const dashboardReady = startServer(DASHBOARD_PORT, handleMcpHttp);
dashboardReady.catch(e => {
  if (e.code === 'EADDRINUSE') {
    log(`Port ${DASHBOARD_PORT} already in use; companion dashboard already active on host.`);
  } else {
    log(`Failed to start dashboard/MCP HTTP: ${e.message}`);
  }
});

const db = new DatabaseSync(DB_PATH);

// Anti-slop prompt & call to OmniRoute
async function processWithOmniRoute(rawContent, target, userCategory, project) {
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
    const res = await fetch(OMNIROUTE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OMNIROUTE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OMNIROUTE_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) throw new Error(`OmniRoute error: ${res.status} ${res.statusText}`);
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
    log(`OmniRoute fallback (${err.message}). Using raw distillation.`);
    return {
      category: userCategory || 'general',
      technical_summary: `[Raw Factual] ${rawContent}`,
      layman_summary: `[Catatan] ${rawContent}`,
      tags: [userCategory || 'note']
    };
  }
}

// MCP Tools Definition
const TOOLS = [
  {
    name: 'mem_project_current',
    description: 'Cek proyek apa yang sedang aktif saat ini, jumlah memorinya, dan to-do list aktif.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'mem_project_switch',
    description: 'Pindah ke proyek lain (misal kembali ke proyek lama atau buat proyek baru) dan dapatkan briefing singkat statusnya.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Nama proyek tujuan (misal: ibt-laravel, sap-b1, dsb)' }
      },
      required: ['project']
    }
  },
  {
    name: 'mem_project_create',
    description: 'Daftarkan nama proyek baru secara eksplisit beserta deskripsinya.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nama proyek baru (huruf kecil, angka, tanda strip)' },
        description: { type: 'string', description: 'Deskripsi singkat tujuan proyek' },
        set_active: { type: 'boolean', description: 'Langsung setel sebagai proyek aktif? (default true)' }
      },
      required: ['name']
    }
  },
  {
    name: 'mem_save',
    description: 'Simpan catatan/memori baru dengan isolasi project dan verifikasi anti-slop (didistilasi otomatis untuk AI/Engineer dan Orang Awam via OmniRoute local).',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Kejadian atau perubahan teknis yang terjadi (faktual & jujur)' },
        project: { type: 'string', description: 'Nama proyek (opsional, jika kosong otomatis pakai proyek aktif)' },
        category: {
          type: 'string',
          enum: ['bugfix', 'feature', 'config', 'refactor', 'decision', 'discovery', 'todo'],
          description: 'Kategori entri'
        },
        target: { type: 'string', description: 'File atau komponen terkait (misal src/index.ts)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags tambahan' }
      },
      required: ['content']
    }
  },
  {
    name: 'mem_search',
    description: 'Cari memori berdasarkan kata kunci. Bisa mencari di proyek aktif saja, proyek lama tertentu, atau lintas semua proyek (project="all").',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Kata kunci pencarian' },
        project: { type: 'string', description: 'Filter project ("all" untuk lintas semua proyek, atau nama proyek tertentu)' },
        category: { type: 'string', description: 'Filter kategori opsional' },
        limit: { type: 'number', description: 'Jumlah maksimal hasil (default 10)' }
      },
      required: ['query']
    }
  },
  {
    name: 'mem_recent',
    description: 'Lihat daftar memori terbaru untuk konteks sesi (otomatis memprioritaskan proyek aktif).',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Filter project opsional ("all" untuk semua)' },
        limit: { type: 'number', description: 'Jumlah entri (default 10)' }
      }
    }
  },
  {
    name: 'mem_state_set',
    description: 'Simpan to-do list atau scratch state aktif yang terisolasi per project.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Kunci identifikasi state (misal: active_sprint, current_bug)' },
        value: { type: 'string', description: 'Deskripsi / isi state' },
        project: { type: 'string', description: 'Nama project (default: proyek aktif)' },
        status: { type: 'string', enum: ['todo', 'doing', 'done', 'dropped'], description: 'Status pengerjaan' }
      },
      required: ['key', 'value']
    }
  },
  {
    name: 'mem_state_get',
    description: 'Ambil daftar state atau to-do list aktif (otomatis difilter per proyek aktif).',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Filter project opsional ("all" untuk semua)' },
        status: { type: 'string', description: 'Filter status (todo, doing, done, all)' }
      }
    }
  },
  {
    name: 'mem_dashboard',
    description: 'Ambil URL web app visual dashboard untuk nyan-mem.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

// Tool Handlers
async function handleToolCall(name, args) {
  if (name === 'mem_dashboard') {
    const active = getActiveProject();
    return {
      url: `http://127.0.0.1:${DASHBOARD_PORT}`,
      active_project: active,
      status: 'running',
      message: `nyan-mem Web Dashboard aktif di http://localhost:${DASHBOARD_PORT} (Proyek aktif: ${active})`
    };
  }

  if (name === 'mem_project_current') {
    const active = getActiveProject();
    const count = db.prepare('SELECT COUNT(*) as c FROM memories WHERE project = ? OR project = \'global\'').get(active).c;
    const todos = db.prepare('SELECT key, value, status FROM work_state WHERE (project = ? OR project = \'global\') AND status != \'done\'').all(active);
    const allProjects = db.prepare('SELECT name, description FROM projects').all();

    return {
      active_project: active,
      project_memories_count: count,
      active_todos: todos,
      available_projects: allProjects
    };
  }

  if (name === 'mem_project_switch') {
    const targetProject = cleanProject(args.project);
    setActiveProject(targetProject);

    // Briefing
    const recent = db.prepare(`
      SELECT id, category, target, technical_summary, layman_summary, tags, created_at
      FROM memories
      WHERE project = ?
      ORDER BY id DESC LIMIT 3
    `).all(targetProject);

    const todos = db.prepare(`
      SELECT key, value, status FROM work_state
      WHERE project = ? AND status != 'done'
    `).all(targetProject);

    return {
      switched_to: targetProject,
      message: `Berhasil beralih ke proyek [${targetProject}]!`,
      recent_memories: recent.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') })),
      active_todos: todos
    };
  }

  if (name === 'mem_project_create') {
    const pName = cleanProject(args.name);
    const desc = args.description || '';
    const setActive = args.set_active !== false;

    db.prepare(`
      INSERT INTO projects (name, description, created_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(name) DO UPDATE SET description = excluded.description
    `).run(pName, desc);

    if (setActive) {
      setActiveProject(pName);
    }

    return {
      success: true,
      project: pName,
      is_active: setActive,
      description: desc,
      message: `Proyek [${pName}] berhasil dibuat${setActive ? ' dan dijadikan proyek aktif!' : '.'}`
    };
  }

  if (name === 'mem_save') {
    const rawContent = args.content || '';
    const target = args.target || '';
    const userCategory = args.category || '';
    const active = getActiveProject();
    const project = cleanProject(args.project || active);
    const manualTags = Array.isArray(args.tags) ? args.tags : [];

    const distilled = await processWithOmniRoute(rawContent, target, userCategory, project);
    const finalTags = Array.from(new Set([...distilled.tags, ...manualTags]));
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (name, description, created_at) VALUES (?, 'Project', datetime('now'))
      ON CONFLICT(name) DO NOTHING
    `).run(project);

    const stmt = db.prepare(`
      INSERT INTO memories (project, category, target, raw_content, technical_summary, layman_summary, tags, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      project,
      distilled.category,
      target,
      rawContent,
      distilled.technical_summary,
      distilled.layman_summary,
      JSON.stringify(finalTags),
      now
    );

    const lastId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

    return {
      success: true,
      id: lastId,
      project,
      category: distilled.category,
      technical_summary: distilled.technical_summary,
      layman_summary: distilled.layman_summary,
      tags: finalTags,
      dashboard_url: `http://127.0.0.1:${DASHBOARD_PORT}`,
      message: `Memory #${lastId} saved to project [${project}] (dual-distilled & anti-slop).`
    };
  }

  if (name === 'mem_search') {
    const query = (args.query || '').trim();
    const limit = args.limit || 10;
    const category = args.category;
    const active = getActiveProject();
    const project = args.project ? cleanProject(args.project) : active;

    if (!query) return { results: [] };

    const cleanQuery = query.replace(/[^a-zA-Z0-9_\-\s]/g, ' ').trim();
    if (!cleanQuery) return { results: [] };

    let sql = `
      SELECT m.id, COALESCE(m.project, 'global') as project, m.category, m.target, m.technical_summary, m.layman_summary, m.tags, m.created_at
      FROM memories_fts f
      JOIN memories m ON f.rowid = m.id
      WHERE memories_fts MATCH ?
    `;
    const params = [cleanQuery];

    if (category) {
      sql += ' AND m.category = ?';
      params.push(category);
    }
    if (project && project !== 'all') {
      sql += ' AND (m.project = ? OR m.project = \'global\')';
      params.push(project);
    }
    sql += ' ORDER BY m.id DESC LIMIT ?';
    params.push(limit);

    try {
      const rows = db.prepare(sql).all(...params);
      return {
        query: cleanQuery,
        project_scope: project,
        total: rows.length,
        results: rows.map(r => ({
          ...r,
          tags: JSON.parse(r.tags || '[]')
        }))
      };
    } catch {
      return { query: cleanQuery, total: 0, results: [] };
    }
  }

  if (name === 'mem_recent') {
    const limit = args.limit || 10;
    const active = getActiveProject();
    const project = args.project ? cleanProject(args.project) : active;

    let sql = 'SELECT id, COALESCE(project, \'global\') as project, category, target, technical_summary, layman_summary, tags, created_at FROM memories';
    const params = [];

    if (project && project !== 'all') {
      sql += ' WHERE (project = ? OR project = \'global\')';
      params.push(project);
    }
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    return {
      project_scope: project,
      total: rows.length,
      recent: rows.map(r => ({
        ...r,
        tags: JSON.parse(r.tags || '[]')
      }))
    };
  }

  if (name === 'mem_state_set') {
    const key = args.key;
    const value = args.value;
    const status = args.status || 'todo';
    const active = getActiveProject();
    const project = cleanProject(args.project || active);
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO work_state (key, value, status, project, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        status = excluded.status,
        project = excluded.project,
        updated_at = excluded.updated_at
    `).run(key, value, status, project, now);

    return { success: true, key, project, status, updated_at: now };
  }

  if (name === 'mem_state_get') {
    const status = args.status;
    const active = getActiveProject();
    const project = args.project ? cleanProject(args.project) : active;
    let sql = 'SELECT key, value, status, COALESCE(project, \'global\') as project, updated_at FROM work_state';
    const params = [];
    const where = [];

    if (status && status !== 'all') {
      where.push('status = ?');
      params.push(status);
    }
    if (project && project !== 'all') {
      where.push('(project = ? OR project = \'global\')');
      params.push(project);
    }

    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY updated_at DESC';

    const rows = db.prepare(sql).all(...params);
    return { project_scope: project, states: rows };
  }

  throw new Error(`Unknown tool: ${name}`);
}

function handleRpc(request) {
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') return { jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32600, message: 'Invalid Request' } };
  const { id, method, params = {} } = request;
  if (method === 'initialize') return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'nyan-mem', version: '1.1.0' } } };
  if (method === 'notifications/initialized') return null;
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  if (method === 'tools/call') {
    const args = params.arguments || {};
    if (args.project !== undefined && (typeof args.project !== 'string' || !args.project.trim() || args.project.length > 100)) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid project scope' } };
    if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100)) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid limit' } };
    if (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 2000)) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid query' } };
    if (args.content !== undefined && (typeof args.content !== 'string' || args.content.length > 50000)) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Invalid content' } };
    return Promise.resolve(handleToolCall(params.name, args)).then(result => ({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } }), err => ({ jsonrpc: '2.0', id, error: { code: -32000, message: String(err.message).slice(0, 500) } }));
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}
async function handleMcpHttp(req,res,url) {
 if(url.pathname==='/healthz'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"status":"ok"}');return true;}
 if(url.pathname!=='/mcp')return false;
 if(req.method!=='POST'){res.writeHead(405,{Allow:'POST'});res.end('Method Not Allowed');return true;}
 if(String(req.headers['content-type']||'').split(';')[0].trim()!=='application/json'){res.writeHead(415);res.end('Content-Type must be application/json');return true;}
 const chunks=[];let bytes=0;for await(const c of req){bytes+=c.length;if(bytes>1048576){res.writeHead(413);res.end('Request too large');return true;}chunks.push(c);}
 let data;try{data=JSON.parse(Buffer.concat(chunks).toString());}catch{res.writeHead(400);res.end(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}));return true;}
 const out=[];for(const item of Array.isArray(data)?data:[data]){if(item?.method==='notifications/initialized'||(item&&item.id===undefined&&typeof item.method==='string'))continue;const r=await handleRpc(item);if(r)out.push(r);}
 if(!out.length){res.writeHead(204);res.end();return true;}res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(Array.isArray(data)?out:out[0]));return true;
}

// JSON-RPC stdio handler
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

if (!MCP_HTTP) rl.on('line', async (line) => {
  line = line.trim();
  if (!line) return;

  let request;
  try {
    request = JSON.parse(line);
  } catch (err) {
    return;
  }

  const { id, method, params } = request;

  function sendResponse(result, error = null) {
    if (id === undefined || id === null) return;
    const resp = { jsonrpc: '2.0', id };
    if (error) {
      resp.error = error;
    } else {
      resp.result = result;
    }
    process.stdout.write(JSON.stringify(resp) + '\n');
  }

  try {
    if (method === 'initialize') {
      sendResponse({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'nyan-mem',
          version: '1.1.0'
        }
      });
      return;
    }

    if (method === 'notifications/initialized') return;
    if (method === 'ping') { sendResponse({}); return; }

    if (method === 'tools/list') {
      sendResponse({ tools: TOOLS });
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const resultData = await handleToolCall(toolName, toolArgs);
      sendResponse({
        content: [
          {
            type: 'text',
            text: JSON.stringify(resultData, null, 2)
          }
        ]
      });
      return;
    }

    sendResponse(null, { code: -32601, message: `Method not found: ${method}` });
  } catch (err) {
    sendResponse(null, { code: -32000, message: err.message });
  }
});

log(`nyan-mem MCP Server ready with companion Web Dashboard on http://localhost:${DASHBOARD_PORT}`);

module.exports = { handleMcpHttp, handleRpc, handleToolCall, TOOLS };
