const express = require("express");

const {
  createFolder,
  getRootFolders,
  getFolderContents,
  updateFolder,
  deleteFolder,
} = require("../controllers/folderController");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authMiddleware);

router.post("/", createFolder);
router.get("/root", getRootFolders);
router.get("/:id", getFolderContents);
router.patch("/:id", updateFolder);
router.delete("/:id", deleteFolder);

module.exports = router;