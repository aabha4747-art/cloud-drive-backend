const express = require("express");

const {
  getStorageSummary,
} = require("../controllers/storageController");

const authMiddleware = require("../middleware/authMiddleware");

const router =
  express.Router();

router.use(
  authMiddleware
);

router.get(
  "/",
  getStorageSummary
);

module.exports =
  router;