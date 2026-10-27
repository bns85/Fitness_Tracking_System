/**
 * ============================================================================
 * SPRINT 1 (WEEK 1 & WEEK 2) - SUHAS COMPLETE TEST RUNNER
 * ============================================================================
 * Member 4: Suhas
 * Roles:
 *   - Story 1 / Week 1: "Test dashboard under slow network conditions"
 *   - Story 2 / Week 2: "Integration test: Sensor - event Bus - notification"
 * ============================================================================
 */

const { runSlowNetworkTests } = require("./testSlowNetwork");
const { runIntegrationTests } = require("./testIntegrationSensorEventNotification");
const { runWorkoutFlowTests } = require("./testWorkoutFlow");

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
};

async function runAll() {
  console.log(`\n${colors.bright}${colors.cyan}************************************************************************${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}    FITNESS TRACKING SYSTEM - SUHAS TEST RUNNER (SPRINT 1 & 2)    ${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}    Member: Suhas (Architecture & Testing Specialist)                  ${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}************************************************************************${colors.reset}\n`);

  const startTime = Date.now();

  console.log(`${colors.bright}>>> RUNNING SUHAS TASK 1: SLOW NETWORK DASHBOARD TESTING (SPRINT 1 - STORY 1)...${colors.reset}\n`);
  const res1 = await runSlowNetworkTests();

  console.log(`\n${colors.bright}>>> RUNNING SUHAS TASK 2: SENSOR-EVENTBUS-NOTIFICATION INTEGRATION (SPRINT 1 - STORY 2)...${colors.reset}\n`);
  const res2 = await runIntegrationTests();

  console.log(`\n${colors.bright}>>> RUNNING SUHAS TASK 3: WORKOUT SESSION FLOW & RECOMMENDATIONS (SPRINT 2 - STORY 3)...${colors.reset}\n`);
  const res3 = await runWorkoutFlowTests();

  const totalPassed = (res1.passedCount || 0) + (res2.passedCount || 0) + (res3.passedCount || 0);
  const totalTests = (res1.totalTests || 0) + (res2.totalTests || 0) + (res3.totalTests || 0);
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n${colors.bright}${colors.cyan}========================================================================${colors.reset}`);
  console.log(`${colors.bright}  FINAL SUMMARY FOR MEMBER 4 (SUHAS) DELIVERABLES${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}========================================================================${colors.reset}`);
  console.log(`  Story 1 (Slow Network Conditions) : ${res1.passedCount}/${res1.totalTests} Passed`);
  console.log(`  Story 2 (Pipeline Integration)    : ${res2.passedCount}/${res2.totalTests} Passed`);
  console.log(`  Story 3 (Workout Session Flow)    : ${res3.passedCount}/${res3.totalTests} Passed`);
  console.log(`  Overall Tests Passed             : ${totalPassed} / ${totalTests}`);
  console.log(`  Total Execution Time             : ${elapsedSec}s`);

  if (totalPassed === totalTests) {
    console.log(`\n  ${colors.bright}${colors.green}🎉 ALL SUHAS TESTING DELIVERABLES COMPLETED & VERIFIED! 🎉${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`\n  ${colors.bright}${colors.red}❌ SOME TESTS DID NOT PASS. PLEASE CHECK LOGS ABOVE. ❌${colors.reset}\n`);
    process.exit(1);
  }
}

runAll();
