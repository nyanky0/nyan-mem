const http = require('node:http');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyan-mem-suite-'));
process.env.NYAN_MEM_DIR = testDir;
process.env.NYAN_MEM_PORT = '0';
const { startServer, closeDatabase } = require('./dashboard.cjs');

async function runTests() {
  const server = await startServer(0);
  const BASE_URL = `http://127.0.0.1:${server.address().port}`;
  console.log('🧪 Starting isolated nyan-mem test suite...\n');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}\n     ${err.stack || err.message}`);
      failed++;
    }
  }

  try {
    await test('GET / returns HTML dashboard', async () => {
      const res = await fetch(`${BASE_URL}/`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('nyan-mem'));
      assert.ok(text.includes('data-theme'));
    });

    await test('Settings API reads and writes isolated settings', async () => {
      const getRes = await fetch(`${BASE_URL}/api/settings`);
      assert.equal(getRes.status, 200);
      const settings = await getRes.json();
      assert.ok(settings.omniroute_url);
      assert.ok(settings.omniroute_key);
      const postRes = await fetch(`${BASE_URL}/api/settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ omniroute_model: 'only-groq' })
      });
      assert.equal(postRes.status, 200);
      assert.equal((await postRes.json()).success, true);
    });

    await test('DB backup created outside active DB', async () => {
      const res = await fetch(`${BASE_URL}/api/backup-db`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(fs.existsSync(data.backup_path));
    });

    await test('Projects CRUD and active switch', async () => {
      const pName = `test-prj-${Date.now()}`;
      let res = await fetch(`${BASE_URL}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: pName, description: 'Test project description', set_active: true }) });
      assert.equal(res.status, 200);
      res = await fetch(`${BASE_URL}/api/project/active`);
      assert.equal((await res.json()).active_project, pName);
      await fetch(`${BASE_URL}/api/project/active`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'global' }) });
      res = await fetch(`${BASE_URL}/api/projects`);
      assert.ok((await res.json()).projects.some(p => p.name === pName));
    });

    await test('Memory save and FTS search', async () => {
      const saveRes = await fetch(`${BASE_URL}/api/memories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'Verification test: modified test_auth_token in SecurityService.cs for token refresh', target: 'SecurityService.cs', category: 'bugfix', project: 'ibt-laravel' }) });
      assert.equal(saveRes.status, 200);
      const saved = await saveRes.json();
      assert.equal(saved.success, true);
      assert.ok(saved.technical_summary);
      assert.ok(saved.layman_summary);
      const searchData = await (await fetch(`${BASE_URL}/api/memories?project=ibt-laravel`)).json();
      assert.ok(searchData.memories.some(m => m.id === saved.id));
    });

    await test('Work-state CRUD', async () => {
      let res = await fetch(`${BASE_URL}/api/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'qa_check', value: 'Run test suite', status: 'doing', project: 'ibt-laravel' }) });
      assert.equal(res.status, 200);
      res = await fetch(`${BASE_URL}/api/state?project=ibt-laravel`);
      assert.ok((await res.json()).states.some(s => s.key === 'qa_check'));
      await fetch(`${BASE_URL}/api/state/qa_check`, { method: 'DELETE' });
    });

    await test('Project update, exports, deletion', async () => {
      const p = `test-settings-${Date.now()}`;
      const post = (url, body, method = 'POST') => fetch(`${BASE_URL}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal((await post('/api/projects', { name: p, description: 'Initial desc', path: 'C:\\test\\path' })).status, 200);
      assert.equal((await post(`/api/projects/${p}`, { description: 'Updated enterprise catalog', path: 'D:\\Metrodata\\IBT', model_override: 'only-groq' }, 'PUT')).status, 200);
      const list = await (await fetch(`${BASE_URL}/api/projects`)).json();
      const project = list.projects.find(x => x.name === p);
      assert.ok(project);
      assert.equal(project.description, 'Updated enterprise catalog');
      assert.equal((await fetch(`${BASE_URL}/api/projects/export?project=${p}&format=markdown`)).status, 200);
      assert.equal((await fetch(`${BASE_URL}/api/projects/export?project=${p}&format=json`)).status, 200);
      assert.equal((await fetch(`${BASE_URL}/api/projects/${p}`, { method: 'DELETE' })).status, 200);
    });

    await test('Review, Trash restore, expiry visibility, and Empty Trash', async () => {
      const saved = await (await fetch(`${BASE_URL}/api/memories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'Lifecycle isolated test item', target: 'fixture', category: 'decision', project: 'ibt-laravel' }) })).json();
      assert.equal(saved.success, true);
      let rows = (await (await fetch(`${BASE_URL}/api/memories?project=ibt-laravel`)).json()).memories;
      assert.equal(rows.find(m => m.id === saved.id).status, 'new');
      assert.equal((await fetch(`${BASE_URL}/api/memories/${saved.id}`, { method: 'DELETE' })).status, 200);
      rows = (await (await fetch(`${BASE_URL}/api/memories?project=ibt-laravel`)).json()).memories;
      assert.ok(!rows.some(m => m.id === saved.id));
      let trash = (await (await fetch(`${BASE_URL}/api/trash`)).json()).memories;
      assert.ok(trash.some(m => m.id === saved.id));
      assert.equal((await fetch(`${BASE_URL}/api/memories/${saved.id}/restore`, { method: 'POST' })).status, 200);
      rows = (await (await fetch(`${BASE_URL}/api/memories?project=ibt-laravel`)).json()).memories;
      assert.equal(rows.find(m => m.id === saved.id).status, 'approved');
      assert.equal((await fetch(`${BASE_URL}/api/memories/${saved.id}`, { method: 'DELETE' })).status, 200);
      const emptied = await (await fetch(`${BASE_URL}/api/trash/empty`, { method: 'POST' })).json();
      assert.equal(emptied.purged, 1);
      trash = (await (await fetch(`${BASE_URL}/api/trash`)).json()).memories;
      assert.ok(!trash.some(m => m.id === saved.id));
    });

    await test('Merge trashes source, keeps target, rejects invalid pairs', async () => {
      const save = async content => (await (await fetch(`${BASE_URL}/api/memories`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({content,target:'merge fixture',category:'decision',project:'ibt-laravel'}) })).json());
      const a = await save('merge candidate one');
      const b = await save('merge candidate two');
      let res = await fetch(`${BASE_URL}/api/memories/${a.id}/merge`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({source_id:b.id,expected_updated_at:a.updated_at||a.created_at}) });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).source_trashed, b.id);
      let trash = (await (await fetch(`${BASE_URL}/api/trash`)).json()).memories;
      assert.ok(trash.some(m => m.id === b.id));
      await fetch(`${BASE_URL}/api/memories/${b.id}/restore`, {method:'POST'});
      res = await fetch(`${BASE_URL}/api/memories/${a.id}/merge`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({source_id:a.id}) });
      assert.equal(res.status, 400);
    });

    await test('Merge provenance persists and project scope is enforced', async () => {
      const save = async project => (await (await fetch(`${BASE_URL}/api/memories`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({content:'merge provenance fixture '+Date.now(),target:'fixture',category:'decision',project}) })).json());
      const a=await save('ibt-laravel'), b=await save('ibt-laravel'), c=await save('sap-b1');
      const merged=await fetch(`${BASE_URL}/api/memories/${a.id}/merge`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source_id:b.id,expected_updated_at:a.updated_at||a.created_at})});
      assert.equal(merged.status,200);
      const db=new DatabaseSync(path.join(testDir,'memory.db'));
      assert.ok(db.prepare('SELECT 1 FROM memory_links WHERE parent_id=? AND source_id=? AND relation=?').get(a.id,b.id,'merge'));
      db.close();
      const cross=await fetch(`${BASE_URL}/api/memories/${a.id}/merge`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source_id:c.id,expected_updated_at:a.updated_at||a.created_at})});
      assert.equal(cross.status,409);
    });

    await test('MCP HTTP tools omit trashed memories and return recent approved records', async () => {
      const port = 37888;
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath,[path.join(__dirname,'server.cjs')],{env:{...process.env,NYAN_MEM_DIR:testDir,NYAN_MEM_PORT:String(port),NYAN_MEM_MCP_HTTP:'1'},stdio:'ignore'});
      try {
        let ready=false;for(let i=0;i<40;i++){try{const r=await fetch(`http://127.0.0.1:${port}/healthz`);if(r.ok){ready=true;break}}catch{} await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'isolated MCP server started');
        const r=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'mem_recent',arguments:{project:'ibt-laravel'}}})});assert.equal(r.status,200);const data=await r.json();assert.equal(data.error,undefined);
      } finally {child.kill();}
    });

    await test('Concurrent edit conflict returns current summary', async () => {
      const saved=await (await fetch(`${BASE_URL}/api/memories`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'conflict fixture',target:'fixture',category:'decision',project:'ibt-laravel'})})).json();
      const rows=await (await fetch(`${BASE_URL}/api/memories?project=ibt-laravel`)).json();
      const memory=rows.memories.find(m=>m.id===saved.id);
      const first=await fetch(`${BASE_URL}/api/memories/${saved.id}/edit`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({technical_summary:'first draft',expected_updated_at:memory.updated_at||memory.created_at})});assert.equal(first.status,200);
      const stale=await fetch(`${BASE_URL}/api/memories/${saved.id}/edit`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({technical_summary:'stale draft',expected_updated_at:memory.updated_at||memory.created_at})});assert.equal(stale.status,409);assert.equal((await stale.json()).latest.technical_summary,'first draft');
    });

    await test('Current endpoint /api/memories returns direct FTS and status filtering', async () => {
      const saved=await (await fetch(`${BASE_URL}/api/memories`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'fts trigger sentinel for QA',target:'fixture',category:'decision',project:'ibt-laravel'})})).json();
      let rows=await (await fetch(`${BASE_URL}/api/memories?q=sentinel&project=ibt-laravel`)).json();assert.ok(rows.memories.some(m=>m.id===saved.id));
      await fetch(`${BASE_URL}/api/memories/${saved.id}`,{method:'DELETE'});rows=await (await fetch(`${BASE_URL}/api/memories?q=sentinel&project=ibt-laravel`)).json();assert.ok(!rows.memories.some(m=>m.id===saved.id));
    });

    await test('Destination database setting redirects only isolated test server', async () => {
      const sub = path.join(testDir, 'destination');
      const res = await fetch(`${BASE_URL}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ db_path: sub }) });
      assert.equal(res.status, 200);
      assert.ok(fs.existsSync(path.join(sub, 'memory.db')));
      const db = new DatabaseSync(path.join(sub, 'memory.db'));
      assert.ok(db.prepare("SELECT name FROM projects WHERE name='global'").get());
      db.close();
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  console.log(`\n📊 Verification Summary: ${passed} Passed, ${failed} Failed`);
  if (failed) process.exitCode = 1;
}

runTests().catch(err => { console.error(err); process.exitCode = 1; });
