const express = require("express");

const {
  toggleFileStar,
  toggleFolderStar,
  getStarredItems,
} = require("../controllers/starController");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authMiddleware);

router.patch("/files/:id", toggleFileStar);
router.patch("/folders/:id", toggleFolderStar);
router.get("/", getStarredItems);

module.exports = router;