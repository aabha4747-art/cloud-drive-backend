const supabase = require("../config/supabase");

const {
  buildStoragePath,
  uploadFileToStorage,
  createSignedDownloadUrl,
  deleteFileFromStorage,
} = require("../services/storageService");

const bucketName =
  process.env.SUPABASE_STORAGE_BUCKET;

// ======================================================
// HELPER: CHECK SHARED FOLDER PERMISSION
// ======================================================

const getInheritedFolderPermission = async ({
  folderId,
  userId,
}) => {
  let currentFolderId = folderId;

  const visited = new Set();

  while (currentFolderId) {
    if (visited.has(currentFolderId)) {
      break;
    }

    visited.add(currentFolderId);

    const {
      data: share,
      error: shareError,
    } = await supabase
      .from("shares")
      .select("id, permission")
      .eq("folder_id", currentFolderId)
      .eq("shared_with_id", userId)
      .maybeSingle();

    if (shareError) {
      throw shareError;
    }

    if (share) {
      return share.permission;
    }

    const {
      data: folder,
      error: folderError,
    } = await supabase
      .from("folders")
      .select("id, parent_id, is_deleted")
      .eq("id", currentFolderId)
      .maybeSingle();

    if (folderError) {
      throw folderError;
    }

    if (!folder || folder.is_deleted) {
      return null;
    }

    currentFolderId = folder.parent_id;
  }

  return null;
};

// ======================================================
// HELPER: GET FILE ACCESS
// ======================================================

const getFileAccess = async ({
  file,
  userId,
}) => {
  if (!file) {
    return {
      hasAccess: false,
      permission: null,
      accessType: null,
    };
  }

  // OWNER
  if (file.owner_id === userId) {
    return {
      hasAccess: true,
      permission: "owner",
      accessType: "owner",
    };
  }

  // DIRECT FILE SHARE
  const {
    data: directShare,
    error: directShareError,
  } = await supabase
    .from("shares")
    .select("id, permission")
    .eq("file_id", file.id)
    .eq("shared_with_id", userId)
    .maybeSingle();

  if (directShareError) {
    throw directShareError;
  }

  if (directShare) {
    return {
      hasAccess: true,
      permission: directShare.permission,
      accessType: "direct-file-share",
    };
  }

  // INHERITED FROM SHARED FOLDER
  if (file.folder_id) {
    const inheritedPermission =
      await getInheritedFolderPermission({
        folderId: file.folder_id,
        userId,
      });

    if (inheritedPermission) {
      return {
        hasAccess: true,
        permission: inheritedPermission,
        accessType: "shared-folder",
      };
    }
  }

  return {
    hasAccess: false,
    permission: null,
    accessType: null,
  };
};

// ======================================================
// HELPER: VALIDATE TARGET FOLDER
// OWNER ONLY
// ======================================================

const validateOwnedTargetFolder = async ({
  folderId,
  ownerId,
}) => {
  if (!folderId) {
    return {
      valid: true,
      folder: null,
      status: null,
      error: null,
    };
  }

  const {
    data: folder,
    error,
  } = await supabase
    .from("folders")
    .select("id, owner_id, is_deleted")
    .eq("id", folderId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!folder) {
    return {
      valid: false,
      folder: null,
      status: 404,
      error: {
        code: "FOLDER_NOT_FOUND",
        message: "Target folder not found",
      },
    };
  }

  if (
    folder.owner_id !== ownerId ||
    folder.is_deleted
  ) {
    return {
      valid: false,
      folder,
      status: 403,
      error: {
        code: "FORBIDDEN",
        message:
          "You cannot add files to this folder",
      },
    };
  }

  return {
    valid: true,
    folder,
    status: null,
    error: null,
  };
};

// ======================================================
// UPLOAD SINGLE FILE
// ======================================================

const uploadFile = async (req, res) => {
  let uploadedStoragePath = null;

  try {
    const ownerId = req.user.id;

    const folderId =
      req.body.folderId || null;

    if (!req.file) {
      return res.status(400).json({
        error: {
          code: "FILE_REQUIRED",
          message:
            "Please select a file to upload",
        },
      });
    }

    const targetValidation =
      await validateOwnedTargetFolder({
        folderId,
        ownerId,
      });

    if (!targetValidation.valid) {
      return res
        .status(targetValidation.status)
        .json({
          error: targetValidation.error,
        });
    }

    const storagePath =
      buildStoragePath({
        ownerId,
        folderId,
        originalName:
          req.file.originalname,
      });

    uploadedStoragePath =
      storagePath;

    await uploadFileToStorage({
      buffer: req.file.buffer,
      storagePath,
      mimeType: req.file.mimetype,
    });

    const {
      data: file,
      error: insertError,
    } = await supabase
      .from("files")
      .insert({
        name: req.file.originalname,
        mime_type: req.file.mimetype,
        file_kind: "file",
        size_bytes: req.file.size,
        storage_path: storagePath,
        owner_id: ownerId,
        folder_id: folderId,
      })
      .select(
        `
        id,
        name,
        mime_type,
        file_kind,
        size_bytes,
        storage_path,
        owner_id,
        folder_id,
        is_deleted,
        is_starred,
        created_at,
        updated_at
        `
      )
      .single();

    if (insertError) {
      await deleteFileFromStorage(
        storagePath
      );

      throw insertError;
    }

    return res.status(201).json({
      message:
        "File uploaded successfully",

      file: {
        id: file.id,
        name: file.name,

        mimeType:
          file.mime_type,

        fileKind:
          file.file_kind,

        sizeBytes:
          file.size_bytes,

        ownerId:
          file.owner_id,

        folderId:
          file.folder_id,

        isDeleted:
          file.is_deleted,

        isStarred:
          file.is_starred,

        createdAt:
          file.created_at,

        updatedAt:
          file.updated_at,
      },
    });
  } catch (error) {
    console.error(
      "Upload file error:",
      error
    );

    if (uploadedStoragePath) {
      try {
        await deleteFileFromStorage(
          uploadedStoragePath
        );
      } catch (cleanupError) {
        console.error(
          "Upload cleanup error:",
          cleanupError
        );
      }
    }

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to upload file",
      },
    });
  }
};

// ======================================================
// UPLOAD COMPLETE FOLDER
// ======================================================

const uploadFolder = async (
  req,
  res
) => {
  const uploadedStoragePaths = [];

  try {
    const ownerId = req.user.id;

    const parentFolderId =
      req.body.parentFolderId ||
      null;

    const files =
      req.files || [];

    let relativePaths = [];

    try {
      relativePaths =
        JSON.parse(
          req.body.relativePaths ||
            "[]"
        );
    } catch {
      return res.status(400).json({
        error: {
          code:
            "INVALID_RELATIVE_PATHS",

          message:
            "Invalid folder structure information",
        },
      });
    }

    if (files.length === 0) {
      return res.status(400).json({
        error: {
          code: "FILES_REQUIRED",
          message:
            "No files were selected",
        },
      });
    }

    if (
      relativePaths.length !==
      files.length
    ) {
      return res.status(400).json({
        error: {
          code:
            "PATH_COUNT_MISMATCH",

          message:
            "Folder structure does not match uploaded files",
        },
      });
    }

    const targetValidation =
      await validateOwnedTargetFolder({
        folderId:
          parentFolderId,
        ownerId,
      });

    if (!targetValidation.valid) {
      return res
        .status(
          targetValidation.status
        )
        .json({
          error:
            targetValidation.error,
        });
    }

    // ==================================================
    // FOLDER HELPER
    // ==================================================

    const folderCache =
      new Map();

    const getOrCreateFolder =
      async ({
        name,
        parentId,
      }) => {
        const cacheKey =
          `${
            parentId || "root"
          }::${name}`;

        if (
          folderCache.has(
            cacheKey
          )
        ) {
          return folderCache.get(
            cacheKey
          );
        }

        let query =
          supabase
            .from("folders")
            .select(
              "id, name, parent_id"
            )
            .eq(
              "owner_id",
              ownerId
            )
            .eq(
              "name",
              name
            )
            .eq(
              "is_deleted",
              false
            );

        if (parentId === null) {
          query =
            query.is(
              "parent_id",
              null
            );
        } else {
          query =
            query.eq(
              "parent_id",
              parentId
            );
        }

        const {
          data:
            existingFolder,

          error:
            existingError,
        } =
          await query.maybeSingle();

        if (existingError) {
          throw existingError;
        }

        if (existingFolder) {
          folderCache.set(
            cacheKey,
            existingFolder.id
          );

          return existingFolder.id;
        }

        const {
          data: newFolder,
          error:
            createError,
        } = await supabase
          .from("folders")
          .insert({
            name,

            owner_id:
              ownerId,

            parent_id:
              parentId,

            is_project:
              false,
          })
          .select("id")
          .single();

        if (createError) {
          throw createError;
        }

        folderCache.set(
          cacheKey,
          newFolder.id
        );

        return newFolder.id;
      };

    let uploadedCount = 0;

    const createdFolderIds =
      new Set();

    for (
      let index = 0;
      index < files.length;
      index += 1
    ) {
      const file =
        files[index];

      const relativePath =
        relativePaths[index];

      if (
        !relativePath ||
        typeof relativePath !==
          "string"
      ) {
        continue;
      }

      const pathParts =
        relativePath
          .replace(/\\/g, "/")
          .split("/")
          .filter(Boolean);

      if (
        pathParts.length < 2
      ) {
        continue;
      }

      const folderParts =
        pathParts.slice(
          0,
          -1
        );

      let currentParentId =
        parentFolderId;

      for (
        const folderName
        of folderParts
      ) {
        const folderId =
          await getOrCreateFolder({
            name: folderName,
            parentId:
              currentParentId,
          });

        createdFolderIds.add(
          folderId
        );

        currentParentId =
          folderId;
      }

      const storagePath =
        buildStoragePath({
          ownerId,

          folderId:
            currentParentId,

          originalName:
            file.originalname,
        });

      uploadedStoragePaths.push(
        storagePath
      );

      await uploadFileToStorage({
        buffer: file.buffer,
        storagePath,
        mimeType:
          file.mimetype,
      });

      const {
        error: insertError,
      } = await supabase
        .from("files")
        .insert({
          name:
            file.originalname,

          mime_type:
            file.mimetype,

          file_kind:
            "file",

          size_bytes:
            file.size,

          storage_path:
            storagePath,

          owner_id:
            ownerId,

          folder_id:
            currentParentId,
        });

      if (insertError) {
        throw insertError;
      }

      uploadedCount += 1;
    }

    return res.status(201).json({
      message:
        "Folder uploaded successfully",

      uploaded: {
        files:
          uploadedCount,

        folders:
          createdFolderIds.size,
      },
    });
  } catch (error) {
    console.error(
      "Folder upload error:",
      error
    );

    for (
      const storagePath
      of uploadedStoragePaths
    ) {
      try {
        await deleteFileFromStorage(
          storagePath
        );
      } catch (cleanupError) {
        console.error(
          "Folder upload cleanup error:",
          cleanupError
        );
      }
    }

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to upload folder",
      },
    });
  }
};

// ======================================================
// CREATE CLOUD DOCUMENT
// ======================================================

const createDocument = async (
  req,
  res
) => {
  let uploadedStoragePath = null;

  try {
    const ownerId =
      req.user.id;

    const {
      name,
      folderId = null,
    } = req.body;

    if (
      !name ||
      !name.trim()
    ) {
      return res.status(400).json({
        error: {
          code:
            "VALIDATION_ERROR",

          message:
            "Document name is required",
        },
      });
    }

    const cleanName =
      name.trim();

    const documentName =
      cleanName
        .toLowerCase()
        .endsWith(".txt")
        ? cleanName
        : `${cleanName}.txt`;

    const targetValidation =
      await validateOwnedTargetFolder({
        folderId,
        ownerId,
      });

    if (!targetValidation.valid) {
      return res
        .status(
          targetValidation.status
        )
        .json({
          error:
            targetValidation.error,
        });
    }

    // ==================================================
    // CHECK DUPLICATE
    // ==================================================

    let duplicateQuery =
      supabase
        .from("files")
        .select("id")
        .eq(
          "owner_id",
          ownerId
        )
        .eq(
          "name",
          documentName
        )
        .eq(
          "is_deleted",
          false
        );

    if (folderId === null) {
      duplicateQuery =
        duplicateQuery.is(
          "folder_id",
          null
        );
    } else {
      duplicateQuery =
        duplicateQuery.eq(
          "folder_id",
          folderId
        );
    }

    const {
      data:
        existingDocument,

      error:
        duplicateError,
    } =
      await duplicateQuery.maybeSingle();

    if (duplicateError) {
      throw duplicateError;
    }

    if (existingDocument) {
      return res.status(409).json({
        error: {
          code:
            "DOCUMENT_EXISTS",

          message:
            "A document with this name already exists here",
        },
      });
    }

    // ==================================================
    // EMPTY CONTENT
    // ==================================================

    const buffer =
      Buffer.from(
        "",
        "utf8"
      );

    const storagePath =
      buildStoragePath({
        ownerId,
        folderId,

        originalName:
          documentName,
      });

    uploadedStoragePath =
      storagePath;

    await uploadFileToStorage({
      buffer,
      storagePath,

      mimeType:
        "text/plain",
    });

    // ==================================================
    // DATABASE
    // ==================================================

    const {
      data: file,
      error: insertError,
    } = await supabase
      .from("files")
      .insert({
        name:
          documentName,

        mime_type:
          "text/plain",

        file_kind:
          "document",

        size_bytes: 0,

        storage_path:
          storagePath,

        owner_id:
          ownerId,

        folder_id:
          folderId,
      })
      .select(
        `
        id,
        name,
        mime_type,
        file_kind,
        size_bytes,
        storage_path,
        owner_id,
        folder_id,
        is_deleted,
        is_starred,
        created_at,
        updated_at
        `
      )
      .single();

    if (insertError) {
      await deleteFileFromStorage(
        storagePath
      );

      throw insertError;
    }

    return res.status(201).json({
      message:
        "Document created successfully",

      document: {
        id: file.id,

        name:
          file.name,

        mimeType:
          file.mime_type,

        fileKind:
          file.file_kind,

        sizeBytes:
          file.size_bytes,

        ownerId:
          file.owner_id,

        folderId:
          file.folder_id,

        isDeleted:
          file.is_deleted,

        isStarred:
          file.is_starred,

        createdAt:
          file.created_at,

        updatedAt:
          file.updated_at,

        content: "",
      },
    });
  } catch (error) {
    console.error(
      "Create document error:",
      error
    );

    if (uploadedStoragePath) {
      try {
        await deleteFileFromStorage(
          uploadedStoragePath
        );
      } catch (cleanupError) {
        console.error(
          "Create document cleanup error:",
          cleanupError
        );
      }
    }

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to create document",
      },
    });
  }
};

// ======================================================
// GET CLOUD DOCUMENT CONTENT
// ======================================================

const getDocument = async (
  req,
  res
) => {
  try {
    const userId =
      req.user.id;

    const fileId =
      req.params.id;

    const {
      data: file,
      error: fileError,
    } = await supabase
      .from("files")
      .select(
        `
        id,
        name,
        mime_type,
        file_kind,
        size_bytes,
        storage_path,
        owner_id,
        folder_id,
        is_deleted,
        is_starred,
        created_at,
        updated_at
        `
      )
      .eq("id", fileId)
      .maybeSingle();

    if (fileError) {
      throw fileError;
    }

    if (
      !file ||
      file.is_deleted
    ) {
      return res.status(404).json({
        error: {
          code:
            "FILE_NOT_FOUND",

          message:
            "Document not found",
        },
      });
    }

    // IMPORTANT:
    // Only Cloud Drive documents
    // are editable here.
    if (
      file.file_kind !==
      "document"
    ) {
      return res.status(400).json({
        error: {
          code:
            "NOT_A_DOCUMENT",

          message:
            "This file is not an editable Cloud Drive document",
        },
      });
    }

    const access =
      await getFileAccess({
        file,
        userId,
      });

    if (!access.hasAccess) {
      return res.status(403).json({
        error: {
          code:
            "FORBIDDEN",

          message:
            "You do not have access to this document",
        },
      });
    }

    const {
      data: storageFile,
      error: downloadError,
    } =
      await supabase.storage
        .from(bucketName)
        .download(
          file.storage_path
        );

    if (downloadError) {
      throw downloadError;
    }

    const content =
      await storageFile.text();

    const accessedAt =
      new Date().toISOString();

    const {
      error:
        accessUpdateError,
    } = await supabase
      .from("files")
      .update({
        last_accessed_at:
          accessedAt,
      })
      .eq("id", fileId);

    if (accessUpdateError) {
      console.error(
        "Unable to update last_accessed_at:",
        accessUpdateError
      );
    }

    return res.status(200).json({
      document: {
        id: file.id,

        name:
          file.name,

        mimeType:
          file.mime_type,

        fileKind:
          file.file_kind,

        sizeBytes:
          file.size_bytes,

        ownerId:
          file.owner_id,

        folderId:
          file.folder_id,

        isStarred:
          file.is_starred,

        createdAt:
          file.created_at,

        updatedAt:
          file.updated_at,

        lastAccessedAt:
          accessedAt,

        permission:
          access.permission,

        accessType:
          access.accessType,

        canEdit:
          access.permission ===
            "owner" ||
          access.permission ===
            "editor",

        content,
      },
    });
  } catch (error) {
    console.error(
      "Get document error:",
      error
    );

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to load document",
      },
    });
  }
};

