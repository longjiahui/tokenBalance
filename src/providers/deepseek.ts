import { fetch } from "@tauri-apps/plugin-http";
import type { Connection } from "../types";
import { failByStatus, resolveBaseUrl, toNumber } from "./type";
import type { ProviderBalance, TokenProvider } from "./type";

interface DeepSeekBalanceInfo {
  currency: string;
  total_balance: string;
  granted_balance: string;
  topped_up_balance: string;
}

interface DeepSeekBalanceResponse {
  is_available?: boolean;
  balance_infos?: DeepSeekBalanceInfo[];
}

export const deepseekProvider: TokenProvider = {
  id: "deepseek",
  label: "DeepSeek",
  defaultBaseUrl: "https://api.deepseek.com",

  async fetchBalance(conn: Connection): Promise<ProviderBalance> {
    const base = resolveBaseUrl(conn, this);
    const res = await fetch(`${base}/user/balance`, {
      headers: { Authorization: `Bearer ${conn.apiKey}` },
    });
    if (!res.ok) failByStatus(this.label, res.status);

    const data = (await res.json()) as DeepSeekBalanceResponse;
    const info = data.balance_infos?.[0];
    if (!info) throw new Error("DeepSeek: 响应中没有余额信息");

    return {
      kind: "wallet",
      currency: info.currency,
      total: toNumber(info.total_balance, "total_balance"),
      granted: toNumber(info.granted_balance, "granted_balance"),
      toppedUp: toNumber(info.topped_up_balance, "topped_up_balance"),
      isAvailable: data.is_available ?? true,
    };
  },
};
