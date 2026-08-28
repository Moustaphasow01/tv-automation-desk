export function readySelectorForRoute(route) {
  return {
    "command-center": ".cc-page",
    live: ".lt-page",
    strategies: '[data-testid="strategy-center-golden-master"]',
  }[route] ?? null;
}
