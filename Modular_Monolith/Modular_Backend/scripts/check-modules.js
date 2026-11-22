#!/usr/bin/env node

/**
 * check-modules.js - Architectural boundary enforcement for Modular Monolith
 *
 * Rules:
 * 1. Each module under src/modules/<name>/ has index.js as its ONLY public facade.
 * 2. Modules must NEVER import another module's internal files (e.g. models, repositories, strategies).
 *    They may ONLY import from `modules/<other-module>` or `modules/<other-module>/index(.js)`.
 * 3. Cross-module direct model access is strictly forbidden.
 */

const fs = require("fs");
const path = require("path");

const MODULES_DIR = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, "../src/modules");

function findJsFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(findJsFiles(fullPath));
    } else if (file.endsWith(".js")) {
      results.push(fullPath);
    }
  }
  return results;
}

function checkModuleBoundaries(rootDir = MODULES_DIR) {
  const files = findJsFiles(rootDir);
  const violations = [];

  const requireRegex = /require\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const filePath of files) {
    const relToModules = path.relative(rootDir, filePath).replace(/\\/g, "/");
    const parts = relToModules.split("/");
    const currentModule = parts[0];

    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);

    lines.forEach((line, lineIdx) => {
      let match;
      while ((match = requireRegex.exec(line)) !== null) {
        const importPath = match[1];

        // Resolve import path relative to current file
        const resolvedTarget = path.resolve(path.dirname(filePath), importPath);
        const relTargetToModules = path
          .relative(rootDir, resolvedTarget)
          .replace(/\\/g, "/");

        // Check if import points to a module inside rootDir
        if (
          !relTargetToModules.startsWith("..") &&
          !path.isAbsolute(relTargetToModules)
        ) {
          const targetParts = relTargetToModules.split("/");
          const targetModule = targetParts[0];

          // If importing another module
          if (targetModule && targetModule !== currentModule) {
            // Check if importing internals (anything other than root of module or index.js)
            const subPath = targetParts.slice(1).join("/");
            const isCleanFacade =
              subPath === "" ||
              subPath === "index" ||
              subPath === "index.js";

            if (!isCleanFacade) {
              violations.push({
                file: filePath,
                line: lineIdx + 1,
                currentModule,
                targetModule,
                importPath,
                reason: `Module '${currentModule}' illegally imports internal file of module '${targetModule}'. Only importing '${targetModule}' or '${targetModule}/index.js' is permitted (Facade pattern).`,
              });
            }

            if (subPath.includes("models/")) {
              violations.push({
                file: filePath,
                line: lineIdx + 1,
                currentModule,
                targetModule,
                importPath,
                reason: `Module '${currentModule}' illegally imports model directly from module '${targetModule}'. Cross-module model access is strictly forbidden.`,
              });
            }
          }
        }
      }
    });
  }

  return violations;
}

if (require.main === module) {
  const violations = checkModuleBoundaries();
  if (violations.length > 0) {
    console.error("❌ MODULE BOUNDARY VIOLATIONS DETECTED:\n");
    for (const v of violations) {
      console.error(
        `  • ${path.basename(v.file)}:${v.line} in module '${v.currentModule}'`
      );
      console.error(`    Import: ${v.importPath}`);
      console.error(`    Violation: ${v.reason}\n`);
    }
    process.exit(1);
  } else {
    console.log("✅ All module boundaries are valid. No violations found.");
    process.exit(0);
  }
}

module.exports = { checkModuleBoundaries };
