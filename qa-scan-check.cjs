const assert = require('node:assert/strict');
process.env.NYAN_MEM_DIR = process.env.LOCALAPPDATA + '/Temp/nyan-mem-qa-20261012';
const { startServer } = require('./dashboard.cjs');

const db = new (require('node:sqlite').DatabaseSync)(process.env.NYAN_MEM_DIR + '/memory.db');
const key = db.prepare("SELECT value FROM app_settings WHERE key = 'omniroute_key'").get()?.value;
if (!key) throw new Error('No saved OmniRoute key in isolated DB');
const relay = require('node:http').createServer(async (req, res) => {
  try {
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise(resolve => {
      let s = ''; req.setEncoding('utf8'); req.on('data', chunk => s += chunk); req.on('end', () => resolve(s));
    });
    const upstream = await fetch('http://127.0.0.1:20128' + req.url, {
      method: req.method, headers: { Authorization: 'Bearer ' + key, 'Content-Type': req.headers['content-type'] || 'application/json' }, body
    });
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) { res.writeHead(502); res.end(JSON.stringify({ error: e.message })); }
});
(async () => {
  await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
  const server = await startServer(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const models = await fetch(base + '/api/scan-models', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'http://127.0.0.1:' + relay.address().port + '/v1' }) });
    const data = await models.json();
    assert.equal(models.status, 200, JSON.stringify(data));
    assert.equal(data.success, true);
    assert.ok(data.total > 0);
    console.log('PASS: isolated /api/scan-models', data.total, 'models,', data.combos.length, 'combos');
    const projects = await (await fetch(base + '/api/projects')).json();
    assert.equal(projects.projects.filter(p => p.name.startsWith('test-prj-')).length, 3);
    console.log('PASS: QA DB only; known test projects preserved');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => relay.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
