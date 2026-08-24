const multer = require("multer");
const path = require("path");

const storage = multer.memoryStorage();

const allowedMimeTypes = [
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",

  // Documents
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",

  // Audio
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",

  // Video
  "video/mp4",
  "video/webm",
  "video/quicktime",

  // Archives
  "application/zip",
  "application/x-zip-compressed",

  // Generic binary
  "application/octet-stream",
];

const allowedExtensions = [
  // Images
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",

  // Documents
  ".pdf",
  ".txt",
  ".csv",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",

  // Audio
  ".mp3",
  ".wav",
  ".ogg",

  // Video
  ".mp4",
  ".webm",
  ".mov",

  // Archives
  ".zip",
];

const fileFilter = (req, file, cb) => {
  const extension = path
    .extname(file.originalname)
    .toLowerCase();

  const mimeAllowed =
    allowedMimeTypes.includes(file.mimetype);

  const extensionAllowed =
    allowedExtensions.includes(extension);

  if (mimeAllowed && extensionAllowed) {
    return cb(null, true);
  }

  return cb(
    new Error(
      `Unsupported file type: ${file.mimetype} (${extension})`
    ),
    false
  );
};

const upload = multer({
  storage,

  limits: {
    // Max size per file = 20 MB
    fileSize: 20 * 1024 * 1024,

    // Max files in one folder upload
    files: 100,
  },

  fileFilter,
});

module.exports = upload;