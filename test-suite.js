const assert = require('node:assert');

const BASE_URL = 'http://localhost:37788';

async function runTests() {
  console.log('🧪 Starting nyan-mem Test & Verification Suite...\n');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    const start = performance.now();
    try {
      await fn();
      const duration = (performance.now() - start).toFixed(2);
      console.log(`  ✅ PASS: ${name} (${duration}ms)`);
      passed++;
    } catch (err) {
      const duration = (performance.now() - start).toFixed(2);
      console.error(`  ❌ FAIL: ${name} (${duration}ms)\n     ${err.message}`);
      failed++;
    }
  }

  // Test 1: Frontend Serving
  await test('GET / returns HTML dashboard', async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('nyan-mem Dashboard'), 'HTML contains nyan-mem branding');
    assert.ok(text.includes('data-theme'), 'HTML contains theme management');
  });

  // Test 2: Settings API
  await test('GET & POST /api/settings', async () => {
    const getRes = await fetch(`${BASE_URL}/api/settings`);
    assert.strictEqual(getRes.status, 200);
    const settings = await getRes.json();
    assert.ok(settings.omniroute_url, 'Has omniroute_url');
    assert.ok(settings.omniroute_key, 'Has omniroute_key');

    // Update test
    const postRes = await fetch(`${BASE_URL}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ omniroute_model: 'only-groq' })
    });
    assert.strictEqual(postRes.status, 200);
    const postData = await postRes.json();
    assert.strictEqual(postData.success, true);
  });

  // Test 3: Model Scanning
  await test('POST /api/scan-models scans OmniRoute models & combos', async () => {
    const res = await fetch(`${BASE_URL}/api/scan-models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.total > 0, `Scanned ${data.total} models`);
    assert.ok(data.combos.length > 0, 'Detected combos/routers');
    assert.ok(data.combos.includes('only-groq'), 'only-groq combo present');
  });

  // Test 4: Database Backup
  await test('GET /api/backup-db creates snapshot backup', async () => {
    const res = await fetch(`${BASE_URL}/api/backup-db`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.backup_path.includes('memory-backup'), 'Backup path formatted correctly');
  });

  // Test 5: Project Management & Scoping
  await test('Projects CRUD and Active Switch', async () => {
    // Create new project
    const pName = `test-prj-${Date.now()}`;
    const createRes = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: pName, description: 'Test project description', set_active: true })
    });
    assert.strictEqual(createRes.status, 200);

    // Verify active
    const activeRes = await fetch(`${BASE_URL}/api/project/active`);
    const activeData = await activeRes.json();
    assert.strictEqual(activeData.active_project, pName);

    // Switch back to ibt-laravel
    await fetch(`${BASE_URL}/api/project/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: 'ibt-laravel' })
    });
  });

  // Test 6: Memory Creation & FTS5 Search
  await test('Memory dual-distillation & FTS5 search', async () => {
    const saveRes = await fetch(`${BASE_URL}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Verification test: modified test_auth_token in SecurityService.cs for token refresh',
        target: 'SecurityService.cs',
        category: 'bugfix',
        project: 'ibt-laravel'
      })
    });
    assert.strictEqual(saveRes.status, 200);
    const saved = await saveRes.json();
    assert.strictEqual(saved.success, true);
    assert.ok(saved.technical_summary, 'Has technical_summary');
    assert.ok(saved.layman_summary, 'Has layman_summary');

    // Search for test_auth_token
    const searchRes = await fetch(`${BASE_URL}/api/memories?q=SecurityService&project=ibt-laravel`);
    const searchData = await searchRes.json();
    assert.ok(searchData.memories.length > 0, 'Found memory via FTS5');
  });

  // Test 7: Work State
  await test('Work State / To-Do CRUD', async () => {
    const postRes = await fetch(`${BASE_URL}/api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'qa_check', value: 'Run test suite', status: 'doing', project: 'ibt-laravel' })
    });
    assert.strictEqual(postRes.status, 200);

    const getRes = await fetch(`${BASE_URL}/api/state?project=ibt-laravel`);
    const getData = await getRes.json();
    const found = getData.states.find(s => s.key === 'qa_check');
    assert.ok(found, 'Work state saved and retrieved');

    // Cleanup
    await fetch(`${BASE_URL}/api/state/qa_check`, { method: 'DELETE' });
  });

  // Test 8: Project Settings (Update Metadata, Export Markdown/JSON, Delete with Reassignment)
  await test('Project Settings & Export/Delete lifecycle', async () => {
    const testPrj = `test-settings-${Date.now()}`;
    
    // 1. Create project
    const crRes = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: testPrj, description: 'Initial desc', path: 'C:\\test\\path' })
    });
    assert.strictEqual(crRes.status, 200);

    // 2. Update project settings (PUT)
    const putRes = await fetch(`${BASE_URL}/api/projects/${testPrj}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'Updated enterprise catalog',
        path: 'D:\\Metrodata\\IBT\\maul\\IBT-Laravel-React-Inertia.js-',
        model_override: 'only-groq'
      })
    });
    assert.strictEqual(putRes.status, 200);

    // Verify update reflected in GET /api/projects
    const listRes = await fetch(`${BASE_URL}/api/projects`);
    const listData = await listRes.json();
    const updatedPrj = listData.projects.find(p => p.name === testPrj);
    assert.ok(updatedPrj, 'Project found in list');
    assert.strictEqual(updatedPrj.description, 'Updated enterprise catalog');
    assert.strictEqual(updatedPrj.path, 'D:\\Metrodata\\IBT\\maul\\IBT-Laravel-React-Inertia.js-');
    assert.strictEqual(updatedPrj.model_override, 'only-groq');

    // 3. Export project (Markdown & JSON)
    const exportMdRes = await fetch(`${BASE_URL}/api/projects/export?project=${testPrj}&format=markdown`);
    assert.strictEqual(exportMdRes.status, 200);
    const mdText = await exportMdRes.text();
    assert.ok(mdText.includes(`nyan-mem Export: Proyek [${testPrj}]`), 'Markdown header contains project');

    const exportJsonRes = await fetch(`${BASE_URL}/api/projects/export?project=${testPrj}&format=json`);
    assert.strictEqual(exportJsonRes.status, 200);
    const jsonData = await exportJsonRes.json();
    assert.strictEqual(jsonData.project, testPrj);

    // 4. Delete project and check reassignment
    const delRes = await fetch(`${BASE_URL}/api/projects/${testPrj}`, { method: 'DELETE' });
    assert.strictEqual(delRes.status, 200);
    const delData = await delRes.json();
    assert.strictEqual(delData.success, true);

    // Verify it is removed from list
    const afterListRes = await fetch(`${BASE_URL}/api/projects`);
    const afterListData = await afterListRes.json();
    assert.strictEqual(afterListData.projects.some(p => p.name === testPrj), false);
  });

  // Test 9: Destination Folder Path & Auto-Create Empty DB
  await test('Destination folder path auto-creates memory.db if missing', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const tempDir = path.join(process.env.USERPROFILE || 'C:\\Users\\yudah', '.nyan-mem', 'temp-test-db-folder');
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });

    // Set destination pointing to a folder (not a file)
    const setRes = await fetch(`${BASE_URL}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ db_path: tempDir })
    });
    assert.strictEqual(setRes.status, 200);
    const setData = await setRes.json();
    assert.strictEqual(setData.success, true);
    assert.ok(setData.db_path.endsWith('memory.db'), 'Auto-appended memory.db to folder path');

    // Verify memory.db was automatically created and tables initialized
    const expectedDbFile = path.join(tempDir, 'memory.db');
    assert.ok(fs.existsSync(expectedDbFile), 'File memory.db exists in the new folder');

    // Verify empty projects & memories query against this new DB
    const prjRes = await fetch(`${BASE_URL}/api/projects`);
    const prjData = await prjRes.json();
    assert.ok(prjData.projects.length >= 1, 'Default global project created in empty DB');

    // Switch back to original DB
    const origDb = path.join(process.env.USERPROFILE || 'C:\\Users\\yudah', '.nyan-mem', 'memory.db');
    await fetch(`${BASE_URL}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ db_path: origDb })
    });

    // Cleanup temp dir
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  });

  console.log(`\n📊 Verification Summary: ${passed} Passed, ${failed} Failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
