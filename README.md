# 🐾 nyan-mem 🎀

> **Lightweight, Zero-API-Cost, Anti-Slop Project-Scoped Memory Engine & MCP Server**

`nyan-mem` adalah pengganti mandiri untuk memory observer agent (seperti `claude-mem`) yang berjalan 100% lokal di atas Node.js native SQLite (`node:sqlite`) dengan FTS5 Full-Text Search. Dilengkapi dengan dual-perspective distillation (AI/Engineer vs Layman/Human), Project Scoping terisolasi, CLI instan, dan Web App Dashboard responsif (Dark/Light mode).

---

## ✨ Fitur Utama

- 🧠 **Dual-Perspective Distillation**:
  - `technical_summary`: Ditujukan untuk AI & Software Engineer (faktual, dingin, tanpa kata bombastis / anti-slop).
  - `layman_summary`: Ditujukan untuk manusia non-teknis dalam Bahasa Indonesia yang santai dan mudah dimengerti.
- 📁 **Project Scoping & Workspace Awareness**:
  - Catatan dan Work State / To-Do diisolasi per proyek (misal `ibt-laravel`, `sap-b1`) dengan fallback `global`.
  - Simpan workspace path lokal dan custom LLM model override per proyek.
- 🔍 **FTS5 BM25 Full-Text Search**:
  - Pencarian memori secepat kilat dengan SQLite virtual table FTS5 bawaan Node.js 24.
- 🖥️ **Web Dashboard (`http://localhost:37788`)**:
  - Desain mengikuti `ui-antislop-master-suite` & `uwu-pastel` palette.
  - Auto Dark/Light theme mengikuti preferensi sistem OS.
  - Pindai Model otomatis dari router LLM lokal (seperti OmniRoute).
  - Pratinjau Markdown popup langsung di browser sebelum mengunduh.
  - Pemilihan folder direktori langsung tanpa konfirmasi berbelit.
  - Auto-create database kosongan jika diarahkan ke folder baru.
- 🔌 **Universal MCP Protocol Compatible**:
  - Terdaftar sebagai server MCP untuk Google Antigravity, Claude Code, Cline, dan agent lainnya.
- ⚡ **CLI Ringan**:
  - Akses cepat via terminal dengan `mem` / `node cli.cjs`.

---

## 🚀 Memulai

### 1. Prasyarat
- Node.js v22.x atau v24.x (dengan dukungan native `node:sqlite`).

### 2. Jalankan MCP Server
Tambahkan ke konfigurasi MCP client kamu (`mcp_config.json`):
```json
{
  "mcpServers": {
    "nyan-mem": {
      "command": "node",
      "args": ["/path/to/nyan-mem/server.cjs"]
    }
  }
}
```

### 3. Jalankan Web Dashboard
```bash
node dashboard.cjs
```
Buka browser ke `http://localhost:37788`.

### 4. Menjalankan Test Suite
```bash
node test-suite.js
```

---

## 🛠️ CLI Quick Commands
```bash
node cli.cjs projects              # Tampilkan daftar proyek
node cli.cjs recent [limit] [prj]  # Lihat riwayat memori terbaru
node cli.cjs search <query>        # Cari memori via FTS5
node cli.cjs todo list [prj]       # Lihat daftar to-do / state aktif
```

---

## 📜 Lisensi
MIT License &copy; 2026 nyan-mem contributors.