// ======================================================
// SAVE CLOUD DOCUMENT
// OWNER / EDITOR
// ======================================================

const updateDocumentContent =
  async (req, res) => {
    try {
      const userId =
        req.user.id;

      const fileId =
        req.params.id;

      const {
        content,
      } = req.body;

      if (
        typeof content !==
        "string"
      ) {
        return res.status(400).json({
          error: {
            code:
              "VALIDATION_ERROR",

            message:
              "Document content must be text",
          },
        });
      }

      const {
        data: file,
        error: fileError,
      } = await supabase
        .from("files")
        .select(
          `
          id,
          name,
          mime_type,
          file_kind,
          size_bytes,
          storage_path,
          owner_id,
          folder_id,
          is_deleted,
          is_starred,
          created_at,
          updated_at
          `
        )
        .eq("id", fileId)
        .maybeSingle();

      if (fileError) {
        throw fileError;
      }

      if (
        !file ||
        file.is_deleted
      ) {
        return res.status(404).json({
          error: {
            code:
              "FILE_NOT_FOUND",

            message:
              "Document not found",
          },
        });
      }

      if (
        file.file_kind !==
        "document"
      ) {
        return res.status(400).json({
          error: {
            code:
              "NOT_A_DOCUMENT",

          message:
              "This file is not an editable Cloud Drive document",
          },
        });
      }

      const access =
        await getFileAccess({
          file,
          userId,
        });

      if (!access.hasAccess) {
        return res.status(403).json({
          error: {
            code:
              "FORBIDDEN",

          message:
              "You do not have access to this document",
          },
        });
      }

      if (
        access.permission ===
        "viewer"
      ) {
        return res.status(403).json({
          error: {
            code:
              "VIEWER_READ_ONLY",

          message:
              "Viewer access is read-only",
          },
        });
      }

      const buffer =
        Buffer.from(
          content,
          "utf8"
        );

      const {
        error:
          storageUpdateError,
      } =
        await supabase.storage
          .from(bucketName)
          .update(
            file.storage_path,
            buffer,
            {
              contentType:
                "text/plain",

              upsert: true,
            }
          );

      if (storageUpdateError) {
        throw storageUpdateError;
      }

      const now =
        new Date().toISOString();

      const {
        data:
          updatedFile,

        error:
          metadataError,
      } = await supabase
        .from("files")
        .update({
          size_bytes:
            buffer.length,

          updated_at:
            now,

          last_accessed_at:
            now,
        })
        .eq("id", fileId)
        .select(
          `
          id,
          name,
          mime_type,
          file_kind,
          size_bytes,
          owner_id,
          folder_id,
          is_starred,
          created_at,
          updated_at,
          last_accessed_at
          `
        )
        .single();

      if (metadataError) {
        throw metadataError;
      }

      return res.status(200).json({
        message:
          "Document saved successfully",

        document: {
          id:
            updatedFile.id,

          name:
            updatedFile.name,

          mimeType:
            updatedFile.mime_type,

          fileKind:
            updatedFile.file_kind,

          sizeBytes:
            updatedFile.size_bytes,

          ownerId:
            updatedFile.owner_id,

          folderId:
            updatedFile.folder_id,

          isStarred:
            updatedFile.is_starred,

          createdAt:
            updatedFile.created_at,

          updatedAt:
            updatedFile.updated_at,

          lastAccessedAt:
            updatedFile.last_accessed_at,

          permission:
            access.permission,

          canEdit: true,
        },
      });
    } catch (error) {
      console.error(
        "Update document content error:",
        error
      );

      return res.status(500).json({
        error: {
          code:
            "INTERNAL_SERVER_ERROR",

          message:
            "Unable to save document",
        },
      });
    }
  };


// ======================================================
// CREATE CLOUD SPREADSHEET
// ======================================================

