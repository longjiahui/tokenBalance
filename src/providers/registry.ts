import type { TokenProvider } from "./type";
import { deepseekProvider } from "./deepseek";
import { glmProvider } from "./glm";

const providers = new Map<string, TokenProvider>();

function register(provider: TokenProvider) {
  providers.set(provider.id, provider);
}

register(deepseekProvider);
register(glmProvider);

export function getProvider(id: string): TokenProvider | undefined {
  return providers.get(id);
}

export function listProviders(): TokenProvider[] {
  return [...providers.values()];
}
