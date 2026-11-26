/**
 * Busy-loop burn CPU helper for consistent compute simulation.
 * Called exactly ONCE per goal evaluation inside the goal logic.
 *
 * @param {number} ms Milliseconds to burn
 */
function burnCpu(ms) {
  if (!ms || ms <= 0) return;
  const start = process.hrtime.bigint();
  const nsToBurn = BigInt(Math.floor(ms)) * 1_000_000n;
  while (process.hrtime.bigint() - start < nsToBurn) {
    // Busy loop
  }
}

module.exports = burnCpu;