const createSpreadsheet = async (req, res) => {
  let uploadedStoragePath = null;

  try {
    const ownerId = req.user.id;

    const {
      name,
      folderId = null,
      templateId = null,
    } = req.body;


    console.log(
  "CREATE PRESENTATION REQUEST:",
  {
    name,
    folderId,
    templateId,
  }
);

    // ==================================================
    // VALIDATE NAME
    // ==================================================

    if (
      !name ||
      !name.trim()
    ) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message:
            "Spreadsheet name is required",
        },
      });
    }

    const cleanName =
      name.trim();

    const spreadsheetName =
      cleanName
        .toLowerCase()
        .endsWith(".cloudsheet")
        ? cleanName
        : `${cleanName}.cloudsheet`;

    // ==================================================
    // VALIDATE TARGET FOLDER
    // ==================================================

    const targetValidation =
      await validateOwnedTargetFolder({
        folderId,
        ownerId,
      });

    if (!targetValidation.valid) {
      return res
        .status(
          targetValidation.status
        )
        .json({
          error:
            targetValidation.error,
        });
    }

    // ==================================================
    // CHECK DUPLICATE
    // ==================================================

    let duplicateQuery =
      supabase
        .from("files")
        .select("id")
        .eq(
          "owner_id",
          ownerId
        )
        .eq(
          "name",
          spreadsheetName
        )
        .eq(
          "is_deleted",
          false
        );

    if (folderId === null) {
      duplicateQuery =
        duplicateQuery.is(
          "folder_id",
          null
        );
    } else {
      duplicateQuery =
        duplicateQuery.eq(
          "folder_id",
          folderId
        );
    }

    const {
      data:
        existingSpreadsheet,

      error:
        duplicateError,
    } =
      await duplicateQuery.maybeSingle();

    if (duplicateError) {
      throw duplicateError;
    }

    if (
      existingSpreadsheet
    ) {
      return res.status(409).json({
        error: {
          code:
            "SPREADSHEET_EXISTS",

          message:
            "A spreadsheet with this name already exists here",
        },
      });
    }

    // ==================================================
    // TEMPLATE DATA
    // ==================================================

    const getTemplateCells =
  (selectedTemplateId) => {
    // ==================================================
    // SHARED STYLES
    // ==================================================

    const titleStyle = {
      backgroundColor:
        "#ECFDF5",
      color:
        "#047857",
      fontWeight:
        "700",
      fontSize:
        "18px",
      textAlign:
        "left",
    };

    const greenHeaderStyle = {
      backgroundColor:
        "#D1FAE5",
      color:
        "#065F46",
      fontWeight:
        "700",
      textAlign:
        "center",
    };

    const blueHeaderStyle = {
      backgroundColor:
        "#DBEAFE",
      color:
        "#1D4ED8",
      fontWeight:
        "700",
      textAlign:
        "center",
    };

    const violetHeaderStyle = {
      backgroundColor:
        "#EDE9FE",
      color:
        "#6D28D9",
      fontWeight:
        "700",
      textAlign:
        "center",
    };

    const amberHeaderStyle = {
      backgroundColor:
        "#FEF3C7",
      color:
        "#B45309",
      fontWeight:
        "700",
      textAlign:
        "center",
    };

    const centerStyle = {
      textAlign:
        "center",
    };

    // ==================================================
    // PROJECT TRACKER
    // ==================================================

    if (
      selectedTemplateId ===
      "project-tracker"
    ) {
      return {
        A1: {
          value:
            "Project Tracker",

          style: {
            ...titleStyle,
          },
        },

        A3: {
          value: "Task",

          style: {
            ...greenHeaderStyle,
          },
        },

        B3: {
          value: "Owner",

          style: {
            ...greenHeaderStyle,
          },
        },

        C3: {
          value:
            "Priority",

          style: {
            ...greenHeaderStyle,
          },
        },

        D3: {
          value: "Status",

          style: {
            ...greenHeaderStyle,
          },
        },

        E3: {
          value:
            "Due Date",

          style: {
            ...greenHeaderStyle,
          },
        },

        F3: {
          value:
            "Progress",

          style: {
            ...greenHeaderStyle,
          },
        },

        A4: {
          value:
            "Research requirements",
        },

        B4: {
          value: "Aabha",

          style: {
            ...centerStyle,
          },
        },

        C4: {
          value: "High",

          style: {
            backgroundColor:
              "#FEE2E2",
            color:
              "#B91C1C",
            fontWeight:
              "600",
            textAlign:
              "center",
          },
        },

        D4: {
          value: "Done",

          style: {
            backgroundColor:
              "#DCFCE7",
            color:
              "#15803D",
            fontWeight:
              "600",
            textAlign:
              "center",
          },
        },

        E4: {
          value:
            "12 Aug 2026",

          style: {
            ...centerStyle,
          },
        },

        F4: {
          value: "100%",

          style: {
            backgroundColor:
              "#DCFCE7",
            color:
              "#15803D",
            fontWeight:
              "700",
            textAlign:
              "center",
          },
        },

        A5: {
          value:
            "Create design",
        },

        B5: {
          value: "Priya",

          style: {
            ...centerStyle,
          },
        },

        C5: {
          value: "High",

          style: {
            backgroundColor:
              "#FEE2E2",
            color:
              "#B91C1C",
            fontWeight:
              "600",
            textAlign:
              "center",
          },
        },

        D5: {
          value:
            "In Progress",

          style: {
            backgroundColor:
              "#FEF3C7",
            color:
              "#B45309",
            fontWeight:
              "600",
            textAlign:
              "center",
          },
        },

        E5: {
          value:
            "15 Aug 2026",

          style: {
            ...centerStyle,
          },
        },

        F5: {
          value: "60%",

          style: {
            backgroundColor:
              "#FEF3C7",
            color:
              "#B45309",
            fontWeight:
              "700",
            textAlign:
              "center",
          },
        },

        A6: {
          value:
            "Testing",
        },

        B6: {
          value: "Team",

          style: {
            ...centerStyle,
          },
        },

        C6: {
          value: "Medium",

          style: {
            backgroundColor:
              "#FEF3C7",
            color:
              "#B45309",
            fontWeight:
              "600",
            textAlign:
              "center",
          },
        },

        D6: {
          value: "To Do",

          style: {
            backgroundColor:
              "#F1F5F9",
            color:
              "#475569",
            fontWeight:
              "600",
            textAlign:
              "center",
          },
        },

        E6: {
          value:
            "18 Aug 2026",

          style: {
            ...centerStyle,
          },
        },

        F6: {
          value: "0%",

          style: {
            backgroundColor:
              "#F1F5F9",
            color:
              "#64748B",
            fontWeight:
              "700",
            textAlign:
              "center",
          },
        },

        A7: {
          value:
            "Launch",
        },

        B7: {
          value: "Team",

          style: {
            ...centerStyle,
          },
        },

        C7: {
          value: "High",

          style: {
            backgroundColor:
              "#FEE2E2",
            color:
              "#B91C1C",
            fontWeight:
              "600",
            textAlign:
              "center",
          },
        },

        D7: {
          value: "To Do",

          style: {
            backgroundColor:
              "#F1F5F9",
            color:
              "#475569",
            fontWeight:
              "600",
            textAlign:
              "center",
          },
        },

        E7: {
          value:
            "22 Aug 2026",

          style: {
            ...centerStyle,
          },
        },

        F7: {
          value: "0%",

          style: {
            backgroundColor:
              "#F1F5F9",
            color:
              "#64748B",
            fontWeight:
              "700",
            textAlign:
              "center",
          },
        },

        A9: {
          value:
            "Overall Progress",

          style: {
            backgroundColor:
              "#ECFDF5",
            color:
              "#047857",
            fontWeight:
              "700",
          },
        },

        B9: {
          value: "40%",

          style: {
            backgroundColor:
              "#D1FAE5",
            color:
              "#047857",
            fontWeight:
              "700",
            textAlign:
              "center",
          },
        },
      };
    }

    // ==================================================
    // MONTHLY BUDGET
    // ==================================================

    if (
      selectedTemplateId ===
      "monthly-budget"
    ) {
      return {
        A1: {
          value:
            "Monthly Budget",

          style: {
            backgroundColor:
              "#F0FDF4",
            color:
              "#166534",
            fontWeight:
              "700",
            fontSize:
              "18px",
          },
        },

        A3: {
          value: "Income",

          style: {
            ...greenHeaderStyle,
          },
        },

        B3: {
          value: "Amount",

          style: {
            ...greenHeaderStyle,
          },
        },

        A4: {
          value: "Salary",
        },

        B4: {
          value: "₹85,000",

          style: {
            backgroundColor:
              "#DCFCE7",
            color:
              "#15803D",
            fontWeight:
              "700",
            textAlign:
              "right",
          },
        },

        A5: {
          value:
            "Other Income",
        },

        B5: {
          value: "₹5,000",

          style: {
            backgroundColor:
              "#DCFCE7",
            color:
              "#15803D",
            fontWeight:
              "600",
            textAlign:
              "right",
          },
        },

        D3: {
          value:
            "Expenses",

          style: {
            backgroundColor:
              "#FEE2E2",
            color:
              "#B91C1C",
            fontWeight:
              "700",
            textAlign:
              "center",
          },
        },

        E3: {
          value: "Amount",

          style: {
            backgroundColor:
              "#FEE2E2",
            color:
              "#B91C1C",
            fontWeight:
              "700",
            textAlign:
              "center",
          },
        },

        D4: {
          value: "Rent",
        },

        E4: {
          value: "₹18,000",

          style: {
            textAlign:
              "right",
          },
        },

        D5: {
          value: "Food",
        },

        E5: {
          value: "₹9,500",

          style: {
            textAlign:
              "right",
          },
        },

        D6: {
          value: "Travel",
        },

        E6: {
          value: "₹6,200",

          style: {
            textAlign:
              "right",
          },
        },

        D7: {
          value:
            "Utilities",
        },

        E7: {
          value: "₹4,400",

          style: {
            textAlign:
              "right",
          },
        },

        D8: {
          value: "Other",
        },

        E8: {
          value: "₹4,800",

          style: {
            textAlign:
              "right",
          },
        },

        A10: {
          value:
            "Total Income",

          style: {
            backgroundColor:
              "#DCFCE7",
            color:
              "#166534",
            fontWeight:
              "700",
          },
        },

        B10: {
          value: "₹90,000",

          style: {
            backgroundColor:
              "#DCFCE7",
            color:
              "#166534",
            fontWeight:
              "700",
            textAlign:
              "right",
          },
        },

        D10: {
          value:
            "Total Expenses",

          style: {
            backgroundColor:
              "#FEE2E2",
            color:
              "#B91C1C",
            fontWeight:
              "700",
          },
        },

        E10: {
          value: "₹42,900",

          style: {
            backgroundColor:
              "#FEE2E2",
            color:
              "#B91C1C",
            fontWeight:
              "700",
            textAlign:
              "right",
          },
        },

        A12: {
          value: "Savings",

          style: {
            backgroundColor:
              "#ECFDF5",
            color:
              "#047857",
            fontWeight:
              "700",
            fontSize:
              "16px",
          },
        },

        B12: {
          value: "₹47,100",

          style: {
            backgroundColor:
              "#D1FAE5",
            color:
              "#047857",
            fontWeight:
              "700",
            fontSize:
              "16px",
            textAlign:
              "right",
          },
        },
      };
    }

    // ==================================================
    // TASK LIST
    // ==================================================

    if (
      selectedTemplateId ===
      "task-list"
    ) {
      return {
        A1: {
          value:
            "Task List",

          style: {
            backgroundColor:
              "#EFF6FF",
            color:
              "#1D4ED8",
            fontWeight:
              "700",
            fontSize:
              "18px",
          },
        },

        A3: {
          value:
            "Completed",

          style: {
            ...blueHeaderStyle,
          },
        },

        B3: {
          value: "Task",

          style: {
            ...blueHeaderStyle,
          },
        },

        C3: {
          value:
            "Priority",

          style: {
            ...blueHeaderStyle,
          },
        },

        D3: {
          value:
            "Due Date",

          style: {
            ...blueHeaderStyle,
          },
        },

        E3: {
          value: "Notes",

          style: {
            ...blueHeaderStyle,
          },
        },

        A4: {
          value: "✓",

          style: {
            backgroundColor:
              "#DBEAFE",
            color:
              "#2563EB",
            fontWeight:
              "700",
            textAlign:
              "center",
          },
        },

        B4: {
          value:
            "Prepare report",

          style: {
            color:
              "#94A3B8",
            textDecoration:
              "line-through",
          },
        },

        C4: {
          value: "High",

          style: {
            backgroundColor:
              "#FEE2E2",
            color:
              "#B91C1C",
            fontWeight:
              "600",
            textAlign:
              "center",
          },
        },

        D4: {
          value:
            "24 Aug 2026",

          style: {
            ...centerStyle,
          },
        },

        E4: {
          value:
            "Final review completed",
        },

        A5: {
          value: "",

          style: {
            textAlign:
              "center",
          },
        },

        B5: {
          value:
            "Review design",
        },

        C5: {
          value: "High",

          style: {
            backgroundColor:
              "#FEE2E2",
            color:
              "#B91C1C",
            fontWeight:
              "600",
            textAlign:
              "center",
          },
        },

        D5: {
          value:
            "25 Aug 2026",

          style: {
            ...centerStyle,
          },
        },

        A6: {
          value: "",
        },

        B6: {
          value:
            "Client call",
        },

        C6: {
          value: "Medium",

          style: {
            backgroundColor:
              "#FEF3C7",
            color:
              "#B45309",
            fontWeight:
              "600",
            textAlign:
              "center",
          },
        },

        D6: {
          value:
            "26 Aug 2026",

          style: {
            ...centerStyle,
          },
        },

        A7: {
          value: "",
        },

        B7: {
          value:
            "Update dashboard",
        },

        C7: {
          value: "Medium",

          style: {
            backgroundColor:
              "#FEF3C7",
            color:
              "#B45309",
            fontWeight:
              "600",
            textAlign:
              "center",
          },
        },

        D7: {
          value:
            "27 Aug 2026",

          style: {
            ...centerStyle,
          },
        },
      };
    }

    // ==================================================
    // WEEKLY PLANNER
    // ==================================================

    if (
      selectedTemplateId ===
      "weekly-planner"
    ) {
      return {
        A1: {
          value:
            "Weekly Planner",

          style: {
            backgroundColor:
              "#F5F3FF",
            color:
              "#6D28D9",
            fontWeight:
              "700",
            fontSize:
              "18px",
          },
        },

        A3: {
          value: "Time",

          style: {
            backgroundColor:
              "#EDE9FE",
            color:
              "#6D28D9",
            fontWeight:
              "700",
            textAlign:
              "center",
          },
        },

        B3: {
          value: "Monday",

          style: {
            ...violetHeaderStyle,
          },
        },

        C3: {
          value: "Tuesday",

          style: {
            ...violetHeaderStyle,
          },
        },

        D3: {
          value:
            "Wednesday",

          style: {
            ...violetHeaderStyle,
          },
        },

        E3: {
          value:
            "Thursday",

          style: {
            ...violetHeaderStyle,
          },
        },

        F3: {
          value: "Friday",

          style: {
            ...violetHeaderStyle,
          },
        },

        G3: {
          value:
            "Saturday",

          style: {
            backgroundColor:
              "#FAE8FF",
            color:
              "#A21CAF",
            fontWeight:
              "700",
            textAlign:
              "center",
          },
        },

        H3: {
          value: "Sunday",

          style: {
            backgroundColor:
              "#FAE8FF",
            color:
              "#A21CAF",
            fontWeight:
              "700",
            textAlign:
              "center",
          },
        },

        A4: {
          value: "8:00 AM",

          style: {
            backgroundColor:
              "#F8FAFC",
            color:
              "#64748B",
            fontWeight:
              "600",
            textAlign:
              "center",
          },
        },

        B4: {
          value:
            "Plan weekly goals",

          style: {
            backgroundColor:
              "#F5F3FF",
          },
        },

        C4: {
          value: "Class",

          style: {
            backgroundColor:
              "#EFF6FF",
          },
        },

        D4: {
          value:
            "Project work",

          style: {
            backgroundColor:
              "#ECFDF5",
          },
        },

        E4: {
          value:
            "Research",

          style: {
            backgroundColor:
              "#FFF7ED",
          },
        },

        F4: {
          value:
            "Weekly review",

          style: {
            backgroundColor:
              "#FEFCE8",
          },
        },

        G4: {
          value:
            "Personal time",

          style: {
            backgroundColor:
              "#FDF2F8",
          },
        },

        H4: {
          value:
            "Weekly reset",

          style: {
            backgroundColor:
              "#FDF2F8",
          },
        },

        A5: {
          value: "10:00 AM",

          style: {
            backgroundColor:
              "#F8FAFC",
            color:
              "#64748B",
            fontWeight:
              "600",
            textAlign:
              "center",
          },
        },

        B5: {
          value:
            "Assignments",

          style: {
            backgroundColor:
              "#F5F3FF",
          },
        },

        C5: {
          value:
            "Project work",

          style: {
            backgroundColor:
              "#EFF6FF",
          },
        },

        D5: {
          value: "Meeting",

          style: {
            backgroundColor:
              "#ECFDF5",
          },
        },

        E5: {
          value:
            "Assignments",

          style: {
            backgroundColor:
              "#FFF7ED",
          },
        },

        F5: {
          value:
            "Documentation",

          style: {
            backgroundColor:
              "#FEFCE8",
          },
        },

        G5: {
          value:
            "Shopping",

          style: {
            backgroundColor:
              "#FDF2F8",
          },
        },

        H5: {
          value:
            "Reading",

          style: {
            backgroundColor:
              "#FDF2F8",
          },
        },

        A6: {
          value: "1:00 PM",

          style: {
            backgroundColor:
              "#F8FAFC",
            color:
              "#64748B",
            fontWeight:
              "600",
            textAlign:
              "center",
          },
        },

        B6: {
          value: "Lunch",

          style: {
            backgroundColor:
              "#F0FDFA",
            textAlign:
              "center",
          },
        },

        C6: {
          value: "Lunch",

          style: {
            backgroundColor:
              "#F0FDFA",
            textAlign:
              "center",
          },
        },

        D6: {
          value: "Lunch",

          style: {
            backgroundColor:
              "#F0FDFA",
            textAlign:
              "center",
          },
        },

        E6: {
          value: "Lunch",

          style: {
            backgroundColor:
              "#F0FDFA",
            textAlign:
              "center",
          },
        },

        F6: {
          value: "Lunch",

          style: {
            backgroundColor:
              "#F0FDFA",
            textAlign:
              "center",
          },
        },

        G6: {
          value: "Lunch",

          style: {
            backgroundColor:
              "#F0FDFA",
            textAlign:
              "center",
          },
        },

        H6: {
          value: "Lunch",

          style: {
            backgroundColor:
              "#F0FDFA",
            textAlign:
              "center",
          },
        },

        A7: {
          value: "3:00 PM",

          style: {
            backgroundColor:
              "#F8FAFC",
            color:
              "#64748B",
            fontWeight:
              "600",
            textAlign:
              "center",
          },
        },

        B7: {
          value:
            "Product learning",

          style: {
            backgroundColor:
              "#F5F3FF",
          },
        },

        C7: {
          value:
            "Coding practice",

          style: {
            backgroundColor:
              "#EFF6FF",
          },
        },

        D7: {
          value:
            "Research work",

          style: {
            backgroundColor:
              "#ECFDF5",
          },
        },

        E7: {
          value:
            "Presentation prep",

          style: {
            backgroundColor:
              "#FFF7ED",
          },
        },

        F7: {
          value:
            "Career prep",

          style: {
            backgroundColor:
              "#FEFCE8",
          },
        },

        G7: {
          value:
            "Free time",

          style: {
            backgroundColor:
              "#FDF2F8",
          },
        },

        H7: {
          value:
            "Plan next week",

          style: {
            backgroundColor:
              "#FDF2F8",
          },
        },

        A8: {
          value: "6:00 PM",

          style: {
            backgroundColor:
              "#F8FAFC",
            color:
              "#64748B",
            fontWeight:
              "600",
            textAlign:
              "center",
          },
        },

        B8: {
          value:
            "Exercise",

          style: {
            backgroundColor:
              "#ECFDF5",
          },
        },

        C8: {
          value:
            "Free time",

          style: {
            backgroundColor:
              "#F8FAFC",
          },
        },

        D8: {
          value:
            "Exercise",

          style: {
            backgroundColor:
              "#ECFDF5",
          },
        },

        E8: {
          value:
            "Free time",

          style: {
            backgroundColor:
              "#F8FAFC",
          },
        },

        F8: {
          value:
            "Weekend planning",

          style: {
            backgroundColor:
              "#FEF3C7",
          },
        },

        A10: {
          value:
            "Top Priorities",

          style: {
            backgroundColor:
              "#EDE9FE",
            color:
              "#6D28D9",
            fontWeight:
              "700",
          },
        },

        A11: {
          value:
            "1. Complete major task",

          style: {
            backgroundColor:
              "#FAFAFA",
          },
        },

        A12: {
          value:
            "2. Review project progress",

          style: {
            backgroundColor:
              "#FAFAFA",
          },
        },

        A13: {
          value:
            "3. Prepare for next week",

          style: {
            backgroundColor:
              "#FAFAFA",
          },
        },
      };
    }

    return {};
  };

    // ==================================================
    // INITIAL SPREADSHEET CONTENT
    // ==================================================

    const templateCells =
      getTemplateCells(
        templateId
      );

    const initialSpreadsheet = {
      version: 1,

      templateId:
        templateId || null,

      sheets: [
        {
          id: "sheet-1",

          name:
            templateId ===
            "weekly-planner"
              ? "Weekly Planner"
              : templateId ===
                  "monthly-budget"
                ? "Budget"
                : templateId ===
                    "project-tracker"
                  ? "Project Tracker"
                  : templateId ===
                      "task-list"
                    ? "Tasks"
                    : "Sheet1",

          rows: 50,
          columns: 26,

          cells:
            templateCells,
        },
      ],

      activeSheetId:
        "sheet-1",
    };

    const content =
      JSON.stringify(
        initialSpreadsheet
      );

    const buffer =
      Buffer.from(
        content,
        "utf8"
      );

    // ==================================================
    // STORAGE PATH
    // ==================================================

    const storagePath =
      buildStoragePath({
        ownerId,
        folderId,

        originalName:
          spreadsheetName,
      });

    uploadedStoragePath =
      storagePath;

    // ==================================================
    // UPLOAD INITIAL FILE
    // ==================================================

    await uploadFileToStorage({
      buffer,
      storagePath,

      mimeType:
        "application/json",
    });

    // ==================================================
    // DATABASE
    // ==================================================

    const {
      data: file,
      error: insertError,
    } = await supabase
      .from("files")
      .insert({
        name:
          spreadsheetName,

        mime_type:
          "application/json",

        file_kind:
          "spreadsheet",

        size_bytes:
          buffer.length,

        storage_path:
          storagePath,

        owner_id:
          ownerId,

        folder_id:
          folderId,
      })
      .select(
        `
        id,
        name,
        mime_type,
        file_kind,
        size_bytes,
        storage_path,
        owner_id,
        folder_id,
        is_deleted,
        is_starred,
        created_at,
        updated_at
        `
      )
      .single();

    if (insertError) {
      await deleteFileFromStorage(
        storagePath
      );

      throw insertError;
    }

    return res.status(201).json({
      message:
        templateId
          ? "Spreadsheet created from template successfully"
          : "Spreadsheet created successfully",

      spreadsheet: {
        id:
          file.id,

        name:
          file.name,

        mimeType:
          file.mime_type,

        fileKind:
          file.file_kind,

        sizeBytes:
          file.size_bytes,

        ownerId:
          file.owner_id,

        folderId:
          file.folder_id,

        isDeleted:
          file.is_deleted,

        isStarred:
          file.is_starred,

        createdAt:
          file.created_at,

        updatedAt:
          file.updated_at,

        data:
          initialSpreadsheet,
      },
    });
  } catch (error) {
    console.error(
      "Create spreadsheet error:",
      error
    );

    if (
      uploadedStoragePath
    ) {
      try {
        await deleteFileFromStorage(
          uploadedStoragePath
        );
      } catch (
        cleanupError
      ) {
        console.error(
          "Spreadsheet cleanup error:",
          cleanupError
        );
      }
    }

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to create spreadsheet",
      },
    });
  }
};

// ======================================================
// GET CLOUD SPREADSHEET
// ======================================================

const getSpreadsheet = async (
  req,
  res
) => {
  try {
    const userId =
      req.user.id;

    const fileId =
      req.params.id;

    // ==================================================
    // GET DATABASE FILE
    // ==================================================

    const {
      data: file,
      error: fileError,
    } = await supabase
      .from("files")
      .select(
        `
        id,
        name,
        mime_type,
        file_kind,
        size_bytes,
        storage_path,
        owner_id,
        folder_id,
        is_deleted,
        is_starred,
        created_at,
        updated_at
        `
      )
      .eq(
        "id",
        fileId
      )
      .maybeSingle();

    if (fileError) {
      throw fileError;
    }

    if (
      !file ||
      file.is_deleted
    ) {
      return res.status(404).json({
        error: {
          code:
            "FILE_NOT_FOUND",

          message:
            "Spreadsheet not found",
        },
      });
    }

    // ==================================================
    // VERIFY TYPE
    // ==================================================

    if (
      file.file_kind !==
      "spreadsheet"
    ) {
      return res.status(400).json({
        error: {
          code:
            "NOT_A_SPREADSHEET",

          message:
            "This file is not an editable Cloud Drive spreadsheet",
        },
      });
    }

    // ==================================================
    // CHECK ACCESS
    // ==================================================

    const access =
      await getFileAccess({
        file,
        userId,
      });

    if (!access.hasAccess) {
      return res.status(403).json({
        error: {
          code:
            "FORBIDDEN",

          message:
            "You do not have access to this spreadsheet",
        },
      });
    }

    // ==================================================
    // DOWNLOAD CONTENT
    // ==================================================

    const {
      data: storageFile,
      error: downloadError,
    } =
      await supabase.storage
        .from(bucketName)
        .download(
          file.storage_path
        );

    if (downloadError) {
      throw downloadError;
    }

    const rawContent =
      await storageFile.text();

    let spreadsheetData;

    try {
      spreadsheetData =
        JSON.parse(
          rawContent
        );
    } catch {
      return res.status(500).json({
        error: {
          code:
            "INVALID_SPREADSHEET_DATA",

          message:
            "Spreadsheet data is invalid",
        },
      });
    }

    // ==================================================
    // UPDATE LAST ACCESSED
    // ==================================================

    const accessedAt =
      new Date().toISOString();

    const {
      error: accessUpdateError,
    } = await supabase
      .from("files")
      .update({
        last_accessed_at:
          accessedAt,
      })
      .eq(
        "id",
        fileId
      );

    if (accessUpdateError) {
      console.error(
        "Unable to update last_accessed_at:",
        accessUpdateError
      );
    }

    // ==================================================
    // RESPONSE
    // ==================================================

    return res.status(200).json({
      spreadsheet: {
        id: file.id,

        name:
          file.name,

        mimeType:
          file.mime_type,

        fileKind:
          file.file_kind,

        sizeBytes:
          file.size_bytes,

        ownerId:
          file.owner_id,

        folderId:
          file.folder_id,

        isStarred:
          file.is_starred,

        createdAt:
          file.created_at,

        updatedAt:
          file.updated_at,

        lastAccessedAt:
          accessedAt,

        permission:
          access.permission,

        accessType:
          access.accessType,

        canEdit:
          access.permission ===
            "owner" ||
          access.permission ===
            "editor",

        data:
          spreadsheetData,
      },
    });
  } catch (error) {
    console.error(
      "Get spreadsheet error:",
      error
    );

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to load spreadsheet",
      },
    });
  }
};

