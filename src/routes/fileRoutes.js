const express =
  require("express");

const {
  uploadFile,
  uploadFolder,

  // Cloud documents
  createDocument,
  getDocument,
  updateDocumentContent,

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

// ======================================================
// AUTHENTICATION
// ======================================================

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
// CLOUD DOCUMENTS
//
// IMPORTANT:
// Keep these routes ABOVE "/:id"
// so Express does not treat "documents"
// as a file id.
// ======================================================

// Create a new editable text document
router.post(
  "/documents",
  createDocument
);

// Get editable document + content
router.get(
  "/documents/:id",
  getDocument
);

// Save document content
router.patch(
  "/documents/:id/content",
  updateDocumentContent
);

// ======================================================
// TRASH
//
// Keep this above "/:id" as well.
// ======================================================

router.get(
  "/trash",
  getTrash
);

// ======================================================
// UPDATE / RENAME / MOVE FILE
// ======================================================

router.patch(
  "/:id",
  updateFile
);

// ======================================================
// MOVE FILE TO TRASH
// ======================================================

router.delete(
  "/:id",
  deleteFile
);

// ======================================================
// RESTORE FILE
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
// GET NORMAL FILE
//
// IMPORTANT:
// Keep this LAST because "/:id"
// matches almost anything.
// ======================================================

router.get(
  "/:id",
  getFile
);

module.exports =
  router;