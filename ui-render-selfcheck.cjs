const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('public/index.html', 'utf8');
const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]).join('\n');
function extract(name) {
  const start = js.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  const brace = js.indexOf('{', start); let depth = 0, quote = null, esc = false;
  for (let i = brace; i < js.length; i++) { const c = js[i]; if (quote) { if (esc) esc=false; else if(c==='\\')esc=true; else if(c===quote)quote=null; continue; } if(c==='"'||c==="'"||c==='`'){quote=c;continue;} if(c==='{')depth++; if(c==='}'&&--depth===0)return js.slice(start,i+1); }
  throw new Error(`unterminated ${name}`);
}
const container = { innerHTML: '' };
const document = { getElementById: id => id === 'cards-container' ? container : { value: '' } };
const ctx = { document, Date, language:'en', escapeHtml: x => String(x || ''), activeViewMode: 'side' };
vm.createContext(ctx);
vm.runInContext(extract('renderCards'), ctx);
ctx.renderCards([{id:1,category:'decision',technical_summary:'a',layman_summary:'b',created_at:'2026-01-01',tags:[]}]);
assert.match(container.innerHTML, /#1/);
console.log('PASS: renderCards composes one memory card from DOM fixture');
