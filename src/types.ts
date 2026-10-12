import type { ProviderBalance } from "./providers/type";

export type { ProviderBalance, QuotaWindow } from "./providers/type";

export interface Connection {
  id: string;
  providerId: string;
  name: string;
  apiKey: string;
  baseUrl?: string;
}

export interface ConnView {
  conn: Connection;
  balance: ProviderBalance | null;
  error: string | null;
  lastSuccessAt: number | null;
  fetching: boolean;
}
