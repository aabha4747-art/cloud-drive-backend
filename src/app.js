const express =
  require("express");

const cors =
  require("cors");

// ======================================================
// ROUTES
// ======================================================

const authRoutes =
  require(
    "./routes/authRoutes"
  );

const folderRoutes =
  require(
    "./routes/folderRoutes"
  );

const fileRoutes =
  require(
    "./routes/fileRoutes"
  );

const shareRoutes =
  require(
    "./routes/shareRoutes"
  );

const linkShareRoutes =
  require(
    "./routes/linkShareRoutes"
  );

const starRoutes =
  require(
    "./routes/starRoutes"
  );

const recentRoutes =
  require(
    "./routes/recentRoutes"
  );

const searchRoutes =
  require(
    "./routes/searchRoutes"
  );

const geminiRoutes =
  require(
    "./routes/geminiRoutes"
  );

const storageRoutes =
  require(
    "./routes/storageRoutes"
  );

// ======================================================
// APP
// ======================================================

const app =
  express();

// ======================================================
// CORS
// ======================================================

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

// ======================================================
// BODY PARSING
// ======================================================

app.use(
  express.json({
    limit: "10mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  })
);

// ======================================================
// HEALTH CHECK
// ======================================================

app.get(
  "/",
  (
    req,
    res
  ) => {
    return res
      .status(200)
      .json({
        message:
          "Cloud Drive API is running",
      });
  }
);

app.get(
  "/api/health",
  (
    req,
    res
  ) => {
    return res
      .status(200)
      .json({
        success: true,
        message:
          "Cloud Drive backend is healthy",
        timestamp:
          new Date().toISOString(),
      });
  }
);

// ======================================================
// API ROUTES
// ======================================================

app.use(
  "/api/auth",
  authRoutes
);

app.use(
  "/api/folders",
  folderRoutes
);

app.use(
  "/api/files",
  fileRoutes
);

app.use(
  "/api/shares",
  shareRoutes
);

app.use(
  "/api/link-share",
  linkShareRoutes
);

app.use(
  "/api/starred",
  starRoutes
);

app.use(
  "/api/recent",
  recentRoutes
);

app.use(
  "/api/search",
  searchRoutes
);

app.use(
  "/api/gemini",
  geminiRoutes
);

app.use(
  "/api/storage",
  storageRoutes
);

// ======================================================
// 404 HANDLER
// ======================================================

app.use(
  (
    req,
    res
  ) => {
    return res
      .status(404)
      .json({
        error: {
          code:
            "ROUTE_NOT_FOUND",

          message:
            `Route not found: ${req.method} ${req.originalUrl}`,
        },
      });
  }
);

// ======================================================
// GLOBAL ERROR HANDLER
// ======================================================

app.use(
  (
    err,
    req,
    res,
    next
  ) => {
    console.error(
      "Unhandled application error:",
      err
    );

    if (
      err?.name ===
      "MulterError"
    ) {
      return res
        .status(400)
        .json({
          error: {
            code:
              "UPLOAD_ERROR",

            message:
              err.message ||
              "File upload failed",
          },
        });
    }

    if (
      err?.message ===
      "Unsupported file type"
    ) {
      return res
        .status(400)
        .json({
          error: {
            code:
              "UNSUPPORTED_FILE_TYPE",

            message:
              "Unsupported file type",
          },
        });
    }

    return res
      .status(
        err?.status ||
          err?.statusCode ||
          500
      )
      .json({
        error: {
          code:
            err?.code ||
            "INTERNAL_SERVER_ERROR",

          message:
            err?.message ||
            "Something went wrong",
        },
      });
  }
);

// ======================================================
// EXPORT
// ======================================================

module.exports =
  app;