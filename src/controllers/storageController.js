const supabase = require("../config/supabase");

// ======================================================
// STORAGE CONFIG
// ======================================================

// Default = 5 GB per user.
//
// Later you can put this in Render / .env:
//
// STORAGE_QUOTA_BYTES=5368709120
//
const DEFAULT_STORAGE_QUOTA =
  5 * 1024 * 1024 * 1024;

// ======================================================
// HELPERS
// ======================================================

const safeNumber = (value) => {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }

  return number;
};

const getStorageQuota = () => {
  const configuredQuota =
    safeNumber(
      process.env.STORAGE_QUOTA_BYTES
    );

  return configuredQuota > 0
    ? configuredQuota
    : DEFAULT_STORAGE_QUOTA;
};

// ======================================================
// CATEGORY DETECTION
// ======================================================

const getFileCategory = (file) => {
  const mimeType =
    String(
      file.mime_type || ""
    ).toLowerCase();

  const fileKind =
    String(
      file.file_kind || "file"
    ).toLowerCase();

  // Cloud-native files
  if (
    fileKind === "document" ||
    fileKind === "spreadsheet" ||
    fileKind === "presentation"
  ) {
    return "documents";
  }

  // Images
  if (
    mimeType.startsWith("image/")
  ) {
    return "images";
  }

  // Videos
  if (
    mimeType.startsWith("video/")
  ) {
    return "videos";
  }

  // Audio
  if (
    mimeType.startsWith("audio/")
  ) {
    return "audio";
  }

  // PDFs / Word / Excel / PowerPoint / text
  if (
    mimeType === "application/pdf" ||
    mimeType.startsWith("text/") ||
    mimeType.includes("word") ||
    mimeType.includes("document") ||
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    mimeType.includes("presentation") ||
    mimeType.includes("powerpoint") ||
    mimeType.includes("officedocument")
  ) {
    return "documents";
  }

  // Compressed files
  if (
    mimeType.includes("zip") ||
    mimeType.includes("rar") ||
    mimeType.includes("7z") ||
    mimeType.includes("compressed") ||
    mimeType.includes("archive") ||
    mimeType.includes("gzip")
  ) {
    return "archives";
  }

  return "other";
};

// ======================================================
// GET STORAGE SUMMARY
// ======================================================

const getStorageSummary = async (
  req,
  res
) => {
  try {
    const userId =
      req.user.id;

    // --------------------------------------------------
    // GET ALL FILE RECORDS
    //
    // IMPORTANT:
    // We intentionally DO NOT filter is_deleted.
    //
    // Files in Trash still consume storage, similar to
    // Google Drive. Only permanent deletion frees space.
    // --------------------------------------------------

    const {
      data: files,
      error,
    } = await supabase
      .from("files")
      .select(`
        id,
        name,
        mime_type,
        file_kind,
        size_bytes,
        folder_id,
        is_deleted,
        created_at,
        updated_at
      `)
      .eq(
        "owner_id",
        userId
      );

    if (error) {
      throw error;
    }

    const safeFiles =
      Array.isArray(files)
        ? files
        : [];

    // --------------------------------------------------
    // TOTAL STORAGE
    // --------------------------------------------------

    let usedBytes = 0;
    let activeBytes = 0;
    let trashBytes = 0;

    let activeFileCount = 0;
    let trashFileCount = 0;

    const categories = {
      documents: {
        bytes: 0,
        count: 0,
      },

      images: {
        bytes: 0,
        count: 0,
      },

      videos: {
        bytes: 0,
        count: 0,
      },

      audio: {
        bytes: 0,
        count: 0,
      },

      archives: {
        bytes: 0,
        count: 0,
      },

      other: {
        bytes: 0,
        count: 0,
      },
    };

    // --------------------------------------------------
    // PROCESS FILES
    // --------------------------------------------------

    for (
      const file
      of safeFiles
    ) {
      const sizeBytes =
        safeNumber(
          file.size_bytes
        );

      usedBytes +=
        sizeBytes;

      if (file.is_deleted) {
        trashBytes +=
          sizeBytes;

        trashFileCount +=
          1;
      } else {
        activeBytes +=
          sizeBytes;

        activeFileCount +=
          1;
      }

      const category =
        getFileCategory(
          file
        );

      categories[
        category
      ].bytes +=
        sizeBytes;

      categories[
        category
      ].count +=
        1;
    }

    // --------------------------------------------------
    // QUOTA
    // --------------------------------------------------

    const quotaBytes =
      getStorageQuota();

    const availableBytes =
      Math.max(
        quotaBytes -
          usedBytes,
        0
      );

    const percentageUsed =
      quotaBytes > 0
        ? Math.min(
            (usedBytes /
              quotaBytes) *
              100,
            100
          )
        : 0;

    const isFull =
      usedBytes >=
      quotaBytes;

    // --------------------------------------------------
    // LARGEST FILES
    // --------------------------------------------------

    const largestFiles =
      [...safeFiles]
        .sort(
          (a, b) =>
            safeNumber(
              b.size_bytes
            ) -
            safeNumber(
              a.size_bytes
            )
        )
        .slice(
          0,
          50
        )
        .map(
          (file) => ({
            id:
              file.id,

            name:
              file.name,

            mimeType:
              file.mime_type,

            fileKind:
              file.file_kind,

            sizeBytes:
              safeNumber(
                file.size_bytes
              ),

            folderId:
              file.folder_id,

            isDeleted:
              Boolean(
                file.is_deleted
              ),

            category:
              getFileCategory(
                file
              ),

            createdAt:
              file.created_at,

            updatedAt:
              file.updated_at,
          })
        );

    // --------------------------------------------------
    // CATEGORY ARRAY
    // --------------------------------------------------

    const categoryBreakdown =
      Object.entries(
        categories
      ).map(
        ([
          key,
          value,
        ]) => ({
          category:
            key,

          bytes:
            value.bytes,

          count:
            value.count,

          percentage:
            usedBytes > 0
              ? (
                  value.bytes /
                  usedBytes
                ) *
                100
              : 0,
        })
      );

    // --------------------------------------------------
    // RESPONSE
    // --------------------------------------------------

    return res
      .status(200)
      .json({
        storage: {
          quotaBytes,

          usedBytes,

          availableBytes,

          percentageUsed:
            Number(
              percentageUsed.toFixed(
                2
              )
            ),

          isFull,

          active: {
            bytes:
              activeBytes,

            fileCount:
              activeFileCount,
          },

          trash: {
            bytes:
              trashBytes,

            fileCount:
              trashFileCount,
          },

          totalFileCount:
            safeFiles.length,
        },

        categories:
          categoryBreakdown,

        largestFiles,
      });
  } catch (error) {
    console.error(
      "Get storage summary error:",
      error
    );

    return res
      .status(500)
      .json({
        error: {
          code:
            "INTERNAL_SERVER_ERROR",

          message:
            "Unable to calculate storage usage",
        },
      });
  }
};

// ======================================================
// EXPORTS
// ======================================================

module.exports = {
  getStorageSummary,
};