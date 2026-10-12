# AGENTS.md — Development Guide

Guidance for AI agents and developers working on this repo.

## What this is

**Token Balance** — a Tauri 2 system-tray widget that monitors LLM API balance/quota for multiple providers (DeepSeek, Zhipu GLM Coding Plan). Windows-only in practice (developed on Windows / MSVC), targets the user's personal use.

## Commands

```bash
npm run build          # frontend: tsc (strict) + vite build — run this first
cargo check            # in src-tauri/ — Rust compile check
npm run tauri dev      # full dev app (blocks; don't run headless)
npm run tauri build    # release bundle (slow, ~3-6 min first time)
```

Verify with `npm run build` + `cargo check` before considering any change done. Do not leave `tauri dev` running.

## Stack

- **Tauri 2.12.x**, no UI framework — vanilla TypeScript + Vite, two HTML entry points (`add.html`, `conn.html`)
- Frontend HTTP goes through `@tauri-apps/plugin-http` (Rust-side fetch, bypasses CORS; URL whitelist in capabilities)
- Rust deps: `tauri` (feature `tray-icon`), `tauri-plugin-http`, `tauri-plugin-single-instance`, `tauri-plugin-opener`

## Architecture

### Window model (no main window!)

- `add` — declared in `src-tauri/tauri.conf.json`, hidden by default; the add/edit connection form (`src/add.ts`)
- `conn-<uuid>` — created **dynamically by Rust** (`show_connection_window` in `src-tauri/src/lib.rs`), one per connection, loads `conn.html` (`src/conn.ts`). The window label is the transport for the connection id: `getCurrentWindow().label.replace(/^conn-/, "")`.
- Every conn window polls **its own** connection every 30s (`REFRESH_MS`; exponential backoff to `MAX_BACKOFF_MS` = 15 min on errors). Windows are hidden (not destroyed) on ×, so polling continues.
- Tray left-click toggles all conn windows; tray menu has 全部刷新 / 添加连接 / separator / per-connection `CheckMenuItem` (checked = visible) / separator / 退出.
- `rebuild_tray` regenerates the menu from the config file; the frontend calls the `refresh_tray` command after add/delete.

### Frontend layout

```
src/
  providers/type.ts      # TokenProvider interface; ProviderBalance = wallet | quota
  providers/registry.ts  # Map registry;集中 import 各 provider 并注册
  providers/deepseek.ts  # GET {base}/user/balance, Bearer auth, string amounts
  providers/glm.ts       # GET {base}/api/monitor/usage/quota/limit, raw-key auth
  ui.ts                  # cardBodyHtml renderer (wallet numbers / quota bars)
  conn.ts, add.ts        # per-window controllers
  types.ts               # Connection, ConnView
```

- To add a provider: new file implementing `TokenProvider` + one `register()` line in `registry.ts` + whitelist its API host in `src-tauri/capabilities/default.json`.
- `quota` balances render **remaining** (reversed) progress bars; color thresholds are on remaining % (≤30 warn, ≤10 danger).
- UI text is **Chinese**. TS is strict with `noUnusedLocals`/`noUnusedParameters` — no dead imports.

### Rust side (`src-tauri/src/lib.rs`, single file)

- `TrayState { tray, conn_items: Mutex<HashMap<String, CheckMenuItem>> }` — keep checkmarks in sync with window visibility (hide via tray, via ×, and via toggle must all sync).
- `WindowPositions { map, dirty }` + background flusher thread (1.5s debounce) persisting to `positions.json`. Positions are **physical pixels** (i32); `set_position(PhysicalPosition)` — do not mix with logical coordinates.
- On startup, `resolve_initial_positions` validates each saved position against `available_monitors()` (needs ≥60×40 px visible); invalid/missing → `stack_position`: right-aligned vertical stack on the primary monitor's top-right, 12px gaps, wraps to a new column.
- Commands: `load_config`, `save_config`, `open_add`, `hide_window`, `open_connection_window`, `close_connection_window`, `refresh_tray`.
- `tauri.conf.json` window config does **not** support `modal` in 2.12.x (compile error) — modality is approximated with owned windows + overlay if ever needed.

### Data files (`%APPDATA%\com.tokenbalance.app\`)

- `config.json` — `{ connections: [...] }`, serde structs with `#[serde(rename_all = "camelCase")]` matching the TS `Connection` shape (`id, providerId, name, apiKey, baseUrl`)
- `positions.json` — `{ "<connId>": [x, y] }`
- API keys are plaintext by design (personal tool); keyring/DPAPI would be the upgrade path.

### Capabilities (`src-tauri/capabilities/default.json`)

- Applies to windows `["add", "conn-*"]` (glob covers dynamically created conn windows)
- `http:default` with explicit URL whitelist — add any new provider API host here
- `core:window:allow-start-dragging` — global window dragging is implemented in JS (mousedown handler excluding `button, input, select, textarea, .dropdown`), not via `data-tauri-drag-region`

## Gotchas

- GLM usage endpoint (`/api/monitor/usage/quota/limit`) is **undocumented/community-discovered**; auth is the raw key (no Bearer) and an invalid key returns **HTTP 200** with an error body (`code: 401`) — error handling keys off the body, with a Bearer retry fallback.
- DeepSeek balance amounts are JSON **strings**; parse with `toNumber`.
- Tauri 2.12 menu API: `show_menu_on_left_click(false)` (v2.2+ rename); `CheckMenuItem` auto-toggles on click — we set it explicitly afterwards to match real window state.
- READMEs are bilingual with cross-links at the top; keep `README.md` (English) and `README.zh-cn.md` in sync, and update `AGENTS.md` when architecture changes.
