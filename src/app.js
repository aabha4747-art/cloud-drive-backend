const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const folderRoutes = require("./routes/folderRoutes");
const fileRoutes = require("./routes/fileRoutes");
const shareRoutes = require("./routes/shareRoutes");
const searchRoutes = require("./routes/searchRoutes");
const recentRoutes = require("./routes/recentRoutes");
const starRoutes = require("./routes/starRoutes");
const linkShareRoutes = require("./routes/linkShareRoutes");

const storageRoutes =
  require("./routes/storageRoutes");

const app = express();

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(cors());
app.use(express.json());

// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/", (req, res) => {
  res.json({
    message: "Cloud Drive Backend API is running",
  });
});

// ======================================================
// ROUTES
// ======================================================

app.use("/api/auth", authRoutes);

app.use("/api/folders", folderRoutes);

app.use("/api/files", fileRoutes);

app.use("/api/shares", shareRoutes);

app.use("/api/search", searchRoutes);

app.use("/api/recent", recentRoutes);

app.use("/api/starred", starRoutes);

app.use("/api/links", linkShareRoutes);

app.use("/api/storage", storageRoutes);

// ======================================================
// GLOBAL ERROR HANDLER
// ======================================================

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);

  // Multer errors
  if (err.name === "MulterError") {
    return res.status(400).json({
      error: {
        code: "UPLOAD_ERROR",
        message: err.message,
      },
    });
  }

  // Unsupported file type
  if (
    err.message &&
    err.message.startsWith("Unsupported file type")
  ) {
    return res.status(400).json({
      error: {
        code: "UNSUPPORTED_FILE_TYPE",
        message: err.message,
      },
    });
  }

  // Generic error
  return res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong",
    },
  });
});

module.exports = app;