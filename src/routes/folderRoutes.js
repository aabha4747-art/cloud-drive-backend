const express = require("express");

const {
  createFolder,
  getRootFolders,
  getFolderContents,
  updateFolder,
  deleteFolder,
  restoreFolder,
  permanentlyDeleteFolder,
} = require("../controllers/folderController");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authMiddleware);

router.post("/", createFolder);

router.get("/root", getRootFolders);

router.patch("/:id", updateFolder);

router.delete("/:id", deleteFolder);

router.post("/:id/restore", restoreFolder);

router.delete("/:id/permanent", permanentlyDeleteFolder);

router.get("/:id", getFolderContents);

module.exports = router;