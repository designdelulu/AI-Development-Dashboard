export const emptyTokens = () => ({ freshInput: 0, output: 0, cacheRead: 0, cacheCreation: 0, reasoning: 0, other: 0 });
export const tokenActivity = (tokens = emptyTokens()) => Object.values(tokens).reduce((sum, value) => sum + (Number(value) || 0), 0);