// ======================================================
// SAVE CLOUD SPREADSHEET
// OWNER / EDITOR
// ======================================================

const updateSpreadsheetContent =
  async (req, res) => {
    try {
      const userId =
        req.user.id;

      const fileId =
        req.params.id;

      const {
        data,
      } = req.body;

      // ==================================================
      // VALIDATE DATA
      // ==================================================

      if (
        !data ||
        typeof data !==
          "object" ||
        Array.isArray(data)
      ) {
        return res.status(400).json({
          error: {
            code:
              "VALIDATION_ERROR",

            message:
              "Spreadsheet data must be an object",
          },
        });
      }

      // ======================================================
// CREATE CLOUD PRESENTATION
// ======================================================

const createPresentation = async (req, res) => {
  let uploadedStoragePath = null;

  try {
    const ownerId = req.user.id;

    const {
      name,
      folderId = null,
      templateId = null,
    } = req.body;

    // ==================================================
    // VALIDATE NAME
    // ==================================================

    if (!name || !name.trim()) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message:
            "Presentation name is required",
        },
      });
    }

    const cleanName =
      name.trim();

    const presentationName =
      cleanName
        .toLowerCase()
        .endsWith(".cloudslides")
        ? cleanName
        : `${cleanName}.cloudslides`;

    // ==================================================
    // VALIDATE TARGET FOLDER
    // ==================================================

    const targetValidation =
      await validateOwnedTargetFolder({
        folderId,
        ownerId,
      });

    if (!targetValidation.valid) {
      return res
        .status(
          targetValidation.status
        )
        .json({
          error:
            targetValidation.error,
        });
    }

    // ==================================================
    // DUPLICATE CHECK
    // ==================================================

    let duplicateQuery =
      supabase
        .from("files")
        .select("id")
        .eq(
          "owner_id",
          ownerId
        )
        .eq(
          "name",
          presentationName
        )
        .eq(
          "is_deleted",
          false
        );

    if (folderId === null) {
      duplicateQuery =
        duplicateQuery.is(
          "folder_id",
          null
        );
    } else {
      duplicateQuery =
        duplicateQuery.eq(
          "folder_id",
          folderId
        );
    }

    const {
      data:
        existingPresentation,
      error:
        duplicateError,
    } =
      await duplicateQuery.maybeSingle();

    if (duplicateError) {
      throw duplicateError;
    }

    if (existingPresentation) {
      return res.status(409).json({
        error: {
          code:
            "PRESENTATION_EXISTS",
          message:
            "A presentation with this name already exists here",
        },
      });
    }

    // ==================================================
    // HELPERS
    // ==================================================

    const textElement = ({
      id,
      x,
      y,
      width,
      height,
      text,
      fontSize = 22,
      fontWeight = "400",
      fontFamily = "Arial",
      textAlign = "left",
      color = "#0f172a",
      lineHeight = 1.2,
      fontStyle = "normal",
    }) => ({
      id,
      type: "text",
      x,
      y,
      width,
      height,
      text,
      style: {
        fontSize,
        fontWeight,
        fontFamily,
        textAlign,
        color,
        lineHeight,
        fontStyle,
      },
    });

    const shapeElement = ({
      id,
      x,
      y,
      width,
      height,
      backgroundColor,
      borderRadius = "0px",
      border = "none",
      opacity = 1,
      boxShadow,
    }) => ({
      id,
      type: "shape",
      x,
      y,
      width,
      height,
      style: {
        backgroundColor,
        borderRadius,
        border,
        opacity,
        boxShadow,
      },
    });

    const makeSlide = ({
      id,
      background,
      elements,
    }) => ({
      id,
      background,
      elements,
    });

    // ==================================================
    // BLANK PRESENTATION
    // ==================================================

    const blankPresentation =
      () => ({
        version: 1,

        templateId: null,

        slides: [
          makeSlide({
            id: "slide-1",

            background: {
              type: "solid",
              value: "#ffffff",
            },

            elements: [
              textElement({
                id: "title-1",
                x: 10,
                y: 25,
                width: 80,
                height: 16,
                text:
                  "Click to add title",
                fontSize: 34,
                fontWeight: "700",
                textAlign:
                  "center",
              }),

              textElement({
                id: "subtitle-1",
                x: 15,
                y: 50,
                width: 70,
                height: 10,
                text:
                  "Click to add subtitle",
                fontSize: 18,
                textAlign:
                  "center",
                color:
                  "#64748b",
              }),
            ],
          }),
        ],

        activeSlideId:
          "slide-1",

        settings: {
          aspectRatio: "16:9",
        },
      });

    // ==================================================
    // RESEARCH PRESENTATION
    // ==================================================

    const researchTemplate =
      () => ({
        version: 1,

        templateId:
          "research-presentation",

        settings: {
          aspectRatio: "16:9",
        },

        activeSlideId:
          "research-1",

        slides: [
          // SLIDE 1
          makeSlide({
            id: "research-1",

            background: {
              type: "gradient",
              value:
                "linear-gradient(135deg, #0f172a 0%, #0f766e 100%)",
            },

            elements: [
              shapeElement({
                id: "r1-shape-1",
                x: 68,
                y: 8,
                width: 22,
                height: 34,
                backgroundColor:
                  "#14b8a6",
                borderRadius:
                  "30px",
                opacity: 0.9,
              }),

              shapeElement({
                id: "r1-shape-2",
                x: 76,
                y: 54,
                width: 12,
                height: 21,
                backgroundColor:
                  "#5eead4",
                borderRadius:
                  "999px",
                opacity: 0.6,
              }),

              textElement({
                id: "r1-title",
                x: 8,
                y: 24,
                width: 55,
                height: 20,
                text:
                  "Research Presentation",
                fontSize: 48,
                fontWeight: "700",
                color: "#ffffff",
              }),

              textElement({
                id: "r1-subtitle",
                x: 8,
                y: 49,
                width: 48,
                height: 12,
                text:
                  "Study title • Researcher name • Institution",
                fontSize: 20,
                color:
                  "#ccfbf1",
              }),

              textElement({
                id: "r1-footer",
                x: 8,
                y: 80,
                width: 30,
                height: 7,
                text:
                  "RESEARCH • 2026",
                fontSize: 12,
                fontWeight: "700",
                color:
                  "#99f6e4",
              }),
            ],
          }),

          // SLIDE 2
          makeSlide({
            id: "research-2",

            background: {
              type: "solid",
              value: "#f8fafc",
            },

            elements: [
              shapeElement({
                id: "r2-bar",
                x: 0,
                y: 0,
                width: 100,
                height: 5,
                backgroundColor:
                  "#0f766e",
              }),

              textElement({
                id: "r2-title",
                x: 7,
                y: 10,
                width: 50,
                height: 10,
                text:
                  "Background & Problem",
                fontSize: 34,
                fontWeight: "700",
                color:
                  "#0f172a",
              }),

              textElement({
                id: "r2-body",
                x: 7,
                y: 27,
                width: 50,
                height: 45,
                text:
                  "• Describe the context of the research\n• Explain the problem being investigated\n• Summarize why the problem matters\n• Highlight the current research gap",
                fontSize: 20,
                color:
                  "#334155",
                lineHeight: 1.5,
              }),

              shapeElement({
                id: "r2-card",
                x: 64,
                y: 24,
                width: 27,
                height: 45,
                backgroundColor:
                  "#ccfbf1",
                borderRadius:
                  "24px",
              }),

              textElement({
                id: "r2-card-number",
                x: 67,
                y: 33,
                width: 21,
                height: 14,
                text: "01",
                fontSize: 52,
                fontWeight: "700",
                textAlign:
                  "center",
                color:
                  "#0f766e",
              }),

              textElement({
                id: "r2-card-text",
                x: 68,
                y: 52,
                width: 19,
                height: 10,
                text:
                  "Define the problem clearly",
                fontSize: 16,
                fontWeight: "600",
                textAlign:
                  "center",
                color:
                  "#115e59",
              }),
            ],
          }),

          // SLIDE 3
          makeSlide({
            id: "research-3",

            background: {
              type: "solid",
              value: "#ffffff",
            },

            elements: [
              textElement({
                id: "r3-title",
                x: 7,
                y: 8,
                width: 50,
                height: 10,
                text:
                  "Research Objectives",
                fontSize: 34,
                fontWeight: "700",
              }),

              textElement({
                id: "r3-sub",
                x: 7,
                y: 19,
                width: 50,
                height: 8,
                text:
                  "What this study aims to achieve",
                fontSize: 16,
                color:
                  "#64748b",
              }),

              ...[
                {
                  y: 34,
                  number: "01",
                  title:
                    "Primary Objective",
                  text:
                    "State the main research objective.",
                },
                {
                  y: 52,
                  number: "02",
                  title:
                    "Secondary Objective",
                  text:
                    "Describe the second major goal.",
                },
                {
                  y: 70,
                  number: "03",
                  title:
                    "Expected Outcome",
                  text:
                    "Clarify what the study should reveal.",
                },
              ].flatMap(
                (
                  item,
                  index
                ) => [
                  shapeElement({
                    id:
                      `r3-circle-${index}`,
                    x: 8,
                    y: item.y,
                    width: 7,
                    height: 12,
                    backgroundColor:
                      "#0f766e",
                    borderRadius:
                      "999px",
                  }),

                  textElement({
                    id:
                      `r3-number-${index}`,
                    x: 8,
                    y:
                      item.y + 2,
                    width: 7,
                    height: 5,
                    text:
                      item.number,
                    fontSize: 14,
                    fontWeight:
                      "700",
                    textAlign:
                      "center",
                    color:
                      "#ffffff",
                  }),

                  textElement({
                    id:
                      `r3-title-${index}`,
                    x: 18,
                    y:
                      item.y - 1,
                    width: 35,
                    height: 7,
                    text:
                      item.title,
                    fontSize: 20,
                    fontWeight:
                      "700",
                    color:
                      "#0f172a",
                  }),

                  textElement({
                    id:
                      `r3-text-${index}`,
                    x: 18,
                    y:
                      item.y + 7,
                    width: 55,
                    height: 6,
                    text:
                      item.text,
                    fontSize: 16,
                    color:
                      "#64748b",
                  }),
                ]
              ),
            ],
          }),

          // SLIDE 4
          makeSlide({
            id: "research-4",

            background: {
              type: "gradient",
              value:
                "linear-gradient(135deg, #ecfeff 0%, #f0fdfa 100%)",
            },

            elements: [
              textElement({
                id: "r4-title",
                x: 7,
                y: 8,
                width: 45,
                height: 10,
                text:
                  "Methodology",
                fontSize: 34,
                fontWeight: "700",
                color:
                  "#134e4a",
              }),

              textElement({
                id: "r4-sub",
                x: 7,
                y: 19,
                width: 50,
                height: 7,
                text:
                  "A simple overview of the research process",
                fontSize: 16,
                color:
                  "#64748b",
              }),

              ...[
                {
                  x: 7,
                  title:
                    "Sample",
                  text:
                    "Participants / samples",
                },
                {
                  x: 29,
                  title:
                    "Method",
                  text:
                    "Experimental approach",
                },
                {
                  x: 51,
                  title:
                    "Analysis",
                  text:
                    "Data processing",
                },
                {
                  x: 73,
                  title:
                    "Validation",
                  text:
                    "Verification process",
                },
              ].flatMap(
                (
                  item,
                  index
                ) => [
                  shapeElement({
                    id:
                      `r4-card-${index}`,
                    x: item.x,
                    y: 37,
                    width: 18,
                    height: 35,
                    backgroundColor:
                      "#ffffff",
                    borderRadius:
                      "20px",
                    border:
                      "1px solid #99f6e4",
                    boxShadow:
                      "0 10px 25px rgba(15,118,110,0.08)",
                  }),

                  textElement({
                    id:
                      `r4-step-${index}`,
                    x:
                      item.x + 2,
                    y: 41,
                    width: 14,
                    height: 7,
                    text:
                      `0${index + 1}`,
                    fontSize: 16,
                    fontWeight:
                      "700",
                    textAlign:
                      "center",
                    color:
                      "#14b8a6",
                  }),

                  textElement({
                    id:
                      `r4-card-title-${index}`,
                    x:
                      item.x + 2,
                    y: 51,
                    width: 14,
                    height: 8,
                    text:
                      item.title,
                    fontSize: 18,
                    fontWeight:
                      "700",
                    textAlign:
                      "center",
                    color:
                      "#134e4a",
                  }),

                  textElement({
                    id:
                      `r4-card-text-${index}`,
                    x:
                      item.x + 2,
                    y: 62,
                    width: 14,
                    height: 7,
                    text:
                      item.text,
                    fontSize: 13,
                    textAlign:
                      "center",
                    color:
                      "#64748b",
                  }),
                ]
              ),
            ],
          }),

          // SLIDE 5
          makeSlide({
            id: "research-5",

            background: {
              type: "solid",
              value: "#ffffff",
            },

            elements: [
              textElement({
                id: "r5-title",
                x: 7,
                y: 8,
                width: 50,
                height: 10,
                text:
                  "Results",
                fontSize: 34,
                fontWeight: "700",
              }),

              textElement({
                id: "r5-sub",
                x: 7,
                y: 19,
                width: 55,
                height: 7,
                text:
                  "Present the most important findings",
                fontSize: 16,
                color:
                  "#64748b",
              }),

              shapeElement({
                id: "r5-chart-card",
                x: 7,
                y: 32,
                width: 55,
                height: 45,
                backgroundColor:
                  "#f8fafc",
                borderRadius:
                  "20px",
                border:
                  "1px solid #e2e8f0",
              }),

              ...[
                {
                  x: 13,
                  height: 17,
                },
                {
                  x: 23,
                  height: 27,
                },
                {
                  x: 33,
                  height: 22,
                },
                {
                  x: 43,
                  height: 36,
                },
                {
                  x: 53,
                  height: 31,
                },
              ].map(
                (
                  bar,
                  index
                ) =>
                  shapeElement({
                    id:
                      `r5-bar-${index}`,
                    x: bar.x,
                    y:
                      69 -
                      bar.height,
                    width: 5,
                    height:
                      bar.height,
                    backgroundColor:
                      index === 3
                        ? "#0f766e"
                        : "#5eead4",
                    borderRadius:
                      "7px 7px 0 0",
                  })
              ),

              shapeElement({
                id: "r5-stat",
                x: 69,
                y: 32,
                width: 24,
                height: 20,
                backgroundColor:
                  "#ccfbf1",
                borderRadius:
                  "20px",
              }),

              textElement({
                id: "r5-stat-value",
                x: 72,
                y: 35,
                width: 18,
                height: 9,
                text: "78%",
                fontSize: 36,
                fontWeight: "700",
                textAlign:
                  "center",
                color:
                  "#0f766e",
              }),

              textElement({
                id: "r5-stat-label",
                x: 72,
                y: 46,
                width: 18,
                height: 5,
                text:
                  "Key result",
                fontSize: 13,
                textAlign:
                  "center",
                color:
                  "#115e59",
              }),

              textElement({
                id: "r5-insight",
                x: 69,
                y: 59,
                width: 24,
                height: 17,
                text:
                  "Add a concise interpretation of the result here.",
                fontSize: 16,
                color:
                  "#475569",
                lineHeight: 1.4,
              }),
            ],
          }),

          // SLIDE 6
          makeSlide({
            id: "research-6",

            background: {
              type: "gradient",
              value:
                "linear-gradient(135deg, #0f172a 0%, #134e4a 100%)",
            },

            elements: [
              textElement({
                id: "r6-title",
                x: 8,
                y: 12,
                width: 50,
                height: 10,
                text:
                  "Conclusion",
                fontSize: 36,
                fontWeight: "700",
                color:
                  "#ffffff",
              }),

              textElement({
                id: "r6-body",
                x: 8,
                y: 30,
                width: 52,
                height: 35,
                text:
                  "• Summarize the major finding\n• State the significance of the work\n• Mention limitations\n• Highlight future research opportunities",
                fontSize: 20,
                color:
                  "#d1fae5",
                lineHeight: 1.5,
              }),

              shapeElement({
                id: "r6-card",
                x: 69,
                y: 24,
                width: 22,
                height: 45,
                backgroundColor:
                  "#14b8a6",
                borderRadius:
                  "28px",
              }),

              textElement({
                id: "r6-card-title",
                x: 72,
                y: 34,
                width: 16,
                height: 12,
                text:
                  "Thank You",
                fontSize: 28,
                fontWeight: "700",
                textAlign:
                  "center",
                color:
                  "#ffffff",
              }),

              textElement({
                id: "r6-card-sub",
                x: 72,
                y: 52,
                width: 16,
                height: 8,
                text:
                  "Questions?",
                fontSize: 16,
                textAlign:
                  "center",
                color:
                  "#ccfbf1",
              }),
            ],
          }),
        ],
      });

    // ==================================================
    // PITCH DECK
    // ==================================================

    const pitchDeckTemplate =
      () => ({
        version: 1,

        templateId:
          "pitch-deck",

        settings: {
          aspectRatio: "16:9",
        },

        activeSlideId:
          "pitch-1",

        slides: [
          makeSlide({
            id: "pitch-1",

            background: {
              type: "gradient",
              value:
                "linear-gradient(135deg, #020617 0%, #1e293b 100%)",
            },

            elements: [
              shapeElement({
                id: "p1-orange",
                x: 67,
                y: 12,
                width: 24,
                height: 42,
                backgroundColor:
                  "#f97316",
                borderRadius:
                  "36px",
              }),

              shapeElement({
                id: "p1-yellow",
                x: 75,
                y: 55,
                width: 13,
                height: 23,
                backgroundColor:
                  "#fdba74",
                borderRadius:
                  "999px",
              }),

              textElement({
                id: "p1-title",
                x: 8,
                y: 24,
                width: 52,
                height: 20,
                text:
                  "Build the future",
                fontSize: 52,
                fontWeight: "700",
                color:
                  "#ffffff",
              }),

              textElement({
                id: "p1-sub",
                x: 8,
                y: 49,
                width: 48,
                height: 12,
                text:
                  "Your company • One-line value proposition",
                fontSize: 20,
                color:
                  "#cbd5e1",
              }),

              textElement({
                id: "p1-tag",
                x: 8,
                y: 78,
                width: 25,
                height: 6,
                text:
                  "PITCH DECK",
                fontSize: 12,
                fontWeight: "700",
                color:
                  "#fb923c",
              }),
            ],
          }),

          makeSlide({
            id: "pitch-2",

            background: {
              type: "solid",
              value: "#ffffff",
            },

            elements: [
              textElement({
                id: "p2-title",
                x: 7,
                y: 9,
                width: 40,
                height: 10,
                text:
                  "The Problem",
                fontSize: 36,
                fontWeight: "700",
              }),

              textElement({
                id: "p2-body",
                x: 7,
                y: 27,
                width: 48,
                height: 35,
                text:
                  "Describe the customer pain point clearly.\n\nExplain who experiences it, how often it occurs, and why existing solutions are insufficient.",
                fontSize: 20,
                color:
                  "#475569",
                lineHeight: 1.45,
              }),

              shapeElement({
                id: "p2-stat-card",
                x: 65,
                y: 25,
                width: 27,
                height: 42,
                backgroundColor:
                  "#fff7ed",
                borderRadius:
                  "28px",
              }),

              textElement({
                id: "p2-stat",
                x: 68,
                y: 34,
                width: 21,
                height: 14,
                text:
                  "73%",
                fontSize: 46,
                fontWeight: "700",
                textAlign:
                  "center",
                color:
                  "#ea580c",
              }),

              textElement({
                id: "p2-stat-label",
                x: 68,
                y: 52,
                width: 21,
                height: 10,
                text:
                  "Add your strongest problem statistic",
                fontSize: 14,
                textAlign:
                  "center",
                color:
                  "#9a3412",
              }),
            ],
          }),

          makeSlide({
            id: "pitch-3",

            background: {
              type: "gradient",
              value:
                "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)",
            },

            elements: [
              textElement({
                id: "p3-title",
                x: 7,
                y: 9,
                width: 50,
                height: 10,
                text:
                  "Our Solution",
                fontSize: 36,
                fontWeight: "700",
                color:
                  "#7c2d12",
              }),

              textElement({
                id: "p3-copy",
                x: 7,
                y: 27,
                width: 45,
                height: 32,
                text:
                  "Explain your product simply.\n\nFocus on the benefit, not just the feature.",
                fontSize: 20,
                color:
                  "#9a3412",
                lineHeight: 1.5,
              }),

              shapeElement({
                id: "p3-product",
                x: 61,
                y: 22,
                width: 31,
                height: 50,
                backgroundColor:
                  "#ffffff",
                borderRadius:
                  "30px",
                boxShadow:
                  "0 20px 40px rgba(124,45,18,0.14)",
              }),

              shapeElement({
                id: "p3-inner",
                x: 66,
                y: 29,
                width: 21,
                height: 30,
                backgroundColor:
                  "#fb923c",
                borderRadius:
                  "18px",
              }),

              textElement({
                id: "p3-product-text",
                x: 67,
                y: 39,
                width: 19,
                height: 9,
                text:
                  "PRODUCT",
                fontSize: 18,
                fontWeight: "700",
                textAlign:
                  "center",
                color:
                  "#ffffff",
              }),
            ],
          }),

          makeSlide({
            id: "pitch-4",

            background: {
              type: "solid",
              value: "#0f172a",
            },

            elements: [
              textElement({
                id: "p4-title",
                x: 7,
                y: 9,
                width: 45,
                height: 10,
                text:
                  "Market Opportunity",
                fontSize: 36,
                fontWeight: "700",
                color:
                  "#ffffff",
              }),

              ...[
                {
                  x: 8,
                  value: "$12B",
                  label: "TAM",
                },
                {
                  x: 37,
                  value: "$4B",
                  label: "SAM",
                },
                {
                  x: 66,
                  value: "$800M",
                  label: "SOM",
                },
              ].flatMap(
                (
                  item,
                  index
                ) => [
                  shapeElement({
                    id:
                      `p4-card-${index}`,
                    x: item.x,
                    y: 34,
                    width: 23,
                    height: 28,
                    backgroundColor:
                      "#1e293b",
                    borderRadius:
                      "24px",
                    border:
                      "1px solid #334155",
                  }),

                  textElement({
                    id:
                      `p4-value-${index}`,
                    x:
                      item.x + 2,
                    y: 40,
                    width: 19,
                    height: 10,
                    text:
                      item.value,
                    fontSize: 32,
                    fontWeight:
                      "700",
                    textAlign:
                      "center",
                    color:
                      "#fb923c",
                  }),

                  textElement({
                    id:
                      `p4-label-${index}`,
                    x:
                      item.x + 2,
                    y: 53,
                    width: 19,
                    height: 5,
                    text:
                      item.label,
                    fontSize: 15,
                    fontWeight:
                      "700",
                    textAlign:
                      "center",
                    color:
                      "#cbd5e1",
                  }),
                ]
              ),
            ],
          }),

          makeSlide({
            id: "pitch-5",

            background: {
              type: "solid",
              value: "#ffffff",
            },

            elements: [
              textElement({
                id: "p5-title",
                x: 7,
                y: 9,
                width: 45,
                height: 10,
                text:
                  "Business Model",
                fontSize: 36,
                fontWeight: "700",
              }),

              ...[
                {
                  x: 7,
                  title:
                    "Customer",
                  text:
                    "Who pays?",
                },
                {
                  x: 36,
                  title:
                    "Revenue",
                  text:
                    "How do you earn?",
                },
                {
                  x: 65,
                  title:
                    "Growth",
                  text:
                    "How does it scale?",
                },
              ].flatMap(
                (
                  item,
                  index
                ) => [
                  shapeElement({
                    id:
                      `p5-card-${index}`,
                    x: item.x,
                    y: 34,
                    width: 24,
                    height: 32,
                    backgroundColor:
                      index === 1
                        ? "#fff7ed"
                        : "#f8fafc",
                    borderRadius:
                      "24px",
                    border:
                      "1px solid #e2e8f0",
                  }),

                  textElement({
                    id:
                      `p5-title-${index}`,
                    x:
                      item.x + 2,
                    y: 41,
                    width: 20,
                    height: 8,
                    text:
                      item.title,
                    fontSize: 20,
                    fontWeight:
                      "700",
                    textAlign:
                      "center",
                    color:
                      index === 1
                        ? "#ea580c"
                        : "#0f172a",
                  }),

                  textElement({
                    id:
                      `p5-text-${index}`,
                    x:
                      item.x + 3,
                    y: 54,
                    width: 18,
                    height: 8,
                    text:
                      item.text,
                    fontSize: 15,
                    textAlign:
                      "center",
                    color:
                      "#64748b",
                  }),
                ]
              ),
            ],
          }),

          makeSlide({
            id: "pitch-6",

            background: {
              type: "gradient",
              value:
                "linear-gradient(135deg, #020617 0%, #7c2d12 100%)",
            },

            elements: [
              textElement({
                id: "p6-title",
                x: 8,
                y: 22,
                width: 60,
                height: 16,
                text:
                  "Let's build something great.",
                fontSize: 46,
                fontWeight: "700",
                color:
                  "#ffffff",
              }),

              textElement({
                id: "p6-sub",
                x: 8,
                y: 47,
                width: 45,
                height: 10,
                text:
                  "Contact • email@example.com",
                fontSize: 20,
                color:
                  "#fed7aa",
              }),

              shapeElement({
                id: "p6-circle",
                x: 72,
                y: 26,
                width: 16,
                height: 28,
                backgroundColor:
                  "#f97316",
                borderRadius:
                  "999px",
              }),
            ],
          }),
        ],
      });

    // ==================================================
    // PROJECT UPDATE
    // ==================================================

    const projectUpdateTemplate =
      () => ({
        version: 1,

        templateId:
          "project-update",

        settings: {
          aspectRatio: "16:9",
        },

        activeSlideId:
          "update-1",

        slides: [
          makeSlide({
            id: "update-1",

            background: {
              type: "gradient",
              value:
                "linear-gradient(135deg, #eff6ff 0%, #eef2ff 100%)",
            },

            elements: [
              textElement({
                id: "u1-title",
                x: 7,
                y: 25,
                width: 55,
                height: 16,
                text:
                  "Project Update",
                fontSize: 50,
                fontWeight: "700",
                color:
                  "#1e3a8a",
              }),

              textElement({
                id: "u1-sub",
                x: 7,
                y: 48,
                width: 48,
                height: 10,
                text:
                  "Project name • Reporting period",
                fontSize: 20,
                color:
                  "#64748b",
              }),

              shapeElement({
                id: "u1-card",
                x: 67,
                y: 19,
                width: 24,
                height: 45,
                backgroundColor:
                  "#2563eb",
                borderRadius:
                  "28px",
              }),

              textElement({
                id: "u1-status",
                x: 70,
                y: 31,
                width: 18,
                height: 10,
                text:
                  "ON TRACK",
                fontSize: 22,
                fontWeight: "700",
                textAlign:
                  "center",
                color:
                  "#ffffff",
              }),

              textElement({
                id: "u1-period",
                x: 70,
                y: 48,
                width: 18,
                height: 8,
                text:
                  "August 2026",
                fontSize: 15,
                textAlign:
                  "center",
                color:
                  "#dbeafe",
              }),
            ],
          }),

          makeSlide({
            id: "update-2",

            background: {
              type: "solid",
              value: "#ffffff",
            },

            elements: [
              textElement({
                id: "u2-title",
                x: 7,
                y: 8,
                width: 40,
                height: 10,
                text:
                  "At a Glance",
                fontSize: 34,
                fontWeight: "700",
              }),

              ...[
                {
                  x: 7,
                  value: "78%",
                  label:
                    "Progress",
                  color:
                    "#2563eb",
                },
                {
                  x: 31,
                  value: "24",
                  label:
                    "Tasks Done",
                  color:
                    "#7c3aed",
                },
                {
                  x: 55,
                  value: "2",
                  label:
                    "Risks",
                  color:
                    "#f59e0b",
                },
                {
                  x: 79,
                  value: "4",
                  label:
                    "Milestones",
                  color:
                    "#10b981",
                },
              ].flatMap(
                (
                  item,
                  index
                ) => [
                  shapeElement({
                    id:
                      `u2-card-${index}`,
                    x: item.x,
                    y: 34,
                    width: 17,
                    height: 28,
                    backgroundColor:
                      "#f8fafc",
                    borderRadius:
                      "22px",
                    border:
                      "1px solid #e2e8f0",
                  }),

                  textElement({
                    id:
                      `u2-value-${index}`,
                    x:
                      item.x + 1,
                    y: 39,
                    width: 15,
                    height: 10,
                    text:
                      item.value,
                    fontSize: 30,
                    fontWeight:
                      "700",
                    textAlign:
                      "center",
                    color:
                      item.color,
                  }),

                  textElement({
                    id:
                      `u2-label-${index}`,
                    x:
                      item.x + 1,
                    y: 53,
                    width: 15,
                    height: 5,
                    text:
                      item.label,
                    fontSize: 13,
                    textAlign:
                      "center",
                    color:
                      "#64748b",
                  }),
                ]
              ),
            ],
          }),

          makeSlide({
            id: "update-3",

            background: {
              type: "solid",
              value: "#f8fafc",
            },

            elements: [
              textElement({
                id: "u3-title",
                x: 7,
                y: 8,
                width: 45,
                height: 10,
                text:
                  "Milestones",
                fontSize: 34,
                fontWeight: "700",
              }),

              ...[
                {
                  y: 29,
                  number: "01",
                  text:
                    "Research completed",
                },
                {
                  y: 43,
                  number: "02",
                  text:
                    "Design approved",
                },
                {
                  y: 57,
                  number: "03",
                  text:
                    "Development in progress",
                },
                {
                  y: 71,
                  number: "04",
                  text:
                    "Testing scheduled",
                },
              ].flatMap(
                (
                  item,
                  index
                ) => [
                  shapeElement({
                    id:
                      `u3-dot-${index}`,
                    x: 9,
                    y: item.y,
                    width: 5,
                    height: 9,
                    backgroundColor:
                      index < 2
                        ? "#2563eb"
                        : "#cbd5e1",
                    borderRadius:
                      "999px",
                  }),

                  textElement({
                    id:
                      `u3-num-${index}`,
                    x: 17,
                    y:
                      item.y - 1,
                    width: 10,
                    height: 6,
                    text:
                      item.number,
                    fontSize: 15,
                    fontWeight:
                      "700",
                    color:
                      "#2563eb",
                  }),

                  textElement({
                    id:
                      `u3-text-${index}`,
                    x: 28,
                    y:
                      item.y - 1,
                    width: 48,
                    height: 7,
                    text:
                      item.text,
                    fontSize: 19,
                    color:
                      "#334155",
                  }),
                ]
              ),
            ],
          }),

          makeSlide({
            id: "update-4",

            background: {
              type: "solid",
              value: "#ffffff",
            },

            elements: [
              textElement({
                id: "u4-title",
                x: 7,
                y: 8,
                width: 50,
                height: 10,
                text:
                  "Risks & Blockers",
                fontSize: 34,
                fontWeight: "700",
              }),

              ...[
                {
                  y: 31,
                  color:
                    "#fef3c7",
                  title:
                    "Dependency delay",
                  level:
                    "MEDIUM",
                },
                {
                  y: 52,
                  color:
                    "#fee2e2",
                  title:
                    "Resource constraint",
                  level:
                    "HIGH",
                },
              ].flatMap(
                (
                  item,
                  index
                ) => [
                  shapeElement({
                    id:
                      `u4-card-${index}`,
                    x: 7,
                    y: item.y,
                    width: 86,
                    height: 15,
                    backgroundColor:
                      item.color,
                    borderRadius:
                      "18px",
                  }),

                  textElement({
                    id:
                      `u4-title-${index}`,
                    x: 10,
                    y:
                      item.y + 3,
                    width: 50,
                    height: 6,
                    text:
                      item.title,
                    fontSize: 18,
                    fontWeight:
                      "700",
                    color:
                      "#334155",
                  }),

                  textElement({
                    id:
                      `u4-level-${index}`,
                    x: 77,
                    y:
                      item.y + 3,
                    width: 12,
                    height: 6,
                    text:
                      item.level,
                    fontSize: 13,
                    fontWeight:
                      "700",
                    textAlign:
                      "center",
                    color:
                      index === 1
                        ? "#b91c1c"
                        : "#b45309",
                  }),
                ]
              ),
            ],
          }),

          makeSlide({
            id: "update-5",

            background: {
              type: "gradient",
              value:
                "linear-gradient(135deg, #1e3a8a 0%, #312e81 100%)",
            },

            elements: [
              textElement({
                id: "u5-title",
                x: 8,
                y: 12,
                width: 45,
                height: 10,
                text:
                  "Next Steps",
                fontSize: 36,
                fontWeight: "700",
                color:
                  "#ffffff",
              }),

              textElement({
                id: "u5-list",
                x: 8,
                y: 32,
                width: 55,
                height: 35,
                text:
                  "01  Complete development\n02  Run validation tests\n03  Resolve open risks\n04  Prepare release plan",
                fontSize: 22,
                color:
                  "#dbeafe",
                lineHeight: 1.6,
              }),

              shapeElement({
                id: "u5-circle",
                x: 72,
                y: 31,
                width: 15,
                height: 27,
                backgroundColor:
                  "#60a5fa",
                borderRadius:
                  "999px",
              }),
            ],
          }),
        ],
      });

    // ==================================================
    // PORTFOLIO
    // ==================================================

    const portfolioTemplate =
      () => ({
        version: 1,

        templateId:
          "portfolio",

        settings: {
          aspectRatio: "16:9",
        },

        activeSlideId:
          "portfolio-1",

        slides: [
          makeSlide({
            id: "portfolio-1",

            background: {
              type: "gradient",
              value:
                "linear-gradient(135deg, #fdf2f8 0%, #fff7ed 100%)",
            },

            elements: [
              shapeElement({
                id: "pf1-circle",
                x: 7,
                y: 20,
                width: 22,
                height: 39,
                backgroundColor:
                  "#f9a8d4",
                borderRadius:
                  "999px",
              }),

              textElement({
                id: "pf1-name",
                x: 38,
                y: 24,
                width: 50,
                height: 14,
                text:
                  "Your Name",
                fontSize: 48,
                fontWeight: "700",
                color:
                  "#831843",
              }),

              textElement({
                id: "pf1-role",
                x: 38,
                y: 44,
                width: 45,
                height: 8,
                text:
                  "Product • Design • Research",
                fontSize: 20,
                color:
                  "#9d174d",
              }),

              textElement({
                id: "pf1-intro",
                x: 38,
                y: 59,
                width: 47,
                height: 13,
                text:
                  "A short introduction about your work, interests, and strengths.",
                fontSize: 17,
                color:
                  "#64748b",
                lineHeight: 1.4,
              }),
            ],
          }),

          makeSlide({
            id: "portfolio-2",

            background: {
              type: "solid",
              value: "#ffffff",
            },

            elements: [
              textElement({
                id: "pf2-title",
                x: 7,
                y: 8,
                width: 40,
                height: 10,
                text:
                  "About Me",
                fontSize: 36,
                fontWeight: "700",
                color:
                  "#831843",
              }),

              textElement({
                id: "pf2-body",
                x: 7,
                y: 27,
                width: 48,
                height: 40,
                text:
                  "Write a concise introduction about your background, experience, interests, and the kind of problems you enjoy solving.",
                fontSize: 21,
                color:
                  "#475569",
                lineHeight: 1.5,
              }),

              shapeElement({
                id: "pf2-card",
                x: 65,
                y: 25,
                width: 27,
                height: 43,
                backgroundColor:
                  "#fdf2f8",
                borderRadius:
                  "28px",
              }),

              textElement({
                id: "pf2-card-text",
                x: 69,
                y: 36,
                width: 19,
                height: 18,
                text:
                  "Curious\nCreative\nImpact-driven",
                fontSize: 20,
                fontWeight: "700",
                textAlign:
                  "center",
                color:
                  "#be185d",
                lineHeight: 1.6,
              }),
            ],
          }),

          makeSlide({
            id: "portfolio-3",

            background: {
              type: "gradient",
              value:
                "linear-gradient(135deg, #fff1f2 0%, #faf5ff 100%)",
            },

            elements: [
              textElement({
                id: "pf3-title",
                x: 7,
                y: 8,
                width: 50,
                height: 10,
                text:
                  "Selected Work",
                fontSize: 36,
                fontWeight: "700",
                color:
                  "#881337",
              }),

              ...[
                {
                  x: 7,
                  y: 31,
                  color:
                    "#fce7f3",
                  title:
                    "Project One",
                },
                {
                  x: 52,
                  y: 31,
                  color:
                    "#ffedd5",
                  title:
                    "Project Two",
                },
                {
                  x: 7,
                  y: 59,
                  color:
                    "#ede9fe",
                  title:
                    "Project Three",
                },
                {
                  x: 52,
                  y: 59,
                  color:
                    "#dbeafe",
                  title:
                    "Project Four",
                },
              ].flatMap(
                (
                  item,
                  index
                ) => [
                  shapeElement({
                    id:
                      `pf3-card-${index}`,
                    x: item.x,
                    y: item.y,
                    width: 40,
                    height: 21,
                    backgroundColor:
                      item.color,
                    borderRadius:
                      "22px",
                  }),

                  textElement({
                    id:
                      `pf3-title-${index}`,
                    x:
                      item.x + 3,
                    y:
                      item.y + 5,
                    width: 34,
                    height: 7,
                    text:
                      item.title,
                    fontSize: 18,
                    fontWeight:
                      "700",
                    color:
                      "#334155",
                  }),

                  textElement({
                    id:
                      `pf3-desc-${index}`,
                    x:
                      item.x + 3,
                    y:
                      item.y + 13,
                    width: 34,
                    height: 5,
                    text:
                      "Short project description",
                    fontSize: 13,
                    color:
                      "#64748b",
                  }),
                ]
              ),
            ],
          }),

          makeSlide({
            id: "portfolio-4",

            background: {
              type: "solid",
              value: "#ffffff",
            },

            elements: [
              textElement({
                id: "pf4-title",
                x: 7,
                y: 8,
                width: 50,
                height: 10,
                text:
                  "Skills & Strengths",
                fontSize: 36,
                fontWeight: "700",
                color:
                  "#831843",
              }),

              ...[
                {
                  x: 7,
                  title:
                    "Product",
                  text:
                    "Research\nStrategy\nAnalytics",
                },
                {
                  x: 37,
                  title:
                    "Design",
                  text:
                    "UX thinking\nPrototyping\nStorytelling",
                },
                {
                  x: 67,
                  title:
                    "Technology",
                  text:
                    "AI\nData\nDevelopment",
                },
              ].flatMap(
                (
                  item,
                  index
                ) => [
                  shapeElement({
                    id:
                      `pf4-card-${index}`,
                    x: item.x,
                    y: 32,
                    width: 25,
                    height: 38,
                    backgroundColor:
                      index === 0
                        ? "#fdf2f8"
                        : index ===
                            1
                          ? "#fff7ed"
                          : "#f5f3ff",
                    borderRadius:
                      "24px",
                  }),

                  textElement({
                    id:
                      `pf4-title-${index}`,
                    x:
                      item.x + 3,
                    y: 39,
                    width: 19,
                    height: 8,
                    text:
                      item.title,
                    fontSize: 21,
                    fontWeight:
                      "700",
                    textAlign:
                      "center",
                    color:
                      "#475569",
                  }),

                  textElement({
                    id:
                      `pf4-text-${index}`,
                    x:
                      item.x + 3,
                    y: 52,
                    width: 19,
                    height: 14,
                    text:
                      item.text,
                    fontSize: 15,
                    textAlign:
                      "center",
                    color:
                      "#64748b",
                    lineHeight: 1.5,
                  }),
                ]
              ),
            ],
          }),

          makeSlide({
            id: "portfolio-5",

            background: {
              type: "gradient",
              value:
                "linear-gradient(135deg, #831843 0%, #7c2d12 100%)",
            },

            elements: [
              textElement({
                id: "pf5-title",
                x: 8,
                y: 25,
                width: 55,
                height: 15,
                text:
                  "Let's connect.",
                fontSize: 50,
                fontWeight: "700",
                color:
                  "#ffffff",
              }),

              textElement({
                id: "pf5-email",
                x: 8,
                y: 50,
                width: 50,
                height: 8,
                text:
                  "email@example.com",
                fontSize: 20,
                color:
                  "#fecdd3",
              }),

              shapeElement({
                id: "pf5-circle",
                x: 72,
                y: 28,
                width: 15,
                height: 27,
                backgroundColor:
                  "#fb7185",
                borderRadius:
                  "999px",
              }),
            ],
          }),
        ],
      });

    // ==================================================
    // CHOOSE INITIAL DATA
    // ==================================================

    let initialPresentation =
      blankPresentation();

    if (
      templateId ===
      "research-presentation"
    ) {
      initialPresentation =
        researchTemplate();
    }

    if (
      templateId ===
      "pitch-deck"
    ) {
      initialPresentation =
        pitchDeckTemplate();
    }

    if (
      templateId ===
      "project-update"
    ) {
      initialPresentation =
        projectUpdateTemplate();
    }

    if (
      templateId ===
      "portfolio"
    ) {
      initialPresentation =
        portfolioTemplate();
    }

    // ==================================================
    // SERIALIZE
    // ==================================================

    const content =
      JSON.stringify(
        initialPresentation
      );

    const buffer =
      Buffer.from(
        content,
        "utf8"
      );

    // ==================================================
    // STORAGE PATH
    // ==================================================

    const storagePath =
      buildStoragePath({
        ownerId,
        folderId,

        originalName:
          presentationName,
      });

    uploadedStoragePath =
      storagePath;

    // ==================================================
    // UPLOAD
    // ==================================================

    await uploadFileToStorage({
      buffer,
      storagePath,

      mimeType:
        "application/json",
    });

    // ==================================================
    // INSERT DB RECORD
    // ==================================================

    const {
      data: file,
      error: insertError,
    } = await supabase
      .from("files")
      .insert({
        name:
          presentationName,

        mime_type:
          "application/json",

        file_kind:
          "presentation",

        size_bytes:
          buffer.length,

        storage_path:
          storagePath,

        owner_id:
          ownerId,

        folder_id:
          folderId,
      })
      .select(
        `
        id,
        name,
        mime_type,
        file_kind,
        size_bytes,
        storage_path,
        owner_id,
        folder_id,
        is_deleted,
        is_starred,
        created_at,
        updated_at
        `
      )
      .single();

    if (insertError) {
      await deleteFileFromStorage(
        storagePath
      );

      throw insertError;
    }

    return res.status(201).json({
      message:
        templateId
          ? "Presentation created from template successfully"
          : "Presentation created successfully",

      presentation: {
        id:
          file.id,

        name:
          file.name,

        mimeType:
          file.mime_type,

        fileKind:
          file.file_kind,

        sizeBytes:
          file.size_bytes,

        ownerId:
          file.owner_id,

        folderId:
          file.folder_id,

        isDeleted:
          file.is_deleted,

        isStarred:
          file.is_starred,

        createdAt:
          file.created_at,

        updatedAt:
          file.updated_at,

        data:
          initialPresentation,
      },
    });
  } catch (error) {
    console.error(
      "Create presentation error:",
      error
    );

    if (
      uploadedStoragePath
    ) {
      try {
        await deleteFileFromStorage(
          uploadedStoragePath
        );
      } catch (
        cleanupError
      ) {
        console.error(
          "Presentation cleanup error:",
          cleanupError
        );
      }
    }

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to create presentation",
      },
    });
  }
};

