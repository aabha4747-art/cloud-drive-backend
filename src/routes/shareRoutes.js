const express = require("express");

const {
  createShare,
  getSharedWithMe,
  getSharesForItem,
  updateSharePermission,
  revokeShare,
} = require("../controllers/shareController");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authMiddleware);

router.post("/", createShare);

router.get("/shared-with-me", getSharedWithMe);

router.get("/", getSharesForItem);

router.patch("/:id", updateSharePermission);

router.delete("/:id", revokeShare);

module.exports = router;