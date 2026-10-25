// Which LLM provider the Anthropic SDK is pointed at.
// The SDK itself reads ANTHROPIC_BASE_URL (empty = api.anthropic.com). OpenRouter exposes an Anthropic-compatible
// Messages endpoint at https://openrouter.ai/api, so the same code runs there with an OpenRouter key — but some
// request features exist only on Anthropic, and the help text for a rejected key differs. This module decides both.

export type LlmProvider = 'anthropic' | 'openrouter' | 'other'

export function llmProvider(baseURL: string | null | undefined = process.env.ANTHROPIC_BASE_URL): LlmProvider {
  if (!baseURL) return 'anthropic'
  let host: string
  try {
    host = new URL(baseURL).hostname
  } catch {
    return 'other'
  }
  if (host === 'anthropic.com' || host.endsWith('.anthropic.com')) return 'anthropic'
  if (host === 'openrouter.ai' || host.endsWith('.openrouter.ai')) return 'openrouter'
  return 'other'
}

export const PROVIDER_LABEL: Record<LlmProvider, string> = {
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  other: 'the AI provider at ANTHROPIC_BASE_URL',
}

/** Default models when ASSISTANT_MODEL / ANTHROPIC_MODEL are not set: Claude on Anthropic; OpenRouter's free router elsewhere. */
export function defaultAssistantModel(provider: LlmProvider = llmProvider()) {
  return provider === 'anthropic' ? 'claude-opus-5-5' : 'openrouter/free'
}
export function defaultScanModel(provider: LlmProvider = llmProvider()) {
  return provider === 'anthropic' ? 'claude-sonnet-5-5' : 'openrouter/free'
}

/** Explains a key that clearly belongs to a different service than the one requests are sent to; null when it looks right. */
export function keyMismatch(key: string, provider: LlmProvider = llmProvider()): string | null {
  if (provider === 'anthropic') {
    if (key.startsWith('sk-or-'))
      return 'ANTHROPIC_API_KEY is an OpenRouter key (sk-or-…) but requests go to Anthropic. Either set ANTHROPIC_BASE_URL=https://openrouter.ai/api or use an Anthropic key (sk-ant-…).'
    if (!key.startsWith('sk-ant-')) return 'ANTHROPIC_API_KEY does not look like an Anthropic key (they start with sk-ant-).'
  }
  if (provider === 'openrouter' && key.startsWith('sk-ant-'))
    return 'ANTHROPIC_API_KEY is an Anthropic key (sk-ant-…) but ANTHROPIC_BASE_URL points to OpenRouter. Use an OpenRouter key (sk-or-…) or remove ANTHROPIC_BASE_URL.'
  return null
}

/** Where to get or check a key for the active provider. */
export function keyHelp(provider: LlmProvider = llmProvider()) {
  if (provider === 'anthropic') return 'Check the key at console.anthropic.com.'
  if (provider === 'openrouter') return 'Check the key at openrouter.ai/settings/keys.'
  return 'Check ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL.'
}
