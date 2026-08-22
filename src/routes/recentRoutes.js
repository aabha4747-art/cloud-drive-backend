const express = require("express");

const {
  getRecentFiles,
} = require("../controllers/recentController");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authMiddleware);

router.get("/", getRecentFiles);

module.exports = router;