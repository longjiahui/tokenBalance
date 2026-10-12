import type { Connection } from "../types";

export interface QuotaWindow {
  label: string;
  used: number;
  limit: number;
  /** epoch 毫秒，配额重置时间 */
  resetAt?: number;
}

export type ProviderBalance =
  | {
      kind: "wallet";
      currency: string;
      total: number;
      granted: number;
      toppedUp: number;
      isAvailable: boolean;
    }
  | { kind: "quota"; planLevel?: string; windows: QuotaWindow[] };

export interface TokenProvider {
  id: string;
  label: string;
  defaultBaseUrl: string;
  fetchBalance(conn: Connection): Promise<ProviderBalance>;
}

export function resolveBaseUrl(conn: Connection, provider: TokenProvider): string {
  return (conn.baseUrl?.trim() || provider.defaultBaseUrl).replace(/\/+$/, "");
}

export function failByStatus(providerLabel: string, status: number): never {
  if (status === 401 || status === 403) {
    throw new Error(`${providerLabel}: API Key 无效或无权限 (${status})`);
  }
  if (status === 402) {
    throw new Error(`${providerLabel}: 账户余额不足 (402)`);
  }
  if (status === 429) {
    throw new Error(`${providerLabel}: 请求过于频繁 (429)`);
  }
  throw new Error(`${providerLabel}: 请求失败 (HTTP ${status})`);
}

export function toNumber(value: string | number | undefined, field: string): number {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) throw new Error(`响应字段 ${field} 无法解析`);
  return n;
}
