const express = require("express");

const {
  createShareLink,
  getPublicShare,
  revokeShareLink,
} = require("../controllers/linkShareController");

const authMiddleware =
  require("../middleware/authMiddleware");

const router = express.Router();


// PUBLIC ROUTE
// No JWT required
router.get(
  "/public/:token",
  getPublicShare
);


// PRIVATE ROUTES
// JWT required
router.post(
  "/",
  authMiddleware,
  createShareLink
);

router.delete(
  "/:id",
  authMiddleware,
  revokeShareLink
);


module.exports = router;