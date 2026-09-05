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

const {
  getFileVersions,
  uploadNewFileVersion,
  getArchivedVersionDownloadUrl,
} = require(
  "../controllers/fileVersionController"
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
// Keep ABOVE "/:id".
// ======================================================

router.post(
  "/documents",
  createDocument
);

router.get(
  "/documents/:id",
  getDocument
);

router.patch(
  "/documents/:id/content",
  updateDocumentContent
);

// ======================================================
// CLOUD SPREADSHEETS
//
// IMPORTANT:
// Keep ABOVE "/:id".
// ======================================================

router.post(
  "/spreadsheets",
  createSpreadsheet
);

router.get(
  "/spreadsheets/:id",
  getSpreadsheet
);

router.patch(
  "/spreadsheets/:id/content",
  updateSpreadsheetContent
);

// ======================================================
// CLOUD PRESENTATIONS
//
// IMPORTANT:
// Keep ABOVE "/:id".
// ======================================================

router.post(
  "/presentations",
  createPresentation
);

router.get(
  "/presentations/:id",
  getPresentation
);

router.patch(
  "/presentations/:id/content",
  updatePresentationContent
);

// ======================================================
// TRASH
//
// IMPORTANT:
// Keep ABOVE "/:id".
// ======================================================

router.get(
  "/trash",
  getTrash
);

// ======================================================
// FILE VERSION HISTORY
//
// GET = list versions
// POST = upload new version
// ======================================================

router.get(
  "/:id/versions",
  getFileVersions
);

router.post(
  "/:id/versions",
  upload.single(
    "file"
  ),
  uploadNewFileVersion
);

// ======================================================
// GET OLD VERSION DOWNLOAD URL
// ======================================================

router.get(
  "/:id/versions/:versionId",
  getArchivedVersionDownloadUrl
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