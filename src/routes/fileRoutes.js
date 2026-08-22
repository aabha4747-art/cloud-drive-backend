const express = require("express");

const {
  uploadFile,
  getFile,
  updateFile,
  deleteFile,
  getTrash,
  restoreFile,
  permanentlyDeleteFile,
} = require("../controllers/fileController");

const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

const router = express.Router();

router.use(authMiddleware);

router.post(
  "/upload",
  upload.single("file"),
  uploadFile
);

router.get("/trash", getTrash);

router.patch("/:id", updateFile);

router.delete("/:id", deleteFile);

router.post("/:id/restore", restoreFile);

router.delete("/:id/permanent", permanentlyDeleteFile);

router.get("/:id", getFile);

module.exports = router;