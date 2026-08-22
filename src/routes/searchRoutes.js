const express = require("express");

const {
  searchItems,
} = require("../controllers/searchController");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authMiddleware);

router.get("/", searchItems);

module.exports = router;