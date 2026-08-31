const express =
  require("express");

const authMiddleware =
  require(
    "../middleware/authMiddleware"
  );

const {
  getStorageSummary,
} = require(
  "../controllers/storageController"
);

const router =
  express.Router();

// ======================================================
// AUTH
// ======================================================

router.use(
  authMiddleware
);

// ======================================================
// STORAGE SUMMARY
// ======================================================

router.get(
  "/summary",
  getStorageSummary
);

module.exports =
  router;