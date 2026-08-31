const supabase = require("../config/supabase");

// ======================================================
// HELPERS
// ======================================================

const getFileExtension = (name = "") => {
  const cleanName = String(name)
    .toLowerCase()
    .trim();

  const lastDot = cleanName.lastIndexOf(".");

  if (
    lastDot <= 0 ||
    lastDot === cleanName.length - 1
  ) {
    return "";
  }

  return cleanName.slice(lastDot + 1);
};

const getFileTypeKey = (file) => {
  // ----------------------------------------------------
  // CLOUD-NATIVE FILES
  // ----------------------------------------------------

  if (file.file_kind === "document") {
    return "document";
  }

  if (file.file_kind === "spreadsheet") {
    return "spreadsheet";
  }

  if (file.file_kind === "presentation") {
    return "presentation";
  }

  // ----------------------------------------------------
  // REGULAR UPLOADED FILES
  // ----------------------------------------------------

  const extension = getFileExtension(file.name);

  const mimeType = String(
    file.mime_type || ""
  ).toLowerCase();

  // PDF
  if (
    extension === "pdf" ||
    mimeType === "application/pdf"
  ) {
    return "pdf";
  }

  // Word
  if (
    ["doc", "docx", "odt", "rtf"].includes(extension) ||
    mimeType.includes("word") ||
    mimeType.includes("wordprocessingml")
  ) {
    return "word";
  }

  // Excel
  if (
    [
      "xls",
      "xlsx",
      "xlsm",
      "ods",
      "csv",
    ].includes(extension) ||
    mimeType.includes("excel") ||
    mimeType.includes("spreadsheetml") ||
    mimeType === "text/csv"
  ) {
    return "excel";
  }

  // PowerPoint
  if (
    [
      "ppt",
      "pptx",
      "pptm",
      "odp",
    ].includes(extension) ||
    mimeType.includes("powerpoint") ||
    mimeType.includes("presentationml")
  ) {
    return "powerpoint";
  }

  // Images
  if (
    [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "webp",
      "bmp",
      "svg",
      "tif",
      "tiff",
      "heic",
    ].includes(extension) ||
    mimeType.startsWith("image/")
  ) {
    return "image";
  }

  // Videos
  if (
    [
      "mp4",
      "mov",
      "avi",
      "mkv",
      "webm",
      "m4v",
      "mpeg",
      "mpg",
    ].includes(extension) ||
    mimeType.startsWith("video/")
  ) {
    return "video";
  }

  // Audio
  if (
    [
      "mp3",
      "wav",
      "m4a",
      "aac",
      "flac",
      "ogg",
    ].includes(extension) ||
    mimeType.startsWith("audio/")
  ) {
    return "audio";
  }

  // Archives
  if (
    [
      "zip",
      "rar",
      "7z",
      "tar",
      "gz",
      "bz2",
    ].includes(extension) ||
    mimeType.includes("zip") ||
    mimeType.includes("compressed") ||
    mimeType.includes("archive")
  ) {
    return "archive";
  }

  // Code
  if (
    [
      "js",
      "jsx",
      "ts",
      "tsx",
      "py",
      "java",
      "c",
      "cpp",
      "h",
      "hpp",
      "cs",
      "go",
      "rs",
      "php",
      "rb",
      "swift",
      "kt",
      "kts",
      "html",
      "htm",
      "css",
      "scss",
      "sass",
      "less",
      "json",
      "xml",
      "yaml",
      "yml",
      "sql",
      "sh",
      "bash",
    ].includes(extension)
  ) {
    return "code";
  }

  // Text
  if (
    [
      "txt",
      "md",
      "log",
    ].includes(extension) ||
    mimeType.startsWith("text/")
  ) {
    return "text";
  }

  return "other";
};

// ======================================================
// SEARCH
// ======================================================

