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

  getFile,
  updateFile,
  deleteFile,
  getTrash,
  restoreFile,
  permanentlyDeleteFile,
};