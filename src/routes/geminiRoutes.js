const express =
  require("express");

const {
  askGemini,
} = require(
  "../controllers/geminiController"
);

const authMiddleware =
  require(
    "../middleware/authMiddleware"
  );

const router =
  express.Router();

router.use(
  authMiddleware
);

router.post(
  "/ask",
  askGemini
);

module.exports =
  router;