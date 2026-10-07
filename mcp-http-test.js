const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyan-mem-http-'));
const port = 39000 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, [path.join(__dirname, 'server.cjs')], {
  env: { ...process.env, NYAN_MEM_DIR: dir, NYAN_MEM_PORT: String(port), NYAN_MEM_MCP_HTTP: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
let readyResolve;
const ready = new Promise(resolve => { readyResolve = resolve; });
child.stderr.on('data', data => { output += data.toString(); if (output.includes('Dashboard live at')) readyResolve(); });

function request(method, body, headers = {}, path = '/mcp') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function waitReady() {
  await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error(`server did not start: ${output}`)), 15000))]);
}

async function rpc(method, params = {}, id = 1) {
  const res = await request('POST', JSON.stringify({ jsonrpc: '2.0', id, method, params }), { 'content-type': 'application/json', accept: 'application/json, text/event-stream' });
  assert.equal(res.status, 200, res.body);
  return JSON.parse(res.body);
}

(async () => {
  try {
    await waitReady();
    const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.serverInfo.name, 'nyan-mem');
    assert.deepEqual((await rpc('ping')).result, {});
    assert.equal((await rpc('tools/list')).result.tools.length, 9);
    const dashboard = await request('GET', undefined, {}, '/');
    assert.equal(dashboard.status, 200);
    assert.match(dashboard.body, /nyan-mem Dashboard/);

    const save = async (project, content) => rpc('tools/call', { name: 'mem_save', arguments: { project, content, category: 'discovery', target: 'mcp-http-test' } });
    const parseTool = result => JSON.parse(result.result.content[0].text);
    await save('shared-test', 'Shared moonstone protocol fact');
    await save('global', 'Global moonstone convention');
    const rows = parseTool(await rpc('tools/call', { name: 'mem_recent', arguments: { project: 'shared-test', limit: 20 } } ) );
    assert.equal(rows.recent.filter(row => row.project === 'shared-test').length, 1);
    assert.equal(rows.recent.filter(row => row.project === 'global').length, 1);
    const otherRows = parseTool(await rpc('tools/call', { name: 'mem_recent', arguments: { project: 'other-test', limit: 20 } } ) );
    assert.equal(otherRows.recent.some(row => row.project === 'shared-test'), false);
    const allRows = parseTool(await rpc('tools/call', { name: 'mem_recent', arguments: { project: 'all', limit: 20 } } ) );
        assert.equal(allRows.recent.filter(row => row.project === 'shared-test').length, 1);
        await rpc('tools/call', { name: 'mem_state_set', arguments: { project: 'shared-test', key: 'shared-state', value: 'in progress', status: 'doing' } });
        const stateRows = parseTool(await rpc('tools/call', { name: 'mem_state_get', arguments: { project: 'shared-test' } } ) );
        assert.equal(stateRows.states.some(row => row.key === 'shared-state' && row.project === 'shared-test'), true);
        await rpc('tools/call', { name: 'mem_project_switch', arguments: { project: 'other-test' } });
        const stableScope = parseTool(await rpc('tools/call', { name: 'mem_recent', arguments: { project: 'shared-test', limit: 20 } } ) );
        assert.equal(stableScope.recent.filter(row => row.project === 'shared-test').length, 1);

    const writes = await Promise.all(Array.from({ length: 8 }, (_, i) => save('shared-test', `parallel fact ${i} quartz`)));
    assert.equal(writes.length, 8);
    const concurrentRows = parseTool(await rpc('tools/call', { name: 'mem_recent', arguments: { project: 'shared-test', limit: 30 } } ) );
    assert.equal(concurrentRows.recent.filter(row => row.project === 'shared-test').length, 9);

    const malformed = await request('POST', '{', { 'content-type': 'application/json' });
    assert.equal(malformed.status, 400);
    assert.doesNotMatch(malformed.body, /at .*server\.cjs/);
    assert.equal((await request('GET')).status, 405);
    const oversized = await request('POST', ' '.repeat(1024 * 1024 + 1), { 'content-type': 'application/json' });
    assert.equal(oversized.status, 413);
    const method = await rpc('unexpected');
    assert.equal(method.error.code, -32601);
    console.log('PASS: MCP HTTP initialize/tools/ping, dashboard, shared project/global scope, project isolation, parallel writes, malformed/oversize/method handling');
  } finally {
    child.kill();
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 2000))]);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