// ======================================================
// GET CLOUD PRESENTATION
// ======================================================

const getPresentation = async (
  req,
  res
) => {
  try {
    const userId =
      req.user.id;

    const fileId =
      req.params.id;

    // ==================================================
    // GET DATABASE FILE
    // ==================================================

    const {
      data: file,
      error: fileError,
    } = await supabase
      .from("files")
      .select(
        `
        id,
        name,
        mime_type,
        file_kind,
        size_bytes,
        storage_path,
        owner_id,
        folder_id,
        is_deleted,
        is_starred,
        created_at,
        updated_at
        `
      )
      .eq(
        "id",
        fileId
      )
      .maybeSingle();

    if (fileError) {
      throw fileError;
    }

    if (
      !file ||
      file.is_deleted
    ) {
      return res.status(404).json({
        error: {
          code:
            "FILE_NOT_FOUND",

          message:
            "Presentation not found",
        },
      });
    }

    // ==================================================
    // VERIFY TYPE
    // ==================================================

    if (
      file.file_kind !==
      "presentation"
    ) {
      return res.status(400).json({
        error: {
          code:
            "NOT_A_PRESENTATION",

          message:
            "This file is not an editable Cloud Drive presentation",
        },
      });
    }

    // ==================================================
    // CHECK ACCESS
    // ==================================================

    const access =
      await getFileAccess({
        file,
        userId,
      });

    if (!access.hasAccess) {
      return res.status(403).json({
        error: {
          code:
            "FORBIDDEN",

          message:
            "You do not have access to this presentation",
        },
      });
    }

    // ==================================================
    // DOWNLOAD PRESENTATION CONTENT
    // ==================================================

    const {
      data: storageFile,
      error: downloadError,
    } =
      await supabase.storage
        .from(bucketName)
        .download(
          file.storage_path
        );

    if (downloadError) {
      throw downloadError;
    }

    const rawContent =
      await storageFile.text();

    let presentationData;

    try {
      presentationData =
        JSON.parse(
          rawContent
        );
    } catch {
      return res.status(500).json({
        error: {
          code:
            "INVALID_PRESENTATION_DATA",

          message:
            "Presentation data is invalid",
        },
      });
    }

    // ==================================================
    // UPDATE LAST ACCESSED
    // ==================================================

    const accessedAt =
      new Date().toISOString();

    const {
      error: accessUpdateError,
    } = await supabase
      .from("files")
      .update({
        last_accessed_at:
          accessedAt,
      })
      .eq(
        "id",
        fileId
      );

    if (accessUpdateError) {
      console.error(
        "Unable to update last_accessed_at:",
        accessUpdateError
      );
    }

    // ==================================================
    // RESPONSE
    // ==================================================

    return res.status(200).json({
      presentation: {
        id:
          file.id,

        name:
          file.name,

        mimeType:
          file.mime_type,

        fileKind:
          file.file_kind,

        sizeBytes:
          file.size_bytes,

        ownerId:
          file.owner_id,

        folderId:
          file.folder_id,

        isStarred:
          file.is_starred,

        createdAt:
          file.created_at,

        updatedAt:
          file.updated_at,

        lastAccessedAt:
          accessedAt,

        permission:
          access.permission,

        accessType:
          access.accessType,

        canEdit:
          access.permission ===
            "owner" ||
          access.permission ===
            "editor",

        data:
          presentationData,
      },
    });
  } catch (error) {
    console.error(
      "Get presentation error:",
      error
    );

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to load presentation",
      },
    });
  }
};

