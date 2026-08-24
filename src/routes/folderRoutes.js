const express = require("express");

const {
  createFolder,
  createProject,
  getProjects,
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
// CREATE ROUTES
// ======================================================

// Create normal folder
router.post("/", createFolder);

// Create project workspace
router.post("/project", createProject);

// ======================================================
// SPECIAL GET ROUTES
//
// VERY IMPORTANT:
// These routes MUST stay ABOVE "/:id".
//
// Otherwise Express will interpret:
// /projects -> id = "projects"
// /root     -> id = "root"
// ======================================================

// Get all projects
router.get("/projects", getProjects);

// Get My Drive root
router.get("/root", getRootFolders);

// ======================================================
// UPDATE FOLDER
// ======================================================

router.patch("/:id", updateFolder);

// ======================================================
// MOVE TO TRASH
// ======================================================

router.delete("/:id", deleteFolder);

// ======================================================
// RESTORE
// ======================================================

router.post("/:id/restore", restoreFolder);

// ======================================================
// PERMANENT DELETE
// ======================================================

router.delete(
  "/:id/permanent",
  permanentlyDeleteFolder
);

// ======================================================
// GET ONE FOLDER + CONTENTS
//
// THIS MUST ALWAYS STAY LAST.
// ======================================================

router.get("/:id", getFolderContents);

module.exports = router;