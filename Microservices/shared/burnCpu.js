function burnCpu(milliseconds) {
  const durationMs = Math.max(0, Number(milliseconds) || 0);
  const deadline = process.hrtime.bigint() + BigInt(Math.floor(durationMs * 1e6));
  while (process.hrtime.bigint() < deadline) {
    Math.sqrt(12345);
  }
}

module.exports = burnCpu;
