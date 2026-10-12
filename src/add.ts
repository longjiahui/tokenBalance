import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getProvider, listProviders } from "./providers/registry";
import type { Connection } from "./types";

const form = document.getElementById("conn-form") as HTMLFormElement;
const select = document.getElementById("f-provider") as HTMLSelectElement;
const nameInput = document.getElementById("f-name") as HTMLInputElement;
const keyInput = document.getElementById("f-key") as HTMLInputElement;
const baseInput = document.getElementById("f-base") as HTMLInputElement;
const errEl = document.getElementById("form-error")!;
const saveBtn = document.getElementById("f-save") as HTMLButtonElement;
const cancelBtn = document.getElementById("f-cancel")!;
const closeBtn = document.getElementById("btn-close")!;

for (const p of listProviders()) {
  const opt = document.createElement("option");
  opt.value = p.id;
  opt.textContent = p.label;
  select.append(opt);
}

const syncPlaceholder = (): void => {
  const p = getProvider(select.value);
  baseInput.placeholder = p ? `留空使用 ${p.defaultBaseUrl}` : "";
  nameInput.placeholder = p?.label ?? "";
};
syncPlaceholder();
select.addEventListener("change", syncPlaceholder);

const close = (): void => void invoke("hide_window");

// 除按钮/输入控件外，按下任意位置即可拖动窗口
document.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (target.closest("button, input, select, textarea, a")) return;
  void getCurrentWindow().startDragging();
});

closeBtn.addEventListener("click", close);
cancelBtn.addEventListener("click", close);

// 每次窗口重新显示时重置表单
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    form.reset();
    errEl.textContent = "";
    saveBtn.disabled = false;
    saveBtn.textContent = "验证并保存";
    syncPlaceholder();
    keyInput.focus();
  }
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") close();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const provider = getProvider(select.value);
  if (!provider) {
    errEl.textContent = "未知的 provider";
    return;
  }
  const conn: Connection = {
    id: crypto.randomUUID(),
    providerId: provider.id,
    name: nameInput.value.trim() || provider.label,
    apiKey: keyInput.value.trim(),
    baseUrl: baseInput.value.trim() || undefined,
  };
  if (!conn.apiKey) {
    errEl.textContent = "请输入 API Key";
    return;
  }
  errEl.textContent = "验证中…";
  saveBtn.disabled = true;
  try {
    await provider.fetchBalance(conn);
  } catch (err) {
    errEl.textContent = err instanceof Error ? err.message : String(err);
    saveBtn.disabled = false;
    return;
  }

  // 写入配置后：重建托盘菜单并打开该连接的窗口
  try {
    const cfg = await invoke<{ connections: Connection[] }>("load_config");
    cfg.connections.push(conn);
    await invoke("save_config", { config: { connections: cfg.connections } });
  } catch (err) {
    errEl.textContent = `保存配置失败: ${err instanceof Error ? err.message : String(err)}`;
    saveBtn.disabled = false;
    return;
  }
  await invoke("refresh_tray");
  await invoke("open_connection_window", { id: conn.id });
  close();
});
