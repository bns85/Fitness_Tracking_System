# Keeping Modules Modular: Boundary Enforcement Guide

Author: Suhas (Modular Monolith Lead)

## 1. Why the Module Boundary Rule Exists

In a traditional monolith, code often degrades over time into an unmaintainable "Big Ball of Mud":
- Module A starts reaching into Module B's database models.
- Module C executes joins across collections it does not own.
- Changes in one module cause unexpected runtime failures in seemingly unrelated modules.

In PulseFlow's Modular Monolith, we enforce strict architectural boundaries:
1. **Encapsulation via Facades (Facade Pattern):** Each domain module (`telemetry`, `goals`, `notifications`, `workouts`, `recommendations`, `dashboard`) provides its public interface exclusively through its root `index.js`.
2. **Data Ownership (Repository Pattern):** Each module owns its models and database collections (`telemetry_*`, `goals_*`, `notifications_*`, `workouts_*`). No cross-module database queries or joins are permitted.
3. **Microservice Readiness:** Because modules only communicate through well-defined function calls and schemas, any module can be extracted into an independent microservice in the future without changing business logic.

---

## 2. How the Module Checker (`check-modules.js`) Works

The script `scripts/check-modules.js` is a zero-dependency linter integrated into `npm test` and CI pipelines:
- It traverses every `.js` file under `src/modules/**`.
- It identifies the module to which the file belongs.
- It parses all `require(...)` declarations and resolves their target paths.
- It validates two strict rules:
  1. **Facade Only Rule:** If module X imports from module Y (where `X !== Y`), the import path must resolve strictly to `modules/Y` or `modules/Y/index.js`. Importing internal helpers, repositories, or subdirectories of Y is flagged as a violation.
  2. **No Direct Model Access:** Any direct import of `models/` belonging to another module is flagged as a severe architecture violation.
- If any violations are found, the script prints line-numbered violations and exits with code `1`, failing the build.

---

## 3. How to Fix a Module Violation

### Violation Example 1: Importing Internal Helper
```javascript
// ❌ BAD (in src/modules/dashboard/dashboardService.js)
const telemetryRepo = require("../telemetry/telemetryRepository");
```

**Fix:**
Expose the required method in `src/modules/telemetry/index.js`:
```javascript
// in src/modules/telemetry/index.js
async function getLatestActivity(userId) {
  return await telemetryRepository.getLatestActivity(userId);
}
module.exports = { getLatestActivity, ... };
```
Then import only the facade:
```javascript
// ✅ GOOD (in src/modules/dashboard/dashboardService.js)
const telemetry = require("../telemetry");
const activity = await telemetry.getLatestActivity(userId);
```

### Violation Example 2: Importing Another Module's Model
```javascript
// ❌ BAD (in src/modules/goals/goalProgress.js)
const TelemetryData = require("../telemetry/models/TelemetryData");
```

**Fix:**
Never perform cross-module Mongoose queries. Instead, request the calculated aggregate from the owning module's facade:
```javascript
// ✅ GOOD (in src/modules/goals/index.js)
const telemetry = require("../telemetry");
const totals = await telemetry.activityTotalsByUser(bounds, userId);
```
