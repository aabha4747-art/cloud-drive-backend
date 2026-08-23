const supabase = require("../config/supabase");

// ======================================================
// HELPERS
// ======================================================

const DEFAULT_STORAGE_LIMIT_BYTES =
  1024 * 1024 * 1024; // 1 GB

const formatPercent = (
  usedBytes,
  limitBytes
) => {
  if (!limitBytes) {
    return 0;
  }

  return Math.min(
    100,
    Number(
      (
        (usedBytes /
          limitBytes) *
        100
      ).toFixed(2)
    )
  );
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
    // ACTIVE FILES
    // --------------------------------------------------

    const {
      data: activeFiles,
      error:
        activeFilesError,
    } = await supabase
      .from("files")
      .select(
        "id, name, mime_type, size_bytes, folder_id, created_at, updated_at"
      )
      .eq(
        "owner_id",
        userId
      )
      .eq(
        "is_deleted",
        false
      );

    if (activeFilesError) {
      throw activeFilesError;
    }

    // --------------------------------------------------
    // TRASHED FILES
    // --------------------------------------------------

    const {
      data: trashedFiles,
      error:
        trashedFilesError,
    } = await supabase
      .from("files")
      .select(
        "id, name, size_bytes"
      )
      .eq(
        "owner_id",
        userId
      )
      .eq(
        "is_deleted",
        true
      );

    if (
      trashedFilesError
    ) {
      throw trashedFilesError;
    }

    const safeActiveFiles =
      activeFiles || [];

    const safeTrashedFiles =
      trashedFiles || [];

    // --------------------------------------------------
    // CALCULATIONS
    // --------------------------------------------------

    const activeBytes =
      safeActiveFiles.reduce(
        (total, file) =>
          total +
          Number(
            file.size_bytes ||
              0
          ),
        0
      );

    const trashBytes =
      safeTrashedFiles.reduce(
        (total, file) =>
          total +
          Number(
            file.size_bytes ||
              0
          ),
        0
      );

    const totalUsedBytes =
      activeBytes +
      trashBytes;

    const storageLimitBytes =
      Number(
        process.env
          .USER_STORAGE_LIMIT_BYTES
      ) ||
      DEFAULT_STORAGE_LIMIT_BYTES;

    const remainingBytes =
      Math.max(
        0,
        storageLimitBytes -
          totalUsedBytes
      );

    // --------------------------------------------------
    // LARGEST FILES
    // --------------------------------------------------

    const largestFiles =
      [...safeActiveFiles]
        .sort(
          (a, b) =>
            Number(
              b.size_bytes ||
                0
            ) -
            Number(
              a.size_bytes ||
                0
            )
        )
        .slice(0, 5)
        .map((file) => ({
          id: file.id,
          name: file.name,

          mimeType:
            file.mime_type,

          sizeBytes:
            Number(
              file.size_bytes ||
                0
            ),

          folderId:
            file.folder_id,

          createdAt:
            file.created_at,

          updatedAt:
            file.updated_at,
        }));

    // --------------------------------------------------
    // MIME BREAKDOWN
    // --------------------------------------------------

    const typeMap = {};

    for (
      const file
      of safeActiveFiles
    ) {
      const mimeType =
        file.mime_type ||
        "unknown";

      if (!typeMap[mimeType]) {
        typeMap[mimeType] = {
          mimeType,
          fileCount: 0,
          sizeBytes: 0,
        };
      }

      typeMap[
        mimeType
      ].fileCount += 1;

      typeMap[
        mimeType
      ].sizeBytes +=
        Number(
          file.size_bytes ||
            0
        );
    }

    const storageByType =
      Object.values(
        typeMap
      ).sort(
        (a, b) =>
          b.sizeBytes -
          a.sizeBytes
      );

    // --------------------------------------------------
    // RESPONSE
    // --------------------------------------------------

    return res
      .status(200)
      .json({
        storage: {
          usedBytes:
            totalUsedBytes,

          activeBytes,

          trashBytes,

          limitBytes:
            storageLimitBytes,

          remainingBytes,

          usagePercent:
            formatPercent(
              totalUsedBytes,
              storageLimitBytes
            ),
        },

        counts: {
          activeFiles:
            safeActiveFiles.length,

          trashedFiles:
            safeTrashedFiles.length,

          totalFiles:
            safeActiveFiles.length +
            safeTrashedFiles.length,
        },

        largestFiles,

        storageByType,
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
            "Unable to fetch storage usage",
        },
      });
  }
};

module.exports = {
  getStorageSummary,
};