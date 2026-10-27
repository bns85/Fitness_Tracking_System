/**
 * Resolves with the first EventBus payload matching `predicate`,
 * or `null` when the timeout expires. Used by synchronous API handlers
 * that must return event-driven results (EDA choreography bridge).
 */
function waitForEvent(eventBus, eventName, predicate = () => true, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      eventBus.removeListener(eventName, handler);
    };

    const handler = (data) => {
      if (!predicate(data)) return;
      cleanup();
      resolve(data);
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    eventBus.on(eventName, handler);
  });
}

module.exports = waitForEvent;
