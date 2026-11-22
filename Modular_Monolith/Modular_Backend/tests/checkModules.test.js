const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { checkModuleBoundaries } = require("../scripts/check-modules");

describe("check-modules Boundary Enforcement Test", () => {
  let tempDir;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "modular-boundary-test-"));
  });

  after(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("passes when module imports another module via its facade index.js", () => {
    const fixtureDir = path.join(tempDir, "valid");
    fs.mkdirSync(path.join(fixtureDir, "modA"), { recursive: true });
    fs.mkdirSync(path.join(fixtureDir, "modB"), { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, "modB", "index.js"), "module.exports = { value: 42 };");
    fs.writeFileSync(
      path.join(fixtureDir, "modA", "index.js"),
      'const modB = require("../modB");\nmodule.exports = { modB };'
    );

    const violations = checkModuleBoundaries(fixtureDir);
    assert.equal(violations.length, 0);
  });

  test("fails when module illegally imports another module internal file", () => {
    const fixtureDir = path.join(tempDir, "invalid-internal");
    fs.mkdirSync(path.join(fixtureDir, "modA"), { recursive: true });
    fs.mkdirSync(path.join(fixtureDir, "modB"), { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, "modB", "index.js"), "module.exports = {};");
    fs.writeFileSync(path.join(fixtureDir, "modB", "secretHelper.js"), "module.exports = 1;");
    fs.writeFileSync(
      path.join(fixtureDir, "modA", "service.js"),
      'const secret = require("../modB/secretHelper");\nmodule.exports = secret;'
    );

    const violations = checkModuleBoundaries(fixtureDir);
    assert.ok(violations.length > 0, "Expected violations for importing internal file");
    assert.equal(violations[0].currentModule, "modA");
    assert.equal(violations[0].targetModule, "modB");
  });

  test("fails when module illegally imports another module model directly", () => {
    const fixtureDir = path.join(tempDir, "invalid-model");
    fs.mkdirSync(path.join(fixtureDir, "modA"), { recursive: true });
    fs.mkdirSync(path.join(fixtureDir, "modB", "models"), { recursive: true });

    fs.writeFileSync(path.join(fixtureDir, "modB", "index.js"), "module.exports = {};");
    fs.writeFileSync(path.join(fixtureDir, "modB", "models", "User.js"), "module.exports = {};");
    fs.writeFileSync(
      path.join(fixtureDir, "modA", "userFinder.js"),
      'const User = require("../modB/models/User");\nmodule.exports = User;'
    );

    const violations = checkModuleBoundaries(fixtureDir);
    assert.ok(violations.length > 0, "Expected violations for importing model file directly");
    assert.ok(
      violations.some((v) => v.reason.includes("Cross-module model access")),
      "Expected a violation specific to cross-module model access"
    );
  });
});
