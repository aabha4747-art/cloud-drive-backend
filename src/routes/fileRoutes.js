const express =
  require("express");

const {
  uploadFile,
  uploadFolder,

  // Cloud documents
  createDocument,
  getDocument,
  updateDocumentContent,

  // Cloud spreadsheets
  createSpreadsheet,
  getSpreadsheet,
  updateSpreadsheetContent,

  // Cloud presentations
  createPresentation,
  getPresentation,
  updatePresentationContent,

  // Normal files
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
// These must stay ABOVE "/:id".
// ======================================================

// Create document
router.post(
  "/documents",
  createDocument
);

// Get document
router.get(
  "/documents/:id",
  getDocument
);

// Save document
router.patch(
  "/documents/:id/content",
  updateDocumentContent
);

// ======================================================
// CLOUD SPREADSHEETS
//
// IMPORTANT:
// These must also stay ABOVE "/:id".
// ======================================================

// Create spreadsheet
router.post(
  "/spreadsheets",
  createSpreadsheet
);

// Get spreadsheet
router.get(
  "/spreadsheets/:id",
  getSpreadsheet
);

// Save spreadsheet
router.patch(
  "/spreadsheets/:id/content",
  updateSpreadsheetContent
);

// ======================================================
// CLOUD PRESENTATIONS
//
// IMPORTANT:
// These must also stay ABOVE "/:id".
// ======================================================

// Create presentation
router.post(
  "/presentations",
  createPresentation
);

// Get presentation
router.get(
  "/presentations/:id",
  getPresentation
);

// Save presentation
router.patch(
  "/presentations/:id/content",
  updatePresentationContent
);

// ======================================================
// TRASH
//
// Keep ABOVE "/:id".
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
// KEEP THIS LAST.
// ======================================================

router.get(
  "/:id",
  getFile
);

module.exports =
  router;