#!/usr/bin/env node
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const os = require('node:os');

const DB_PATH = path.join(os.homedir(), '.nyan-mem', 'memory.db');
const db = new DatabaseSync(DB_PATH);

const args = process.argv.slice(2);
const command = args[0] || 'recent';

function printBox(title, rows) {
  console.log(`\n=== [ ${title.toUpperCase()} ] ===`);
  if (!rows || rows.length === 0) {
    console.log(' (Tidak ada data / Kosong)');
    return;
  }
  for (const r of rows) {
    console.log(`\n[#${r.id}] [${r.project || 'global'}] [${(r.category || 'general').toUpperCase()}] ${r.created_at || ''}`);
    if (r.target) console.log(`  Target : ${r.target}`);
    console.log(`  Teknis : ${r.technical_summary || r.raw_content}`);
    console.log(`  Awam   : ${r.layman_summary || '-'}`);
    if (r.tags) {
      try {
        const t = typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags;
        if (Array.isArray(t) && t.length) console.log(`  Tags   : [${t.join(', ')}]`);
      } catch {}
    }
  }
  console.log('\n=================================\n');
}

if (command === 'projects') {
  const rows = db.prepare(`SELECT COALESCE(project, 'global') as name, COUNT(*) as count FROM memories GROUP BY COALESCE(project, 'global') ORDER BY count DESC`).all();
  console.log('\n=== [ DAFTAR PROYEK ] ===');
  for (const r of rows) console.log(`  📁 ${r.name.padEnd(20)} (${r.count} entri)`);
  console.log('=========================\n');
  process.exit(0);
}

if (command === 'recent') {
  const limit = parseInt(args[1], 10) || 5;
  const project = args[2];
  let sql = 'SELECT id, COALESCE(project, \'global\') as project, category, target, technical_summary, layman_summary, tags, created_at FROM memories';
  const params = [];
  if (project && project !== 'all') {
    sql += ' WHERE (project = ? OR project = \'global\')';
    params.push(project);
  }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  printBox(`Memori Terbaru (${rows.length})`, rows);
  process.exit(0);
}

if (command === 'search') {
  const query = args.slice(1).join(' ').trim();
  if (!query) {
    console.log('Penggunaan: nyan search <kata kunci>');
    process.exit(1);
  }
  const clean = query.replace(/[^a-zA-Z0-9_\-\s]/g, ' ').trim();
  const rows = db.prepare(`
    SELECT m.id, COALESCE(m.project, 'global') as project, m.category, m.target, m.technical_summary, m.layman_summary, m.tags, m.created_at
    FROM memories_fts f
    JOIN memories m ON f.rowid = m.id
    WHERE memories_fts MATCH ?
    ORDER BY m.id DESC LIMIT 10
  `).all(clean);
  printBox(`Hasil Pencarian: "${query}" (${rows.length})`, rows);
  process.exit(0);
}

if (command === 'state' || command === 'todo') {
  const sub = args[1] || 'list';
  if (sub === 'list') {
    const project = args[2];
    let sql = 'SELECT key, value, status, COALESCE(project, \'global\') as project, updated_at FROM work_state';
    const params = [];
    if (project && project !== 'all') {
      sql += ' WHERE (project = ? OR project = \'global\')';
      params.push(project);
    }
    sql += ' ORDER BY updated_at DESC';
    const rows = db.prepare(sql).all(...params);
    console.log(`\n=== [ WORK STATE / TO-DO ] ===`);
    if (!rows.length) console.log(' (Tidak ada state aktif)');
    for (const r of rows) {
      console.log(`[${r.status.toUpperCase()}] [${r.project}] ${r.key} -> ${r.value} (${r.updated_at})`);
    }
    console.log('==============================\n');
  }
  process.exit(0);
}

console.log(`
Penggunaan nyan-mem CLI:
  node cli.cjs projects             - Lihat semua proyek terdaftar
  node cli.cjs recent [limit] [prj] - Lihat memori terbaru
  node cli.cjs search <kata-kunci>   - Cari memori lewat FTS5
  node cli.cjs todo list [prj]      - Lihat to-do list aktif
`);
