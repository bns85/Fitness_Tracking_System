const express = require("express");
const { getDashboardSummary } = require("../controllers/dashboardController");

const router = express.Router();

router.get("/dashboard/:userId", getDashboardSummary);

module.exports = router;
