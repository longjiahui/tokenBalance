import { fetch } from "@tauri-apps/plugin-http";
import type { Connection } from "../types";
import { failByStatus, resolveBaseUrl, toNumber } from "./type";
import type { ProviderBalance, QuotaWindow, TokenProvider } from "./type";

/** limits[] 里 unit/number 组合 → 展示名（5h 滚动窗口 / 每周窗口 / MCP 月度） */
const WINDOW_DEFS: { unit: number; number: number; label: string }[] = [
  { unit: 3, number: 5, label: "5 小时" },
  { unit: 6, number: 1, label: "每周" },
  { unit: 5, number: 1, label: "MCP 月度" },
];

interface GlmLimit {
  type?: string;
  unit?: number;
  number?: number;
  currentValue?: number;
  usage?: number;
  percentage?: number;
  nextResetTime?: number;
}

interface GlmQuotaResponse {
  code?: number;
  msg?: string;
  success?: boolean;
  data?: {
    level?: string;
    limits?: GlmLimit[];
  };
}

/**
 * 该端点无效 key 时也返回 HTTP 200，错误藏在响应体（如
 * {"code":401,"msg":"令牌已过期或验证不正确","success":false}）。
 */
function bodyAuthFailure(data: GlmQuotaResponse): boolean {
  return data.code === 401 || data.code === 403;
}

function normalizeResetAt(value: number | undefined): number | undefined {
  if (!value || value <= 0) return undefined;
  return value < 1e12 ? value * 1000 : value;
}

function toWindow(limit: GlmLimit): QuotaWindow {
  const label =
    WINDOW_DEFS.find((d) => d.unit === limit.unit && d.number === limit.number)?.label ??
    `配额 (${limit.unit ?? "?"}×${limit.number ?? "?"})`;
  const resetAt = normalizeResetAt(limit.nextResetTime);
  if (limit.usage !== undefined) {
    return {
      label,
      used: toNumber(limit.currentValue, "currentValue"),
      limit: toNumber(limit.usage, "usage"),
      resetAt,
    };
  }
  // 兼容只返回 percentage 的旧格式
  const pct = toNumber(limit.percentage, "percentage");
  return { label, used: pct, limit: 100, resetAt };
}

export const glmProvider: TokenProvider = {
  id: "glm",
  label: "GLM Coding Plan",
  defaultBaseUrl: "https://open.bigmodel.cn",

  async fetchBalance(conn: Connection): Promise<ProviderBalance> {
    const base = resolveBaseUrl(conn, this);
    // 该监控端点接受裸 key；认证失败时回退尝试 Bearer 形式
    let res = await fetch(`${base}/api/monitor/usage/quota/limit`, {
      headers: { Authorization: conn.apiKey },
    });
    if (!res.ok) failByStatus(this.label, res.status);
    let data = (await res.json()) as GlmQuotaResponse;

    if (bodyAuthFailure(data)) {
      res = await fetch(`${base}/api/monitor/usage/quota/limit`, {
        headers: { Authorization: `Bearer ${conn.apiKey}` },
      });
      if (!res.ok) failByStatus(this.label, res.status);
      data = (await res.json()) as GlmQuotaResponse;
      if (bodyAuthFailure(data)) failByStatus(this.label, data.code ?? 401);
    }

    if (data.success === false || (data.code !== undefined && data.code !== 200)) {
      throw new Error(`GLM: 请求失败 (code ${data.code ?? "?"}${data.msg ? `: ${data.msg}` : ""})`);
    }

    const limits = data.data?.limits ?? [];
    const windows = limits.filter((l) => l.type !== "TIME_LIMIT").map(toWindow);
    if (windows.length === 0) {
      throw new Error("GLM: 未返回配额信息（该 Key 可能不是 Coding Plan 套餐 Key）");
    }

    const orderBy = (w: QuotaWindow) => WINDOW_DEFS.findIndex((d) => d.label === w.label);
    windows.sort((a, b) => {
      const ia = orderBy(a);
      const ib = orderBy(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    return { kind: "quota", planLevel: data.data?.level, windows };
  },
};