// ======================================================
// SAVE CLOUD PRESENTATION
// OWNER / EDITOR
// ======================================================

const updatePresentationContent =
  async (req, res) => {
    try {
      const userId =
        req.user.id;

      const fileId =
        req.params.id;

      const {
        data,
      } = req.body;

      // ==================================================
      // VALIDATE DATA
      // ==================================================

      if (
        !data ||
        typeof data !==
          "object" ||
        Array.isArray(data)
      ) {
        return res.status(400).json({
          error: {
            code:
              "VALIDATION_ERROR",

            message:
              "Presentation data must be an object",
          },
        });
      }


      // ======================================================
// CREATE CLOUD PRESENTATION
// ======================================================

const createPresentation = async (req, res) => {
  let uploadedStoragePath = null;

  try {
    const ownerId = req.user.id;

    const {
      name,
      folderId = null,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Presentation name is required",
        },
      });
    }

    const cleanName = name.trim();

    const presentationName =
      cleanName
        .toLowerCase()
        .endsWith(".cloudslides")
        ? cleanName
        : `${cleanName}.cloudslides`;

    const targetValidation =
      await validateOwnedTargetFolder({
        folderId,
        ownerId,
      });

    if (!targetValidation.valid) {
      return res
        .status(targetValidation.status)
        .json({
          error: targetValidation.error,
        });
    }

    let duplicateQuery =
      supabase
        .from("files")
        .select("id")
        .eq("owner_id", ownerId)
        .eq("name", presentationName)
        .eq("is_deleted", false);

    if (folderId === null) {
      duplicateQuery =
        duplicateQuery.is(
          "folder_id",
          null
        );
    } else {
      duplicateQuery =
        duplicateQuery.eq(
          "folder_id",
          folderId
        );
    }

    const {
      data: existingPresentation,
      error: duplicateError,
    } =
      await duplicateQuery.maybeSingle();

    if (duplicateError) {
      throw duplicateError;
    }

    if (existingPresentation) {
      return res.status(409).json({
        error: {
          code: "PRESENTATION_EXISTS",
          message:
            "A presentation with this name already exists here",
        },
      });
    }

    const initialPresentation = {
      version: 1,

      slides: [
        {
          id: "slide-1",

          background: {
            type: "solid",
            value: "#ffffff",
          },

          elements: [
            {
              id: "title-1",
              type: "text",

              x: 10,
              y: 25,

              width: 80,
              height: 15,

              text: "Click to add title",

              style: {
                fontSize: 32,
                fontWeight: "700",
                textAlign: "center",
                color: "#0f172a",
              },
            },

            {
              id: "subtitle-1",
              type: "text",

              x: 15,
              y: 48,

              width: 70,
              height: 10,

              text:
                "Click to add subtitle",

              style: {
                fontSize: 18,
                fontWeight: "400",
                textAlign: "center",
                color: "#64748b",
              },
            },
          ],
        },
      ],

      activeSlideId: "slide-1",

      settings: {
        aspectRatio: "16:9",
      },
    };

    const content =
      JSON.stringify(
        initialPresentation
      );

    const buffer =
      Buffer.from(
        content,
        "utf8"
      );

    const storagePath =
      buildStoragePath({
        ownerId,
        folderId,
        originalName:
          presentationName,
      });

    uploadedStoragePath =
      storagePath;

    await uploadFileToStorage({
      buffer,
      storagePath,
      mimeType:
        "application/json",
    });

    const {
      data: file,
      error: insertError,
    } = await supabase
      .from("files")
      .insert({
        name:
          presentationName,

        mime_type:
          "application/json",

        file_kind:
          "presentation",

        size_bytes:
          buffer.length,

        storage_path:
          storagePath,

        owner_id:
          ownerId,

        folder_id:
          folderId,
      })
      .select(
        `
        id,
        name,
        mime_type,
        file_kind,
        size_bytes,
        storage_path,
        owner_id,
        folder_id,
        is_deleted,
        is_starred,
        created_at,
        updated_at
        `
      )
      .single();

    if (insertError) {
      await deleteFileFromStorage(
        storagePath
      );

      throw insertError;
    }

    return res.status(201).json({
      message:
        "Presentation created successfully",

      presentation: {
        id: file.id,
        name: file.name,

        mimeType:
          file.mime_type,

        fileKind:
          file.file_kind,

        sizeBytes:
          file.size_bytes,

        ownerId:
          file.owner_id,

        folderId:
          file.folder_id,

        isDeleted:
          file.is_deleted,

        isStarred:
          file.is_starred,

        createdAt:
          file.created_at,

        updatedAt:
          file.updated_at,

        data:
          initialPresentation,
      },
    });
  } catch (error) {
    console.error(
      "Create presentation error:",
      error
    );

    if (uploadedStoragePath) {
      try {
        await deleteFileFromStorage(
          uploadedStoragePath
        );
      } catch (cleanupError) {
        console.error(
          "Create presentation cleanup error:",
          cleanupError
        );
      }
    }

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to create presentation",
      },
    });
  }
};

