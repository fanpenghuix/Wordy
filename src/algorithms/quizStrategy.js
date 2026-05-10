const strategies = {};

export function registerStrategy(name, impl) {
  strategies[name] = impl;
}

function getActiveStrategy() {
  const name = process.env.ACTIVE_STRATEGY || 'legacy';
  return strategies[name] || strategies['legacy'];
}

export function getDueWords(userId, limit) {
  return getActiveStrategy().getDueWords(userId, limit);
}

export function recordResult(userId, wordId, correct) {
  return getActiveStrategy().recordResult(userId, wordId, correct);
}

export function initWord(userId, wordId) {
  return getActiveStrategy().initWord?.(userId, wordId);
}
