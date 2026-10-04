const PROVIDER = 'openai-codex';
const SOL_61 = 'gpt-6.1-sol';

// SDK 0.87.1 predates Sol 6.1. Extend its native provider so OAuth and transport
// remain SDK-owned; retain every built-in model when registering the catalog.
export function registerCodexModels(runtime) {
  const models = runtime.getModels(PROVIDER);
  const existing = models.find(({ id }) => id === SOL_61);
  const template = existing || models.find(({ id }) => id === 'gpt-6-sol');
  if (!template) throw new Error('Codex Sol model definition unavailable');
  const sol = {
    ...template,
    id: SOL_61,
    name: 'GPT-6.1 Sol',
    // Keep the native Codex context allowance rather than assuming API limits.
    thinkingLevelMap: { ...template.thinkingLevelMap, off: 'low', minimal: 'low' },
    cost: existing?.cost || { ...template.cost, cacheRead: 0.1,
      tiers: template.cost.tiers?.map((tier) => ({ ...tier, cacheRead: 0.2 })) },
  };
  runtime.registerProvider(PROVIDER, {
    models: existing ? models.map((model) => model.id === SOL_61 ? sol : model) : [...models, sol],
  });
}

export function assistantThinkingLevel(model) {
  return model?.provider === PROVIDER && model.id === SOL_61 ? 'low' : 'off';
}