// ======================================================
// GET CLOUD PRESENTATION
// ======================================================

const getPresentation = async (
  req,
  res
) => {
  try {
    const userId = req.user.id;
    const fileId = req.params.id;

    const {
      data: file,
      error: fileError,
    } = await supabase
      .from("files")
      .select(
        `
        id,
        name,
        mime_type,
        file_kind,
        size_bytes,
        storage_path,
        owner_id,
        folder_id,
        is_deleted,
        is_starred,
        created_at,
        updated_at
        `
      )
      .eq("id", fileId)
      .maybeSingle();

    if (fileError) {
      throw fileError;
    }

    if (!file || file.is_deleted) {
      return res.status(404).json({
        error: {
          code: "FILE_NOT_FOUND",
          message:
            "Presentation not found",
        },
      });
    }

    if (
      file.file_kind !==
      "presentation"
    ) {
      return res.status(400).json({
        error: {
          code:
            "NOT_A_PRESENTATION",

          message:
            "This file is not an editable Cloud Drive presentation",
        },
      });
    }

    const access =
      await getFileAccess({
        file,
        userId,
      });

    if (!access.hasAccess) {
      return res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message:
            "You do not have access to this presentation",
        },
      });
    }

    const {
      data: storageFile,
      error: downloadError,
    } =
      await supabase.storage
        .from(bucketName)
        .download(
          file.storage_path
        );

    if (downloadError) {
      throw downloadError;
    }

    const rawContent =
      await storageFile.text();

    let presentationData;

    try {
      presentationData =
        JSON.parse(rawContent);
    } catch {
      return res.status(500).json({
        error: {
          code:
            "INVALID_PRESENTATION_DATA",

          message:
            "Presentation data is invalid",
        },
      });
    }

    const accessedAt =
      new Date().toISOString();

    const {
      error: accessUpdateError,
    } = await supabase
      .from("files")
      .update({
        last_accessed_at:
          accessedAt,
      })
      .eq("id", fileId);

    if (accessUpdateError) {
      console.error(
        "Unable to update last_accessed_at:",
        accessUpdateError
      );
    }

    return res.status(200).json({
      presentation: {
        id: file.id,
        name: file.name,

        mimeType:
          file.mime_type,

        fileKind:
          file.file_kind,

        sizeBytes:
          file.size_bytes,

        ownerId:
          file.owner_id,

        folderId:
          file.folder_id,

        isStarred:
          file.is_starred,

        createdAt:
          file.created_at,

        updatedAt:
          file.updated_at,

        lastAccessedAt:
          accessedAt,

        permission:
          access.permission,

        accessType:
          access.accessType,

        canEdit:
          access.permission ===
            "owner" ||
          access.permission ===
            "editor",

        data:
          presentationData,
      },
    });
  } catch (error) {
    console.error(
      "Get presentation error:",
      error
    );

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to load presentation",
      },
    });
  }
};

// ======================================================
// SAVE CLOUD PRESENTATION
// ======================================================

const updatePresentationContent =
  async (req, res) => {
    try {
      const userId =
        req.user.id;

      const fileId =
        req.params.id;

      const { data } =
        req.body;

      if (
        !data ||
        typeof data !==
          "object" ||
        Array.isArray(data)
      ) {
        return res.status(400).json({
          error: {
            code:
              "VALIDATION_ERROR",

            message:
              "Presentation data must be an object",
          },
        });
      }

      const {
        data: file,
        error: fileError,
      } = await supabase
        .from("files")
        .select(
          `
          id,
          name,
          mime_type,
          file_kind,
          size_bytes,
          storage_path,
          owner_id,
          folder_id,
          is_deleted,
          is_starred,
          created_at,
          updated_at
          `
        )
        .eq("id", fileId)
        .maybeSingle();

      if (fileError) {
        throw fileError;
      }

      if (
        !file ||
        file.is_deleted
      ) {
        return res.status(404).json({
          error: {
            code:
              "FILE_NOT_FOUND",

            message:
              "Presentation not found",
          },
        });
      }

      if (
        file.file_kind !==
        "presentation"
      ) {
        return res.status(400).json({
          error: {
            code:
              "NOT_A_PRESENTATION",

            message:
              "This file is not an editable Cloud Drive presentation",
          },
        });
      }

      const access =
        await getFileAccess({
          file,
          userId,
        });

      if (!access.hasAccess) {
        return res.status(403).json({
          error: {
            code:
              "FORBIDDEN",

            message:
              "You do not have access to this presentation",
          },
        });
      }

      if (
        access.permission ===
        "viewer"
      ) {
        return res.status(403).json({
          error: {
            code:
              "VIEWER_READ_ONLY",

            message:
              "Viewer access is read-only",
          },
        });
      }

      const content =
        JSON.stringify(data);

      const buffer =
        Buffer.from(
          content,
          "utf8"
        );

      const {
        error: storageUpdateError,
      } =
        await supabase.storage
          .from(bucketName)
          .update(
            file.storage_path,
            buffer,
            {
              contentType:
                "application/json",

              upsert: true,
            }
          );

      if (storageUpdateError) {
        throw storageUpdateError;
      }

      const now =
        new Date().toISOString();

      const {
        data: updatedFile,
        error: metadataError,
      } = await supabase
        .from("files")
        .update({
          size_bytes:
            buffer.length,

          updated_at:
            now,

          last_accessed_at:
            now,
        })
        .eq("id", fileId)
        .select(
          `
          id,
          name,
          mime_type,
          file_kind,
          size_bytes,
          owner_id,
          folder_id,
          is_starred,
          created_at,
          updated_at,
          last_accessed_at
          `
        )
        .single();

      if (metadataError) {
        throw metadataError;
      }

      return res.status(200).json({
        message:
          "Presentation saved successfully",

        presentation: {
          id:
            updatedFile.id,

          name:
            updatedFile.name,

          mimeType:
            updatedFile.mime_type,

          fileKind:
            updatedFile.file_kind,

          sizeBytes:
            updatedFile.size_bytes,

          ownerId:
            updatedFile.owner_id,

          folderId:
            updatedFile.folder_id,

          isStarred:
            updatedFile.is_starred,

          createdAt:
            updatedFile.created_at,

          updatedAt:
            updatedFile.updated_at,

          lastAccessedAt:
            updatedFile.last_accessed_at,

          permission:
            access.permission,

          canEdit: true,

          data,
        },
      });
    } catch (error) {
      console.error(
        "Update presentation content error:",
        error
      );

      return res.status(500).json({
        error: {
          code:
            "INTERNAL_SERVER_ERROR",

          message:
            "Unable to save presentation",
        },
      });
    }
  };

      // ==================================================
      // GET FILE
      // ==================================================

      const {
        data: file,
        error: fileError,
      } = await supabase
        .from("files")
        .select(
          `
          id,
          name,
          mime_type,
          file_kind,
          size_bytes,
          storage_path,
          owner_id,
          folder_id,
          is_deleted,
          is_starred,
          created_at,
          updated_at
          `
        )
        .eq(
          "id",
          fileId
        )
        .maybeSingle();

      if (fileError) {
        throw fileError;
      }

      if (
        !file ||
        file.is_deleted
      ) {
        return res.status(404).json({
          error: {
            code:
              "FILE_NOT_FOUND",

            message:
              "Presentation not found",
          },
        });
      }

      // ==================================================
      // VERIFY TYPE
      // ==================================================

      if (
        file.file_kind !==
        "presentation"
      ) {
        return res.status(400).json({
          error: {
            code:
              "NOT_A_PRESENTATION",

            message:
              "This file is not an editable Cloud Drive presentation",
          },
        });
      }

      // ==================================================
      // CHECK ACCESS
      // ==================================================

      const access =
        await getFileAccess({
          file,
          userId,
        });

      if (!access.hasAccess) {
        return res.status(403).json({
          error: {
            code:
              "FORBIDDEN",

            message:
              "You do not have access to this presentation",
          },
        });
      }

      if (
        access.permission ===
        "viewer"
      ) {
        return res.status(403).json({
          error: {
            code:
              "VIEWER_READ_ONLY",

            message:
              "Viewer access is read-only",
          },
        });
      }

      // ==================================================
      // CONVERT TO JSON
      // ==================================================

      const content =
        JSON.stringify(data);

      const buffer =
        Buffer.from(
          content,
          "utf8"
        );

      // ==================================================
      // UPDATE STORAGE
      // ==================================================

      const {
        error:
          storageUpdateError,
      } =
        await supabase.storage
          .from(bucketName)
          .update(
            file.storage_path,
            buffer,
            {
              contentType:
                "application/json",

              upsert: true,
            }
          );

      if (storageUpdateError) {
        throw storageUpdateError;
      }

      // ==================================================
      // UPDATE DATABASE
      // ==================================================

      const now =
        new Date().toISOString();

      const {
        data: updatedFile,
        error: metadataError,
      } = await supabase
        .from("files")
        .update({
          size_bytes:
            buffer.length,

          updated_at:
            now,

          last_accessed_at:
            now,
        })
        .eq(
          "id",
          fileId
        )
        .select(
          `
          id,
          name,
          mime_type,
          file_kind,
          size_bytes,
          owner_id,
          folder_id,
          is_starred,
          created_at,
          updated_at,
          last_accessed_at
          `
        )
        .single();

      if (metadataError) {
        throw metadataError;
      }

      // ==================================================
      // RESPONSE
      // ==================================================

      return res.status(200).json({
        message:
          "Presentation saved successfully",

        presentation: {
          id:
            updatedFile.id,

          name:
            updatedFile.name,

          mimeType:
            updatedFile.mime_type,

          fileKind:
            updatedFile.file_kind,

          sizeBytes:
            updatedFile.size_bytes,

          ownerId:
            updatedFile.owner_id,

          folderId:
            updatedFile.folder_id,

          isStarred:
            updatedFile.is_starred,

          createdAt:
            updatedFile.created_at,

          updatedAt:
            updatedFile.updated_at,

          lastAccessedAt:
            updatedFile.last_accessed_at,

          permission:
            access.permission,

          canEdit: true,

          data,
        },
      });
    } catch (error) {
      console.error(
        "Update presentation content error:",
        error
      );

      return res.status(500).json({
        error: {
          code:
            "INTERNAL_SERVER_ERROR",

          message:
            "Unable to save presentation",
        },
      });
    }
  };


      // ==================================================
      // GET FILE
      // ==================================================

      const {
        data: file,
        error: fileError,
      } = await supabase
        .from("files")
        .select(
          `
          id,
          name,
          mime_type,
          file_kind,
          size_bytes,
          storage_path,
          owner_id,
          folder_id,
          is_deleted,
          is_starred,
          created_at,
          updated_at
          `
        )
        .eq(
          "id",
          fileId
        )
        .maybeSingle();

      if (fileError) {
        throw fileError;
      }

      if (
        !file ||
        file.is_deleted
      ) {
        return res.status(404).json({
          error: {
            code:
              "FILE_NOT_FOUND",

            message:
              "Spreadsheet not found",
          },
        });
      }

      // ==================================================
      // VERIFY TYPE
      // ==================================================

      if (
        file.file_kind !==
        "spreadsheet"
      ) {
        return res.status(400).json({
          error: {
            code:
              "NOT_A_SPREADSHEET",

            message:
              "This file is not an editable Cloud Drive spreadsheet",
          },
        });
      }

      // ==================================================
      // CHECK ACCESS
      // ==================================================

      const access =
        await getFileAccess({
          file,
          userId,
        });

      if (!access.hasAccess) {
        return res.status(403).json({
          error: {
            code:
              "FORBIDDEN",

            message:
              "You do not have access to this spreadsheet",
          },
        });
      }

      if (
        access.permission ===
        "viewer"
      ) {
        return res.status(403).json({
          error: {
            code:
              "VIEWER_READ_ONLY",

            message:
              "Viewer access is read-only",
          },
        });
      }

      // ==================================================
      // CONVERT TO JSON
      // ==================================================

      const content =
        JSON.stringify(data);

      const buffer =
        Buffer.from(
          content,
          "utf8"
        );

      // ==================================================
      // UPDATE STORAGE
      // ==================================================

      const {
        error:
          storageUpdateError,
      } =
        await supabase.storage
          .from(bucketName)
          .update(
            file.storage_path,
            buffer,
            {
              contentType:
                "application/json",

              upsert: true,
            }
          );

      if (storageUpdateError) {
        throw storageUpdateError;
      }

      // ==================================================
      // UPDATE DATABASE
      // ==================================================

      const now =
        new Date().toISOString();

      const {
        data: updatedFile,
        error: metadataError,
      } = await supabase
        .from("files")
        .update({
          size_bytes:
            buffer.length,

          updated_at:
            now,

          last_accessed_at:
            now,
        })
        .eq(
          "id",
          fileId
        )
        .select(
          `
          id,
          name,
          mime_type,
          file_kind,
          size_bytes,
          owner_id,
          folder_id,
          is_starred,
          created_at,
          updated_at,
          last_accessed_at
          `
        )
        .single();

      if (metadataError) {
        throw metadataError;
      }

      // ==================================================
      // RESPONSE
      // ==================================================

      return res.status(200).json({
        message:
          "Spreadsheet saved successfully",

        spreadsheet: {
          id:
            updatedFile.id,

          name:
            updatedFile.name,

          mimeType:
            updatedFile.mime_type,

          fileKind:
            updatedFile.file_kind,

          sizeBytes:
            updatedFile.size_bytes,

          ownerId:
            updatedFile.owner_id,

          folderId:
            updatedFile.folder_id,

          isStarred:
            updatedFile.is_starred,

          createdAt:
            updatedFile.created_at,

          updatedAt:
            updatedFile.updated_at,

          lastAccessedAt:
            updatedFile.last_accessed_at,

          permission:
            access.permission,

          canEdit: true,

          data,
        },
      });
    } catch (error) {
      console.error(
        "Update spreadsheet content error:",
        error
      );

      return res.status(500).json({
        error: {
          code:
            "INTERNAL_SERVER_ERROR",

          message:
            "Unable to save spreadsheet",
        },
      });
    }
  };


