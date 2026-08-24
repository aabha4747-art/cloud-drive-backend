const express =
  require("express");

const {
  uploadFile,
  uploadFolder,
  getFile,
  updateFile,
  deleteFile,
  getTrash,
  restoreFile,
  permanentlyDeleteFile,
} = require(
  "../controllers/fileController"
);

const authMiddleware =
  require(
    "../middleware/authMiddleware"
  );

const upload =
  require(
    "../middleware/uploadMiddleware"
  );

const router =
  express.Router();

router.use(
  authMiddleware
);

// ======================================================
// SINGLE FILE UPLOAD
// ======================================================

router.post(
  "/upload",
  upload.single("file"),
  uploadFile
);

// ======================================================
// FOLDER UPLOAD
// ======================================================

router.post(
  "/upload-folder",
  upload.array(
    "files",
    100
  ),
  uploadFolder
);

// ======================================================
// TRASH
// ======================================================

router.get(
  "/trash",
  getTrash
);

// ======================================================
// UPDATE
// ======================================================

router.patch(
  "/:id",
  updateFile
);

// ======================================================
// DELETE
// ======================================================

router.delete(
  "/:id",
  deleteFile
);

// ======================================================
// RESTORE
// ======================================================

router.post(
  "/:id/restore",
  restoreFile
);

// ======================================================
// PERMANENT DELETE
// ======================================================

router.delete(
  "/:id/permanent",
  permanentlyDeleteFile
);

// ======================================================
// GET FILE
// ======================================================

router.get(
  "/:id",
  getFile
);

module.exports =
  router;