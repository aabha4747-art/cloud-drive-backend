const express = require("express");

const {
  createFolder,
  createProject,
  getRootFolders,
  getFolderContents,
  updateFolder,
  deleteFolder,
  restoreFolder,
  permanentlyDeleteFolder,
} = require("../controllers/folderController");

const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// ======================================================
// AUTHENTICATION
// ======================================================

router.use(authMiddleware);

// ======================================================
// CREATE
// ======================================================

// Create normal folder
router.post("/", createFolder);

// Create project with default subfolders
router.post("/project", createProject);

// ======================================================
// GET
// ======================================================

// Get My Drive root contents
router.get("/root", getRootFolders);

// ======================================================
// UPDATE
// ======================================================

// Rename / move folder
router.patch("/:id", updateFolder);

// ======================================================
// TRASH
// ======================================================

// Move folder to Trash
router.delete("/:id", deleteFolder);

// Restore folder from Trash
router.post("/:id/restore", restoreFolder);

// Permanently delete folder and its contents
router.delete(
  "/:id/permanent",
  permanentlyDeleteFolder
);

// ======================================================
// GET FOLDER CONTENTS
// IMPORTANT:
// Keep this after specific routes such as /root and /project
// ======================================================

router.get("/:id", getFolderContents);

module.exports = router;