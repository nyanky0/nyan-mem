const assert = require('node:assert/strict');
const { startServer } = require('./dashboard.cjs');

(async () => {
  const server = await startServer(0);
  try {
    assert.ok(server.address().port > 0);
    assert.equal(server.address().address, '127.0.0.1');
    console.log('PASS: dashboard server exposes bound loopback server on ephemeral port');
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
