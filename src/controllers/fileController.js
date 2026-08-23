const supabase = require("../config/supabase");

const {
  buildStoragePath,
  uploadFileToStorage,
  createSignedDownloadUrl,
  deleteFileFromStorage,
} = require("../services/storageService");

// ======================================================
// HELPER: CHECK INHERITED SHARED-FOLDER ACCESS
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

    // Check whether this folder is shared
    // directly with the current user
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

    // Move upward through the folder tree
    const {
      data: folder,
      error: folderError,
    } = await supabase
      .from("folders")
      .select(
        "id, parent_id, is_deleted"
      )
      .eq("id", currentFolderId)
      .maybeSingle();

    if (folderError) {
      throw folderError;
    }

    if (
      !folder ||
      folder.is_deleted
    ) {
      return null;
    }

    currentFolderId =
      folder.parent_id;
  }

  return null;
};

// ======================================================
// UPLOAD FILE
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

    // Check folder
    if (folderId) {
      const {
        data: folder,
        error: folderError,
      } = await supabase
        .from("folders")
        .select(
          "id, owner_id, is_deleted"
        )
        .eq("id", folderId)
        .single();

      if (
        folderError ||
        !folder
      ) {
        return res.status(404).json({
          error: {
            code: "FOLDER_NOT_FOUND",
            message:
              "Target folder not found",
          },
        });
      }

      if (
        folder.owner_id !== ownerId ||
        folder.is_deleted
      ) {
        return res.status(403).json({
          error: {
            code: "FORBIDDEN",
            message:
              "You cannot upload files to this folder",
          },
        });
      }
    }

    // Storage path
    const storagePath =
      buildStoragePath({
        ownerId,
        folderId,
        originalName:
          req.file.originalname,
      });

    uploadedStoragePath =
      storagePath;

    // Upload object
    await uploadFileToStorage({
      buffer: req.file.buffer,
      storagePath,
      mimeType: req.file.mimetype,
    });

    // Save metadata
    const {
      data: file,
      error: insertError,
    } = await supabase
      .from("files")
      .insert({
        name:
          req.file.originalname,
        mime_type:
          req.file.mimetype,
        size_bytes:
          req.file.size,
        storage_path:
          storagePath,
        owner_id: ownerId,
        folder_id: folderId,
      })
      .select(
        "id, name, mime_type, size_bytes, storage_path, owner_id, folder_id, is_deleted, is_starred, created_at, updated_at"
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
        mimeType: file.mime_type,
        sizeBytes: file.size_bytes,
        ownerId: file.owner_id,
        folderId: file.folder_id,
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
// GET FILE + SIGNED URL + RECENT
//
// ACCESS:
// 1. Owner
// 2. Direct file share
// 3. File inside shared folder
// 4. File inside nested child of shared folder
// ======================================================

const getFile = async (req, res) => {
  try {
    const userId = req.user.id;
    const fileId = req.params.id;

    const {
      data: file,
      error,
    } = await supabase
      .from("files")
      .select(
        "id, name, mime_type, size_bytes, storage_path, owner_id, folder_id, is_deleted, is_starred, created_at, updated_at, last_accessed_at"
      )
      .eq("id", fileId)
      .single();

    if (error || !file) {
      return res.status(404).json({
        error: {
          code: "FILE_NOT_FOUND",
          message: "File not found",
        },
      });
    }

    if (file.is_deleted) {
      return res.status(404).json({
        error: {
          code: "FILE_NOT_FOUND",
          message: "File not found",
        },
      });
    }

    // ==================================================
    // ACCESS CONTROL
    // ==================================================

    let permission = "owner";
    let accessType = "owner";

    if (
      file.owner_id !== userId
    ) {
      // -----------------------------------------------
      // FIRST:
      // Check whether the FILE itself is shared
      // -----------------------------------------------

      const {
        data: directShare,
        error: directShareError,
      } = await supabase
        .from("shares")
        .select(
          "id, permission"
        )
        .eq("file_id", fileId)
        .eq(
          "shared_with_id",
          userId
        )
        .maybeSingle();

      if (directShareError) {
        throw directShareError;
      }

      if (directShare) {
        permission =
          directShare.permission;

        accessType =
          "direct-file-share";
      } else {
        // ---------------------------------------------
        // SECOND:
        // Check containing folder + ancestors
        // ---------------------------------------------

        if (!file.folder_id) {
          return res.status(403).json({
            error: {
              code: "FORBIDDEN",
              message:
                "You do not have access to this file",
            },
          });
        }

        const inheritedPermission =
          await getInheritedFolderPermission({
            folderId:
              file.folder_id,

            userId,
          });

        if (
          !inheritedPermission
        ) {
          return res.status(403).json({
            error: {
              code: "FORBIDDEN",
              message:
                "You do not have access to this file",
            },
          });
        }

        permission =
          inheritedPermission;

        accessType =
          "shared-folder";
      }
    }

    // ==================================================
    // MARK RECENT
    // ==================================================

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

    if (
      accessUpdateError
    ) {
      console.error(
        "Unable to update last_accessed_at:",
        accessUpdateError
      );
    }

    // ==================================================
    // SIGNED DOWNLOAD URL
    // ==================================================

    const signedUrl =
      await createSignedDownloadUrl(
        file.storage_path,
        300
      );

    // ==================================================
    // RESPONSE
    // ==================================================

    return res.status(200).json({
      file: {
        id: file.id,

        name:
          file.name,

        mimeType:
          file.mime_type,

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

        permission,

        accessType,
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
// UPDATE / RENAME / MOVE FILE
// OWNER ONLY
// ======================================================

const updateFile = async (
  req,
  res
) => {
  try {
    const ownerId =
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
        "id, name, owner_id, folder_id, storage_path, is_deleted, is_starred"
      )
      .eq("id", fileId)
      .single();

    if (
      fileError ||
      !file
    ) {
      return res.status(404).json({
        error: {
          code: "FILE_NOT_FOUND",
          message: "File not found",
        },
      });
    }

    if (
      file.owner_id !== ownerId
    ) {
      return res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message:
            "You do not have permission to modify this file",
        },
      });
    }

    if (file.is_deleted) {
      return res.status(400).json({
        error: {
          code: "FILE_DELETED",
          message:
            "Deleted files cannot be modified",
        },
      });
    }

    const updates = {};

    // Rename
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

    // Move
    if (
      folderId !== undefined
    ) {
      if (
        folderId !== null
      ) {
        const {
          data: folder,
          error: folderError,
        } = await supabase
          .from("folders")
          .select(
            "id, owner_id, is_deleted"
          )
          .eq("id", folderId)
          .single();

        if (
          folderError ||
          !folder
        ) {
          return res.status(404).json({
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
            ownerId ||
          folder.is_deleted
        ) {
          return res.status(403).json({
            error: {
              code: "FORBIDDEN",
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
      data: updatedFile,
      error,
    } = await supabase
      .from("files")
      .update(updates)
      .eq("id", fileId)
      .select(
        "id, name, mime_type, size_bytes, owner_id, folder_id, is_deleted, is_starred, created_at, updated_at"
      )
      .single();

    if (error) {
      throw error;
    }

    return res.status(200).json({
      message:
        "File updated successfully",

      file: {
        id: updatedFile.id,

        name:
          updatedFile.name,

        mimeType:
          updatedFile.mime_type,

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
// SOFT DELETE FILE
// OWNER ONLY
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
        "id, name, owner_id, is_deleted, is_starred"
      )
      .eq("id", fileId)
      .single();

    if (
      fileError ||
      !file
    ) {
      return res.status(404).json({
        error: {
          code: "FILE_NOT_FOUND",
          message: "File not found",
        },
      });
    }

    if (
      file.owner_id !== ownerId
    ) {
      return res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message:
            "You do not have permission to delete this file",
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
      data: deletedFile,
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
        "id, name, is_deleted, is_starred, updated_at"
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

    // Deleted files
    const {
      data: files,
      error: filesError,
    } = await supabase
      .from("files")
      .select(
        "id, name, mime_type, size_bytes, folder_id, is_deleted, is_starred, created_at, updated_at"
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

    // Deleted folders
    const {
      data: folders,
      error: foldersError,
    } = await supabase
      .from("folders")
      .select(
        "id, name, parent_id, owner_id, is_deleted, is_starred, created_at, updated_at"
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
      files: (
        files || []
      ).map((file) => ({
        id: file.id,

        name: file.name,

        mimeType:
          file.mime_type,

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
      })),

      folders: (
        folders || []
      ).map((folder) => ({
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

        createdAt:
          folder.created_at,

        updatedAt:
          folder.updated_at,
      })),
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
// OWNER ONLY
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
        "id, name, owner_id, folder_id, is_deleted, is_starred"
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
      file.owner_id !== ownerId
    ) {
      return res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message:
            "You do not have permission to restore this file",
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
      data: restoredFile,
      error,
    } = await supabase
      .from("files")
      .update({
        is_deleted: false,

        folder_id:
          restoreFolderId,

        updated_at:
          new Date().toISOString(),
      })
      .eq("id", fileId)
      .select(
        "id, name, folder_id, is_deleted, is_starred, updated_at"
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
// OWNER ONLY
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
          "id, name, owner_id, storage_path, is_deleted"
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
              "You do not have permission to permanently delete this file",
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
  getFile,
  updateFile,
  deleteFile,
  getTrash,
  restoreFile,
  permanentlyDeleteFile,
};