const searchItems = async (req, res) => {
  try {
    const ownerId = req.user.id;

    const {
      q = "",
      type = "all",
      sortBy = "name",
      order = "asc",
    } = req.query;

    const searchTerm = q.trim();

    // --------------------------------------------------
    // ALLOWED FILTER TYPES
    // --------------------------------------------------

    const allowedTypes = [
      "all",

      "folder",
      "project",

      "document",
      "spreadsheet",
      "presentation",

      "pdf",
      "word",
      "excel",
      "powerpoint",

      "image",
      "video",
      "audio",

      "archive",
      "text",
      "code",

      "other",
    ];

    const allowedSortFields = [
      "name",
      "created_at",
      "updated_at",
    ];

    const allowedOrders = [
      "asc",
      "desc",
    ];

    // --------------------------------------------------
    // VALIDATION
    // --------------------------------------------------

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        error: {
          code: "INVALID_TYPE",
          message: "Invalid search type.",
        },
      });
    }

    if (!allowedSortFields.includes(sortBy)) {
      return res.status(400).json({
        error: {
          code: "INVALID_SORT_FIELD",
          message: "Invalid sort field",
        },
      });
    }

    if (!allowedOrders.includes(order)) {
      return res.status(400).json({
        error: {
          code: "INVALID_SORT_ORDER",
          message: "order must be asc or desc",
        },
      });
    }

    const ascending = order === "asc";

    let files = [];
    let folders = [];

    // --------------------------------------------------
    // DETERMINE WHAT WE NEED TO LOAD
    // --------------------------------------------------

    const shouldLoadFiles =
      type === "all" ||
      !["folder", "project"].includes(type);

    const shouldLoadFolders =
      type === "all" ||
      type === "folder" ||
      type === "project";

    // ==================================================
    // FILE SEARCH
    // ==================================================

    if (shouldLoadFiles) {
      let fileQuery = supabase
        .from("files")
        .select(
          `
          id,
          name,
          mime_type,
          file_kind,
          size_bytes,
          owner_id,
          folder_id,
          created_at,
          updated_at
          `
        )
        .eq("owner_id", ownerId)
        .eq("is_deleted", false);

      // Search by name
      if (searchTerm) {
        fileQuery = fileQuery.ilike(
          "name",
          `%${searchTerm}%`
        );
      }

      // Sorting
      fileQuery = fileQuery.order(
        sortBy,
        {
          ascending,
        }
      );

      const {
        data,
        error,
      } = await fileQuery;

      if (error) {
        throw error;
      }

      // ------------------------------------------------
      // FILTER FILES BY THEIR ACTUAL TYPE
      // ------------------------------------------------

      const matchingFiles =
        type === "all"
          ? data || []
          : (data || []).filter(
              (file) =>
                getFileTypeKey(file) === type
            );

      // ------------------------------------------------
      // FORMAT RESPONSE
      // ------------------------------------------------

      files = matchingFiles.map(
        (file) => ({
          resourceType: "file",

          id: file.id,

          name: file.name,

          mimeType: file.mime_type,

          fileKind: file.file_kind,

          fileType: getFileTypeKey(file),

          sizeBytes: file.size_bytes,

          ownerId: file.owner_id,

          folderId: file.folder_id,

          createdAt: file.created_at,

          updatedAt: file.updated_at,
        })
      );
    }

    // ==================================================
    // FOLDER / PROJECT SEARCH
    // ==================================================

    if (shouldLoadFolders) {
      let folderQuery = supabase
        .from("folders")
        .select(
          `
          id,
          name,
          owner_id,
          parent_id,
          is_project,
          created_at,
          updated_at
          `
        )
        .eq("owner_id", ownerId)
        .eq("is_deleted", false);

      // Search by name
      if (searchTerm) {
        folderQuery = folderQuery.ilike(
          "name",
          `%${searchTerm}%`
        );
      }

      // ------------------------------------------------
      // NORMAL FOLDERS ONLY
      // ------------------------------------------------

      if (type === "folder") {
        folderQuery = folderQuery.eq(
          "is_project",
          false
        );
      }

      // ------------------------------------------------
      // PROJECTS ONLY
      // ------------------------------------------------

      if (type === "project") {
        folderQuery = folderQuery.eq(
          "is_project",
          true
        );
      }

      // Sorting
      folderQuery = folderQuery.order(
        sortBy,
        {
          ascending,
        }
      );

      const {
        data,
        error,
      } = await folderQuery;

      if (error) {
        throw error;
      }

      // ------------------------------------------------
      // FORMAT RESPONSE
      // ------------------------------------------------

      folders = (data || []).map(
        (folder) => ({
          resourceType: "folder",

          id: folder.id,

          name: folder.name,

          ownerId: folder.owner_id,

          parentId: folder.parent_id,

          isProject: Boolean(
            folder.is_project
          ),

          createdAt: folder.created_at,

          updatedAt: folder.updated_at,
        })
      );
    }

    // ==================================================
    // RESPONSE
    // ==================================================

    return res.status(200).json({
      query: searchTerm,

      type,

      total:
        files.length +
        folders.length,

      files,

      folders,
    });
  } catch (error) {
    console.error(
      "Search error:",
      error
    );

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to search items",
      },
    });
  }
};

module.exports = {
  searchItems,
};