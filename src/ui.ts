import type { QuotaWindow } from "./providers/type";
import type { ConnView } from "./types";

export function esc(value: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (ch) => map[ch]!);
}

export function timeOf(t: number | null): string {
  return t ? new Date(t).toLocaleTimeString("zh-CN", { hour12: false }) : "—";
}

function fmt(n: number): string {
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function resetText(resetAt: number | undefined): string {
  if (!resetAt) return "";
  const diff = resetAt - Date.now();
  if (diff <= 0) return "即将重置";
  const min = Math.floor(diff / 60_000);
  const h = Math.floor(min / 60);
  if (h >= 24) return `${Math.floor(h / 24)} 天 ${h % 24} 时后重置`;
  if (h >= 1) return `${h} 小时 ${min % 60} 分后重置`;
  return `${min} 分后重置`;
}

/** 进度条显示剩余量（反向进度）：剩余越少越危险 */
function remainingPct(w: QuotaWindow): number {
  if (w.limit <= 0) return 0;
  return Math.min(100, Math.max(0, ((w.limit - w.used) / w.limit) * 100));
}

function levelClass(remaining: number): string {
  return remaining <= 10 ? " danger" : remaining <= 30 ? " warn" : "";
}

function walletHtml(v: ConnView): string {
  const b = v.balance;
  if (!b || b.kind !== "wallet") return "";
  const low = b.isAvailable ? "" : ' · <span class="err">余额不足</span>';
  return `
    <div class="wallet-total">${esc(b.currency)} ${fmt(b.total)}</div>
    <div class="wallet-sub">赠送 ${fmt(b.granted)} · 充值 ${fmt(b.toppedUp)}${low}</div>`;
}

function quotaHtml(v: ConnView): string {
  const b = v.balance;
  if (!b || b.kind !== "quota") return "";
  return b.windows
    .map((w) => {
      const pct = remainingPct(w);
      const remaining = w.limit > 0 ? Math.max(0, w.limit - w.used) : 0;
      return `
      <div class="quota">
        <div class="quota-head"><span>${esc(w.label)}剩余</span><span>${pct.toFixed(1)}%</span></div>
        <div class="bar"><div class="bar-fill${levelClass(pct)}" style="width: ${pct}%"></div></div>
        <div class="quota-sub">剩余 ${fmt(remaining)} / ${fmt(w.limit)} 积分${w.resetAt ? ` · ${resetText(w.resetAt)}` : ""}</div>
      </div>`;
    })
    .join("");
}

/** 卡片主体（余额数字 / 配额进度条）+ 错误行 */
export function cardBodyHtml(v: ConnView): string {
  const body =
    v.balance?.kind === "wallet"
      ? walletHtml(v)
      : v.balance?.kind === "quota"
        ? quotaHtml(v)
        : "";
  const err = v.error
    ? `<div class="card-foot"><span class="err">${esc(v.error)}</span></div>`
    : "";
  return body + err;
}