// ======================================================
// GET FILE
// ======================================================

const getFile = async (
  req,
  res
) => {
  try {
    const userId =
      req.user.id;

    const fileId =
      req.params.id;

    const {
      data: file,
      error,
    } = await supabase
      .from("files")
      .select(
        `
        id,
        name,
        mime_type,
        file_kind,
        size_bytes,
        storage_path,
        owner_id,
        folder_id,
        is_deleted,
        is_starred,
        created_at,
        updated_at,
        last_accessed_at
        `
      )
      .eq("id", fileId)
      .single();

    if (
      error ||
      !file ||
      file.is_deleted
    ) {
      return res.status(404).json({
        error: {
          code:
            "FILE_NOT_FOUND",

          message:
            "File not found",
        },
      });
    }

    const access =
      await getFileAccess({
        file,
        userId,
      });

    if (!access.hasAccess) {
      return res.status(403).json({
        error: {
          code: "FORBIDDEN",

          message:
            "You do not have access to this file",
        },
      });
    }

    const accessedAt =
      new Date().toISOString();

    const {
      error:
        accessUpdateError,
    } = await supabase
      .from("files")
      .update({
        last_accessed_at:
          accessedAt,
      })
      .eq("id", fileId);

    if (accessUpdateError) {
      console.error(
        "Unable to update last_accessed_at:",
        accessUpdateError
      );
    }

    const signedUrl =
      await createSignedDownloadUrl(
        file.storage_path,
        300
      );

    return res.status(200).json({
      file: {
        id:
          file.id,

        name:
          file.name,

        mimeType:
          file.mime_type,

        fileKind:
          file.file_kind,

        sizeBytes:
          file.size_bytes,

        ownerId:
          file.owner_id,

        folderId:
          file.folder_id,

        isStarred:
          file.is_starred,

        createdAt:
          file.created_at,

        updatedAt:
          file.updated_at,

        lastAccessedAt:
          accessedAt,

        permission:
          access.permission,

        accessType:
          access.accessType,

        canEdit:
          access.permission ===
            "owner" ||
          access.permission ===
            "editor",
      },

      signedUrl,

      expiresIn: 300,
    });
  } catch (error) {
    console.error(
      "Get file error:",
      error
    );

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to fetch file",
      },
    });
  }
};

// ======================================================
// UPDATE / RENAME FILE
// ======================================================

const updateFile = async (
  req,
  res
) => {
  try {
    const userId =
      req.user.id;

    const fileId =
      req.params.id;

    const {
      name,
      folderId,
    } = req.body;

    const {
      data: file,
      error: fileError,
    } = await supabase
      .from("files")
      .select(
        `
        id,
        name,
        file_kind,
        owner_id,
        folder_id,
        storage_path,
        is_deleted,
        is_starred
        `
      )
      .eq("id", fileId)
      .single();

    if (
      fileError ||
      !file
    ) {
      return res.status(404).json({
        error: {
          code:
            "FILE_NOT_FOUND",

          message:
            "File not found",
        },
      });
    }

    if (file.is_deleted) {
      return res.status(400).json({
        error: {
          code:
            "FILE_DELETED",

          message:
            "Deleted files cannot be modified",
        },
      });
    }

    const access =
      await getFileAccess({
        file,
        userId,
      });

    if (!access.hasAccess) {
      return res.status(403).json({
        error: {
          code:
            "FORBIDDEN",

          message:
            "You do not have permission to modify this file",
        },
      });
    }

    if (
      access.permission ===
      "viewer"
    ) {
      return res.status(403).json({
        error: {
          code:
            "VIEWER_READ_ONLY",

          message:
            "Viewer access is read-only",
        },
      });
    }

    const isOwner =
      access.permission ===
      "owner";

    if (
      !isOwner &&
      folderId !== undefined
    ) {
      return res.status(403).json({
        error: {
          code:
            "EDITOR_RENAME_ONLY",

          message:
            "Editors can rename shared files but cannot move them",
        },
      });
    }

    const updates = {};

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({
          error: {
            code:
              "VALIDATION_ERROR",

          message:
              "File name cannot be empty",
          },
        });
      }

      updates.name =
        name.trim();
    }

    if (folderId !== undefined) {
      if (folderId !== null) {
        const {
          data: folder,
          error:
            folderError,
        } = await supabase
          .from("folders")
          .select(
            "id, owner_id, is_deleted"
          )
          .eq(
            "id",
            folderId
          )
          .single();

        if (
          folderError ||
          !folder
        ) {
          return res
            .status(404)
            .json({
              error: {
                code:
                  "FOLDER_NOT_FOUND",

                message:
                  "Target folder not found",
              },
            });
        }

        if (
          folder.owner_id !==
            file.owner_id ||
          folder.is_deleted
        ) {
          return res
            .status(403)
            .json({
              error: {
                code:
                  "FORBIDDEN",

                message:
                  "You cannot move this file to that folder",
              },
            });
        }
      }

      updates.folder_id =
        folderId;
    }

    if (
      name === undefined &&
      folderId === undefined
    ) {
      return res.status(400).json({
        error: {
          code:
            "VALIDATION_ERROR",

          message:
            "Provide name or folderId to update",
        },
      });
    }

    updates.updated_at =
      new Date().toISOString();

    const {
      data:
        updatedFile,

      error,
    } = await supabase
      .from("files")
      .update(updates)
      .eq("id", fileId)
      .select(
        `
        id,
        name,
        mime_type,
        file_kind,
        size_bytes,
        owner_id,
        folder_id,
        is_deleted,
        is_starred,
        created_at,
        updated_at
        `
      )
      .single();

    if (error) {
      throw error;
    }

    return res.status(200).json({
      message:
        "File updated successfully",

      file: {
        id:
          updatedFile.id,

        name:
          updatedFile.name,

        mimeType:
          updatedFile.mime_type,

        fileKind:
          updatedFile.file_kind,

        sizeBytes:
          updatedFile.size_bytes,

        ownerId:
          updatedFile.owner_id,

        folderId:
          updatedFile.folder_id,

        isDeleted:
          updatedFile.is_deleted,

        isStarred:
          updatedFile.is_starred,

        createdAt:
          updatedFile.created_at,

        updatedAt:
          updatedFile.updated_at,
      },
    });
  } catch (error) {
    console.error(
      "Update file error:",
      error
    );

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to update file",
      },
    });
  }
};

// ======================================================
// DELETE FILE
// ======================================================

const deleteFile = async (
  req,
  res
) => {
  try {
    const ownerId =
      req.user.id;

    const fileId =
      req.params.id;

    const {
      data: file,
      error: fileError,
    } = await supabase
      .from("files")
      .select(
        `
        id,
        name,
        file_kind,
        owner_id,
        is_deleted,
        is_starred
        `
      )
      .eq("id", fileId)
      .single();

    if (
      fileError ||
      !file
    ) {
      return res.status(404).json({
        error: {
          code:
            "FILE_NOT_FOUND",

          message:
            "File not found",
        },
      });
    }

    if (
      file.owner_id !==
      ownerId
    ) {
      return res.status(403).json({
        error: {
          code:
            "FORBIDDEN",

          message:
            "Only the owner can delete this file",
        },
      });
    }

    if (file.is_deleted) {
      return res.status(400).json({
        error: {
          code:
            "ALREADY_DELETED",

          message:
            "File is already in Trash",
        },
      });
    }

    const {
      data:
        deletedFile,

      error,
    } = await supabase
      .from("files")
      .update({
        is_deleted: true,

        updated_at:
          new Date().toISOString(),
      })
      .eq("id", fileId)
      .select(
        `
        id,
        name,
        file_kind,
        is_deleted,
        is_starred,
        updated_at
        `
      )
      .single();

    if (error) {
      throw error;
    }

    return res.status(200).json({
      message:
        "File moved to Trash",

      file: {
        id:
          deletedFile.id,

        name:
          deletedFile.name,

        fileKind:
          deletedFile.file_kind,

        isDeleted:
          deletedFile.is_deleted,

        isStarred:
          deletedFile.is_starred,

        updatedAt:
          deletedFile.updated_at,
      },
    });
  } catch (error) {
    console.error(
      "Delete file error:",
      error
    );

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to delete file",
      },
    });
  }
};

// ======================================================
// GET TRASH
// ======================================================

const getTrash = async (
  req,
  res
) => {
  try {
    const ownerId =
      req.user.id;

    const {
      data: files,
      error:
        filesError,
    } = await supabase
      .from("files")
      .select(
        `
        id,
        name,
        mime_type,
        file_kind,
        size_bytes,
        folder_id,
        is_deleted,
        is_starred,
        created_at,
        updated_at
        `
      )
      .eq(
        "owner_id",
        ownerId
      )
      .eq(
        "is_deleted",
        true
      )
      .order(
        "updated_at",
        {
          ascending: false,
        }
      );

    if (filesError) {
      throw filesError;
    }

    const {
      data: folders,
      error:
        foldersError,
    } = await supabase
      .from("folders")
      .select(
        `
        id,
        name,
        parent_id,
        owner_id,
        is_deleted,
        is_starred,
        is_project,
        created_at,
        updated_at
        `
      )
      .eq(
        "owner_id",
        ownerId
      )
      .eq(
        "is_deleted",
        true
      )
      .order(
        "updated_at",
        {
          ascending: false,
        }
      );

    if (foldersError) {
      throw foldersError;
    }

    return res.status(200).json({
      files:
        (files || []).map(
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
              file.size_bytes,

            folderId:
              file.folder_id,

            isDeleted:
              file.is_deleted,

            isStarred:
              file.is_starred,

            createdAt:
              file.created_at,

            updatedAt:
              file.updated_at,
          })
        ),

      folders:
        (folders || []).map(
          (folder) => ({
            id:
              folder.id,

            name:
              folder.name,

            parentId:
              folder.parent_id,

            ownerId:
              folder.owner_id,

            isDeleted:
              folder.is_deleted,

            isStarred:
              folder.is_starred,

            isProject:
              folder.is_project,

            createdAt:
              folder.created_at,

            updatedAt:
              folder.updated_at,
          })
        ),
    });
  } catch (error) {
    console.error(
      "Get trash error:",
      error
    );

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to fetch Trash",
      },
    });
  }
};

// ======================================================
// RESTORE FILE
// ======================================================

const restoreFile = async (
  req,
  res
) => {
  try {
    const ownerId =
      req.user.id;

    const fileId =
      req.params.id;

    const {
      data: file,
      error: fileError,
    } = await supabase
      .from("files")
      .select(
        `
        id,
        name,
        file_kind,
        owner_id,
        folder_id,
        is_deleted,
        is_starred
        `
      )
      .eq("id", fileId)
      .single();

    if (
      fileError ||
      !file
    ) {
      return res.status(404).json({
        error: {
          code:
            "FILE_NOT_FOUND",

          message:
            "File not found",
        },
      });
    }

    if (
      file.owner_id !==
      ownerId
    ) {
      return res.status(403).json({
        error: {
          code:
            "FORBIDDEN",

          message:
            "Only the owner can restore this file",
        },
      });
    }

    if (!file.is_deleted) {
      return res.status(400).json({
        error: {
          code:
            "NOT_IN_TRASH",

          message:
            "File is not in Trash",
        },
      });
    }

    let restoreFolderId =
      file.folder_id;

    if (restoreFolderId) {
      const {
        data: folder,
      } = await supabase
        .from("folders")
        .select(
          "id, is_deleted"
        )
        .eq(
          "id",
          restoreFolderId
        )
        .maybeSingle();

      if (
        !folder ||
        folder.is_deleted
      ) {
        restoreFolderId =
          null;
      }
    }

    const {
      data:
        restoredFile,

      error,
    } = await supabase
      .from("files")
      .update({
        is_deleted:
          false,

        folder_id:
          restoreFolderId,

        updated_at:
          new Date().toISOString(),
      })
      .eq("id", fileId)
      .select(
        `
        id,
        name,
        file_kind,
        folder_id,
        is_deleted,
        is_starred,
        updated_at
        `
      )
      .single();

    if (error) {
      throw error;
    }

    return res.status(200).json({
      message:
        "File restored successfully",

      file: {
        id:
          restoredFile.id,

        name:
          restoredFile.name,

        fileKind:
          restoredFile.file_kind,

        folderId:
          restoredFile.folder_id,

        isDeleted:
          restoredFile.is_deleted,

        isStarred:
          restoredFile.is_starred,

        updatedAt:
          restoredFile.updated_at,
      },
    });
  } catch (error) {
    console.error(
      "Restore file error:",
      error
    );

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to restore file",
      },
    });
  }
};

// ======================================================
// PERMANENT DELETE FILE
// ======================================================

const permanentlyDeleteFile =
  async (req, res) => {
    try {
      const ownerId =
        req.user.id;

      const fileId =
        req.params.id;

      const {
        data: file,
        error: fileError,
      } = await supabase
        .from("files")
        .select(
          `
          id,
          name,
          file_kind,
          owner_id,
          storage_path,
          is_deleted
          `
        )
        .eq("id", fileId)
        .single();

      if (
        fileError ||
        !file
      ) {
        return res.status(404).json({
          error: {
            code:
              "FILE_NOT_FOUND",

            message:
              "File not found",
          },
        });
      }

      if (
        file.owner_id !==
        ownerId
      ) {
        return res.status(403).json({
          error: {
            code:
              "FORBIDDEN",

          message:
              "Only the owner can permanently delete this file",
          },
        });
      }

      if (!file.is_deleted) {
        return res.status(400).json({
          error: {
            code:
              "NOT_IN_TRASH",

          message:
              "Move the file to Trash before permanently deleting it",
          },
        });
      }

      await deleteFileFromStorage(
        file.storage_path
      );

      const {
        error: deleteError,
      } = await supabase
        .from("files")
        .delete()
        .eq("id", fileId);

      if (deleteError) {
        throw deleteError;
      }

      return res.status(200).json({
        message:
          "File permanently deleted",
      });
    } catch (error) {
      console.error(
        "Permanent delete error:",
        error
      );

      return res.status(500).json({
        error: {
          code:
            "INTERNAL_SERVER_ERROR",

          message:
            "Unable to permanently delete file",
        },
      });
    }
  };

// ======================================================
// EXPORTS
// ======================================================

module.exports = {
  uploadFile,
  uploadFolder,

  // CLOUD DOCUMENTS
  createDocument,
  getDocument,
  updateDocumentContent,

  // CLOUD SPREADSHEETS
  createSpreadsheet,
  getSpreadsheet,
  updateSpreadsheetContent,

  // NORMAL FILE OPERATIONS
  getFile,
  updateFile,
  deleteFile,
  getTrash,
  restoreFile,
  permanentlyDeleteFile,
};