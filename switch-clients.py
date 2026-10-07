"""Point local agent MCP settings at the shared nyan-mem HTTP endpoint."""
import json
from pathlib import Path

URL = 'http://127.0.0.1:37788/mcp'


def update_json(path, key):
    if not path.exists():
        return False
    original = path.read_bytes()
    newline = '\r\n' if b'\r\n' in original else '\n'
    encoding = 'utf-8-sig' if original.startswith(b'\xef\xbb\xbf') else 'utf-8'
    data = json.loads(original.decode(encoding))
    servers = data.setdefault(key, {})
    servers['nyan-mem-http'] = {'url': URL, 'disabled': False}
    path.write_bytes((json.dumps(data, ensure_ascii=False, indent=2) + newline).encode(encoding))
    return True


home = Path.home()
changed = []
cline = home / '.cline' / 'data' / 'settings' / 'cline_mcp_settings.json'
if update_json(cline, 'mcpServers'):
    changed.append('Cline')
for config in (home / '.gemini' / 'antigravity' / 'mcp_config.json', home / '.gemini' / 'config' / 'mcp_config.json'):
    if update_json(config, 'mcpServers'):
        changed.append(str(config))

hermes = Path(r'E:\HERMES\config.yaml')
text = hermes.read_text(encoding='utf-8')
old = r'''  nyan-mem:
    command: C:\Program Files\nodejs\node.exe
    args:
      - C:\Users\yudah\.nyan-mem\server.cjs
    tools: all'''
new = '''  nyan-mem:
    url: http://127.0.0.1:37788/mcp
    tools: all'''
if old in text:
    hermes.write_text(text.replace(old, new, 1), encoding='utf-8')
    changed.append('Hermes')
print('Configured HTTP MCP for: ' + ', '.join(changed))
