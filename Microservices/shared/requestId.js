const { randomUUID } = require("node:crypto");

function requestIdMiddleware(req, res, next) {
  const incoming = req.get("X-Request-Id");
  req.requestId = incoming && incoming.trim() ? incoming.trim() : randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
}

module.exports = { requestIdMiddleware };
