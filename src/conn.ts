import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getProvider } from "./providers/registry";
import type { ProviderBalance } from "./providers/type";
import type { ConnView, Connection } from "./types";
import { cardBodyHtml, timeOf } from "./ui";

const REFRESH_MS = 30_000;
const MAX_BACKOFF_MS = 15 * 60_000;

// 窗口 label 形如 conn-<id>，由 Rust 侧创建时指定
const id = getCurrentWindow().label.replace(/^conn-/, "");
const opacityKey = `opacity:${getCurrentWindow().label}`;

let conn: Connection | null = null;
let balance: ProviderBalance | null = null;
let error: string | null = null;
let lastSuccessAt: number | null = null;
let backoffMs = REFRESH_MS;
let timer = 0;

const badgeEl = document.getElementById("provider-badge")!;
const nameEl = document.getElementById("conn-name")!;
const planEl = document.getElementById("plan")!;
const bodyEl = document.getElementById("card")!;
const moreWrap = document.getElementById("more-wrap")!;
const moreMenu = document.getElementById("more-menu")!;
const refreshBtn = document.getElementById("dd-refresh") as HTMLButtonElement;
const deleteBtn = document.getElementById("dd-delete") as HTMLButtonElement;
const opacityInput = document.getElementById("dd-opacity") as HTMLInputElement;
const opacityVal = document.getElementById("dd-opacity-val")!;

// ---------- 拖拽：除按钮/控件/下拉菜单外，按下任意位置即可拖动窗口 ----------
document.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (target.closest("button, input, select, textarea, .dropdown, a")) return;
  void getCurrentWindow().startDragging();
});

// ---------- More 下拉菜单 ----------
function closeMenu(): void {
  moreMenu.classList.add("hidden");
}

document.getElementById("btn-more")!.addEventListener("click", (e) => {
  e.stopPropagation();
  moreMenu.classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
  if (!moreWrap.contains(e.target as Node)) closeMenu();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});

refreshBtn.addEventListener("click", () => {
  closeMenu();
  void refresh();
});

deleteBtn.addEventListener("click", () => {
  if (deleteBtn.dataset.confirm === "1") {
    closeMenu();
    void deleteConn();
    return;
  }
  deleteBtn.dataset.confirm = "1";
  deleteBtn.textContent = "确认删除?";
  window.setTimeout(() => {
    deleteBtn.dataset.confirm = "";
    deleteBtn.textContent = "删除";
  }, 3000);
});

// ---------- 不透明度 ----------
function setOpacity(value: number): void {
  document.body.style.setProperty("--win-alpha", String(value / 100));
  opacityVal.textContent = `${value}%`;
}

opacityInput.addEventListener("input", () => {
  const value = Number(opacityInput.value);
  setOpacity(value);
  localStorage.setItem(opacityKey, String(value));
});

const savedOpacity = Number(localStorage.getItem(opacityKey));
if (Number.isFinite(savedOpacity) && savedOpacity >= 30) {
  opacityInput.value = String(savedOpacity);
  setOpacity(savedOpacity);
}

// ---------- 数据 ----------
async function loadConn(): Promise<boolean> {
  const cfg = await invoke<{ connections: Connection[] }>("load_config");
  conn = cfg.connections.find((c) => c.id === id) ?? null;
  if (!conn) {
    document.title = "连接不存在";
    bodyEl.innerHTML = '<div class="empty">连接不存在或已被删除</div>';
    return false;
  }
  return true;
}

function render(): void {
  if (!conn) return;
  const provider = getProvider(conn.providerId);
  badgeEl.textContent = provider?.label ?? conn.providerId;
  nameEl.textContent = conn.name;
  document.title = conn.name;

  if (balance?.kind === "quota" && balance.planLevel) {
    planEl.textContent = balance.planLevel.toUpperCase();
    planEl.classList.remove("hidden");
  } else {
    planEl.classList.add("hidden");
  }

  const view: ConnView = { conn, balance, error, lastSuccessAt, fetching: false };
  bodyEl.innerHTML = cardBodyHtml(view);
  // 刷新时间藏进按钮 tooltip
  refreshBtn.title = lastSuccessAt
    ? `刷新（上次刷新 ${timeOf(lastSuccessAt)}）`
    : "刷新";
}

async function refresh(): Promise<void> {
  if (!conn) return;
  const provider = getProvider(conn.providerId);
  if (!provider) {
    error = `未知的 provider: ${conn.providerId}`;
    render();
    return;
  }
  refreshBtn.disabled = true;
  refreshBtn.title = "刷新中…";
  try {
    balance = await provider.fetchBalance(conn);
    error = null;
    lastSuccessAt = Date.now();
    backoffMs = REFRESH_MS;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    backoffMs = Math.min(Math.max(backoffMs * 2, REFRESH_MS * 2), MAX_BACKOFF_MS);
  } finally {
    refreshBtn.disabled = false;
    render();
  }
}

function schedule(): void {
  clearTimeout(timer);
  timer = window.setTimeout(async () => {
    await refresh();
    schedule();
  }, error ? backoffMs : REFRESH_MS);
}

async function deleteConn(): Promise<void> {
  const cfg = await invoke<{ connections: Connection[] }>("load_config");
  await invoke("save_config", {
    config: { connections: cfg.connections.filter((c) => c.id !== id) },
  });
  await invoke("refresh_tray");
  await invoke("close_connection_window", { id });
}

window.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("btn-close")!.addEventListener("click", () => {
    void invoke("hide_window");
  });
  void listen("refresh-all", () => void refresh());

  if (await loadConn()) {
    await refresh();
    schedule();
  }
});
