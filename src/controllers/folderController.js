const supabase = require("../config/supabase");

const {
  deleteFileFromStorage,
} = require("../services/storageService");

// ======================================================
// HELPER - CHECK FOLDER ACCESS
// ======================================================

const getFolderAccess = async (
  folderId,
  userId
) => {
  const {
    data: folder,
    error: folderError,
  } = await supabase
    .from("folders")
    .select(
      "id, name, owner_id, parent_id, is_deleted, is_starred, created_at, updated_at"
    )
    .eq("id", folderId)
    .maybeSingle();

  if (folderError) {
    throw folderError;
  }

  if (
    !folder ||
    folder.is_deleted
  ) {
    return {
      folder: null,
      hasAccess: false,
      permission: null,
      sharedRootId: null,
    };
  }

  // Owner always has access
  if (
    folder.owner_id === userId
  ) {
    return {
      folder,
      hasAccess: true,
      permission: "owner",
      sharedRootId: null,
    };
  }

  // Check this folder and its ancestors.
  // If a parent folder is shared, children inherit access.
  let currentFolder =
    folder;

  const visited =
    new Set();

  while (
    currentFolder &&
    !visited.has(
      currentFolder.id
    )
  ) {
    visited.add(
      currentFolder.id
    );

    const {
      data: share,
      error: shareError,
    } = await supabase
      .from("shares")
      .select(
        "id, folder_id, permission"
      )
      .eq(
        "shared_with_id",
        userId
      )
      .eq(
        "folder_id",
        currentFolder.id
      )
      .maybeSingle();

    if (shareError) {
      throw shareError;
    }

    if (share) {
      return {
        folder,
        hasAccess: true,
        permission:
          share.permission,
        sharedRootId:
          currentFolder.id,
      };
    }

    if (
      !currentFolder.parent_id
    ) {
      break;
    }

    const {
      data: parentFolder,
      error: parentError,
    } = await supabase
      .from("folders")
      .select(
        "id, owner_id, parent_id, is_deleted"
      )
      .eq(
        "id",
        currentFolder.parent_id
      )
      .maybeSingle();

    if (parentError) {
      throw parentError;
    }

    if (
      !parentFolder ||
      parentFolder.is_deleted
    ) {
      break;
    }

    currentFolder =
      parentFolder;
  }

  return {
    folder,
    hasAccess: false,
    permission: null,
    sharedRootId: null,
  };
};

// ======================================================
// CREATE FOLDER
// ======================================================

const createFolder = async (
  req,
  res
) => {
  try {
    const {
      name,
      parentId = null,
    } = req.body;

    const ownerId =
      req.user.id;

    if (
      !name ||
      !name.trim()
    ) {
      return res
        .status(400)
        .json({
          error: {
            code:
              "VALIDATION_ERROR",
            message:
              "Folder name is required",
          },
        });
    }

    // Check parent folder
    if (parentId) {
      const {
        data: parentFolder,
        error: parentError,
      } = await supabase
        .from("folders")
        .select(
          "id, owner_id, is_deleted"
        )
        .eq(
          "id",
          parentId
        )
        .single();

      if (
        parentError ||
        !parentFolder
      ) {
        return res
          .status(404)
          .json({
            error: {
              code:
                "PARENT_FOLDER_NOT_FOUND",
              message:
                "Parent folder not found",
            },
          });
      }

      // Owner only
      if (
        parentFolder.owner_id !==
          ownerId ||
        parentFolder.is_deleted
      ) {
        return res
          .status(403)
          .json({
            error: {
              code:
                "FORBIDDEN",
              message:
                "You cannot create a folder here",
            },
          });
      }
    }

    // Check duplicate
    let existingFolderQuery =
      supabase
        .from("folders")
        .select("id")
        .eq(
          "owner_id",
          ownerId
        )
        .eq(
          "name",
          name.trim()
        )
        .eq(
          "is_deleted",
          false
        );

    if (
      parentId === null
    ) {
      existingFolderQuery =
        existingFolderQuery.is(
          "parent_id",
          null
        );
    } else {
      existingFolderQuery =
        existingFolderQuery.eq(
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
      await existingFolderQuery.maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existingFolder) {
      return res
        .status(409)
        .json({
          error: {
            code:
              "FOLDER_EXISTS",
            message:
              "A folder with this name already exists here",
          },
        });
    }

    const {
      data: folder,
      error,
    } = await supabase
      .from("folders")
      .insert({
        name: name.trim(),
        owner_id: ownerId,
        parent_id: parentId,
      })
      .select(
        "id, name, owner_id, parent_id, is_deleted, is_starred, created_at, updated_at"
      )
      .single();

    if (error) {
      throw error;
    }

    return res
      .status(201)
      .json({
        message:
          "Folder created successfully",

        folder: {
          id: folder.id,
          name: folder.name,
          ownerId:
            folder.owner_id,
          parentId:
            folder.parent_id,
          isDeleted:
            folder.is_deleted,
          isStarred:
            folder.is_starred,
          createdAt:
            folder.created_at,
          updatedAt:
            folder.updated_at,
        },
      });
  } catch (error) {
    console.error(
      "Create folder error:",
      error
    );

    return res
      .status(500)
      .json({
        error: {
          code:
            "INTERNAL_SERVER_ERROR",
          message:
            "Unable to create folder",
        },
      });
  }
};

// ======================================================
// GET ROOT CONTENTS
// ======================================================

const getRootFolders =
  async (req, res) => {
    try {
      const ownerId =
        req.user.id;

      const {
        data: folders,
        error:
          foldersError,
      } = await supabase
        .from("folders")
        .select(
          "id, name, owner_id, parent_id, is_starred, created_at, updated_at"
        )
        .eq(
          "owner_id",
          ownerId
        )
        .eq(
          "is_deleted",
          false
        )
        .is(
          "parent_id",
          null
        )
        .order("name", {
          ascending: true,
        });

      if (
        foldersError
      ) {
        throw foldersError;
      }

      const {
        data: files,
        error: filesError,
      } = await supabase
        .from("files")
        .select(
          "id, name, mime_type, size_bytes, owner_id, folder_id, is_starred, created_at, updated_at"
        )
        .eq(
          "owner_id",
          ownerId
        )
        .eq(
          "is_deleted",
          false
        )
        .is(
          "folder_id",
          null
        )
        .order("name", {
          ascending: true,
        });

      if (
        filesError
      ) {
        throw filesError;
      }

      return res
        .status(200)
        .json({
          folders: (
            folders || []
          ).map(
            (folder) => ({
              id:
                folder.id,
              name:
                folder.name,
              ownerId:
                folder.owner_id,
              parentId:
                folder.parent_id,
              isStarred:
                folder.is_starred,
              createdAt:
                folder.created_at,
              updatedAt:
                folder.updated_at,
            })
          ),

          files: (
            files || []
          ).map(
            (file) => ({
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
            })
          ),
        });
    } catch (error) {
      console.error(
        "Get root contents error:",
        error
      );

      return res
        .status(500)
        .json({
          error: {
            code:
              "INTERNAL_SERVER_ERROR",
            message:
              "Unable to fetch root contents",
          },
        });
    }
  };

// ======================================================
// GET FOLDER CONTENTS
// OWNER OR SHARED RECIPIENT
// ======================================================

const getFolderContents =
  async (req, res) => {
    try {
      const userId =
        req.user.id;

      const folderId =
        req.params.id;

      const {
        folder,
        hasAccess,
        permission,
        sharedRootId,
      } =
        await getFolderAccess(
          folderId,
          userId
        );

      if (!folder) {
        return res
          .status(404)
          .json({
            error: {
              code:
                "FOLDER_NOT_FOUND",
              message:
                "Folder not found",
            },
          });
      }

      if (!hasAccess) {
        return res
          .status(403)
          .json({
            error: {
              code:
                "FORBIDDEN",
              message:
                "You do not have access to this folder",
            },
          });
      }

      // Important:
      // use folder owner ID, not recipient ID.
      const folderOwnerId =
        folder.owner_id;

      const {
        data:
          childFolders,
        error:
          childError,
      } = await supabase
        .from("folders")
        .select(
          "id, name, owner_id, parent_id, is_starred, created_at, updated_at"
        )
        .eq(
          "owner_id",
          folderOwnerId
        )
        .eq(
          "parent_id",
          folderId
        )
        .eq(
          "is_deleted",
          false
        )
        .order("name", {
          ascending: true,
        });

      if (childError) {
        throw childError;
      }

      const {
        data: files,
        error:
          filesError,
      } = await supabase
        .from("files")
        .select(
          "id, name, mime_type, size_bytes, owner_id, folder_id, is_starred, created_at, updated_at"
        )
        .eq(
          "owner_id",
          folderOwnerId
        )
        .eq(
          "folder_id",
          folderId
        )
        .eq(
          "is_deleted",
          false
        )
        .order("name", {
          ascending: true,
        });

      if (filesError) {
        throw filesError;
      }

      const isOwner =
        folder.owner_id ===
        userId;

      return res
        .status(200)
        .json({
          folder: {
            id:
              folder.id,
            name:
              folder.name,
            ownerId:
              folder.owner_id,
            parentId:
              folder.parent_id,
            isStarred:
              folder.is_starred,
            createdAt:
              folder.created_at,
            updatedAt:
              folder.updated_at,
          },

          access: {
            isOwner,
            permission,
            sharedRootId,
          },

          folders: (
            childFolders ||
            []
          ).map(
            (
              childFolder
            ) => ({
              id:
                childFolder.id,
              name:
                childFolder.name,
              ownerId:
                childFolder.owner_id,
              parentId:
                childFolder.parent_id,
              isStarred:
                childFolder.is_starred,
              createdAt:
                childFolder.created_at,
              updatedAt:
                childFolder.updated_at,
            })
          ),

          files: (
            files || []
          ).map(
            (file) => ({
              id:
                file.id,
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
            })
          ),
        });
    } catch (error) {
      console.error(
        "Get folder contents error:",
        error
      );

      return res
        .status(500)
        .json({
          error: {
            code:
              "INTERNAL_SERVER_ERROR",
            message:
              "Unable to fetch folder contents",
          },
        });
    }
  };

// ======================================================
// UPDATE FOLDER
// OWNER ONLY
// ======================================================

const updateFolder = async (
  req,
  res
) => {
  try {
    const ownerId =
      req.user.id;

    const folderId =
      req.params.id;

    const {
      name,
      parentId,
    } = req.body;

    const {
      data: folder,
      error:
        folderError,
    } = await supabase
      .from("folders")
      .select(
        "id, name, owner_id, parent_id, is_deleted, is_starred"
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
              "Folder not found",
          },
        });
    }

    if (
      folder.owner_id !==
      ownerId
    ) {
      return res
        .status(403)
        .json({
          error: {
            code:
              "FORBIDDEN",
            message:
              "You do not have permission to modify this folder",
          },
        });
    }

    if (
      folder.is_deleted
    ) {
      return res
        .status(400)
        .json({
          error: {
            code:
              "FOLDER_DELETED",
            message:
              "Deleted folders cannot be modified",
          },
        });
    }

    const updates = {};

    if (
      name !== undefined
    ) {
      if (!name.trim()) {
        return res
          .status(400)
          .json({
            error: {
              code:
                "VALIDATION_ERROR",
              message:
                "Folder name cannot be empty",
            },
          });
      }

      updates.name =
        name.trim();
    }

    if (
      parentId !==
      undefined
    ) {
      if (
        parentId ===
        folderId
      ) {
        return res
          .status(400)
          .json({
            error: {
              code:
                "INVALID_PARENT",
              message:
                "A folder cannot be moved inside itself",
            },
          });
      }

      if (
        parentId !== null
      ) {
        const {
          data:
            parentFolder,
          error:
            parentError,
        } = await supabase
          .from("folders")
          .select(
            "id, owner_id, is_deleted"
          )
          .eq(
            "id",
            parentId
          )
          .single();

        if (
          parentError ||
          !parentFolder
        ) {
          return res
            .status(404)
            .json({
              error: {
                code:
                  "PARENT_FOLDER_NOT_FOUND",
                message:
                  "Parent folder not found",
              },
            });
        }

        if (
          parentFolder.owner_id !==
            ownerId ||
          parentFolder.is_deleted
        ) {
          return res
            .status(403)
            .json({
              error: {
                code:
                  "FORBIDDEN",
                message:
                  "You cannot move this folder there",
              },
            });
        }
      }

      updates.parent_id =
        parentId;
    }

    if (
      name === undefined &&
      parentId ===
        undefined
    ) {
      return res
        .status(400)
        .json({
          error: {
            code:
              "VALIDATION_ERROR",
            message:
              "Provide name or parentId to update",
          },
        });
    }

    updates.updated_at =
      new Date().toISOString();

    const {
      data:
        updatedFolder,
      error,
    } = await supabase
      .from("folders")
      .update(updates)
      .eq(
        "id",
        folderId
      )
      .select(
        "id, name, owner_id, parent_id, is_deleted, is_starred, created_at, updated_at"
      )
      .single();

    if (error) {
      throw error;
    }

    return res
      .status(200)
      .json({
        message:
          "Folder updated successfully",

        folder: {
          id:
            updatedFolder.id,
          name:
            updatedFolder.name,
          ownerId:
            updatedFolder.owner_id,
          parentId:
            updatedFolder.parent_id,
          isDeleted:
            updatedFolder.is_deleted,
          isStarred:
            updatedFolder.is_starred,
          createdAt:
            updatedFolder.created_at,
          updatedAt:
            updatedFolder.updated_at,
        },
      });
  } catch (error) {
    console.error(
      "Update folder error:",
      error
    );

    return res
      .status(500)
      .json({
        error: {
          code:
            "INTERNAL_SERVER_ERROR",
          message:
            "Unable to update folder",
        },
      });
  }
};

// ======================================================
// SOFT DELETE FOLDER
// OWNER ONLY
// ======================================================

const deleteFolder = async (
  req,
  res
) => {
  try {
    const ownerId =
      req.user.id;

    const folderId =
      req.params.id;

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
              "Folder not found",
          },
        });
    }

    if (
      folder.owner_id !==
      ownerId
    ) {
      return res
        .status(403)
        .json({
          error: {
            code:
              "FORBIDDEN",
            message:
              "You do not have permission to delete this folder",
          },
        });
    }

    if (
      folder.is_deleted
    ) {
      return res
        .status(400)
        .json({
          error: {
            code:
              "ALREADY_DELETED",
            message:
              "Folder is already in Trash",
          },
        });
    }

    const {
      data:
        deletedFolder,
      error,
    } = await supabase
      .from("folders")
      .update({
        is_deleted: true,
        updated_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        folderId
      )
      .select(
        "id, name, is_deleted, is_starred, updated_at"
      )
      .single();

    if (error) {
      throw error;
    }

    return res
      .status(200)
      .json({
        message:
          "Folder moved to Trash",

        folder: {
          id:
            deletedFolder.id,
          name:
            deletedFolder.name,
          isDeleted:
            deletedFolder.is_deleted,
          isStarred:
            deletedFolder.is_starred,
          updatedAt:
            deletedFolder.updated_at,
        },
      });
  } catch (error) {
    console.error(
      "Delete folder error:",
      error
    );

    return res
      .status(500)
      .json({
        error: {
          code:
            "INTERNAL_SERVER_ERROR",
          message:
            "Unable to delete folder",
        },
      });
  }
};

// ======================================================
// RESTORE FOLDER
// OWNER ONLY
// ======================================================

const restoreFolder =
  async (req, res) => {
    try {
      const ownerId =
        req.user.id;

      const folderId =
        req.params.id;

      const {
        data: folder,
        error:
          folderError,
      } = await supabase
        .from("folders")
        .select(
          "id, name, owner_id, parent_id, is_deleted, is_starred"
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
                "Folder not found",
            },
          });
      }

      if (
        folder.owner_id !==
        ownerId
      ) {
        return res
          .status(403)
          .json({
            error: {
              code:
                "FORBIDDEN",
              message:
                "You do not have permission to restore this folder",
            },
          });
      }

      if (
        !folder.is_deleted
      ) {
        return res
          .status(400)
          .json({
            error: {
              code:
                "NOT_IN_TRASH",
              message:
                "Folder is not in Trash",
            },
          });
      }

      let restoreParentId =
        folder.parent_id;

      if (
        restoreParentId
      ) {
        const {
          data:
            parentFolder,
        } = await supabase
          .from("folders")
          .select(
            "id, is_deleted"
          )
          .eq(
            "id",
            restoreParentId
          )
          .maybeSingle();

        if (
          !parentFolder ||
          parentFolder.is_deleted
        ) {
          restoreParentId =
            null;
        }
      }

      const {
        data:
          restoredFolder,
        error,
      } = await supabase
        .from("folders")
        .update({
          is_deleted:
            false,

          parent_id:
            restoreParentId,

          updated_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          folderId
        )
        .select(
          "id, name, parent_id, is_deleted, is_starred, created_at, updated_at"
        )
        .single();

      if (error) {
        throw error;
      }

      return res
        .status(200)
        .json({
          message:
            "Folder restored successfully",

          folder: {
            id:
              restoredFolder.id,
            name:
              restoredFolder.name,
            parentId:
              restoredFolder.parent_id,
            isDeleted:
              restoredFolder.is_deleted,
            isStarred:
              restoredFolder.is_starred,
            createdAt:
              restoredFolder.created_at,
            updatedAt:
              restoredFolder.updated_at,
          },
        });
    } catch (error) {
      console.error(
        "Restore folder error:",
        error
      );

      return res
        .status(500)
        .json({
          error: {
            code:
              "INTERNAL_SERVER_ERROR",
            message:
              "Unable to restore folder",
          },
        });
    }
  };

// ======================================================
// PERMANENT DELETE FOLDER
// OWNER ONLY
// ======================================================

const permanentlyDeleteFolder =
  async (req, res) => {
    try {
      const ownerId =
        req.user.id;

      const folderId =
        req.params.id;

      const {
        data: folder,
        error:
          folderError,
      } = await supabase
        .from("folders")
        .select(
          "id, name, owner_id, parent_id, is_deleted"
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
                "Folder not found",
            },
          });
      }

      if (
        folder.owner_id !==
        ownerId
      ) {
        return res
          .status(403)
          .json({
            error: {
              code:
                "FORBIDDEN",
              message:
                "You do not have permission to permanently delete this folder",
            },
          });
      }

      if (
        !folder.is_deleted
      ) {
        return res
          .status(400)
          .json({
            error: {
              code:
                "NOT_IN_TRASH",
              message:
                "Move the folder to Trash before permanently deleting it",
            },
          });
      }

      const {
        data:
          allFolders,
        error:
          allFoldersError,
      } = await supabase
        .from("folders")
        .select(
          "id, name, parent_id, owner_id, is_deleted"
        )
        .eq(
          "owner_id",
          ownerId
        );

      if (
        allFoldersError
      ) {
        throw allFoldersError;
      }

      const descendantFolderIds =
        [];

      const findChildren = (
        parentId
      ) => {
        const children = (
          allFolders || []
        ).filter(
          (item) =>
            item.parent_id ===
            parentId
        );

        for (
          const child of children
        ) {
          descendantFolderIds.push(
            child.id
          );

          findChildren(
            child.id
          );
        }
      };

      findChildren(
        folderId
      );

      const folderTreeIds =
        [
          folderId,
          ...descendantFolderIds,
        ];

      const {
        data:
          folderFiles,
        error:
          filesError,
      } = await supabase
        .from("files")
        .select(
          "id, name, storage_path, folder_id, owner_id"
        )
        .eq(
          "owner_id",
          ownerId
        )
        .in(
          "folder_id",
          folderTreeIds
        );

      if (
        filesError
      ) {
        throw filesError;
      }

      const files =
        folderFiles || [];

      for (
        const file of files
      ) {
        if (
          !file.storage_path
        ) {
          continue;
        }

        await deleteFileFromStorage(
          file.storage_path
        );
      }

      if (
        files.length > 0
      ) {
        const fileIds =
          files.map(
            (file) =>
              file.id
          );

        const {
          error:
            deleteFilesError,
        } = await supabase
          .from("files")
          .delete()
          .in(
            "id",
            fileIds
          )
          .eq(
            "owner_id",
            ownerId
          );

        if (
          deleteFilesError
        ) {
          throw deleteFilesError;
        }
      }

      const getFolderDepth = (
        id
      ) => {
        let depth = 0;

        let current = (
          allFolders || []
        ).find(
          (item) =>
            item.id === id
        );

        const visited =
          new Set();

        while (
          current &&
          current.parent_id &&
          !visited.has(
            current.id
          )
        ) {
          visited.add(
            current.id
          );

          depth += 1;

          current = (
            allFolders || []
          ).find(
            (item) =>
              item.id ===
              current.parent_id
          );
        }

        return depth;
      };

      const childIdsDeepestFirst =
        [
          ...descendantFolderIds,
        ].sort(
          (a, b) =>
            getFolderDepth(
              b
            ) -
            getFolderDepth(
              a
            )
        );

      for (
        const childFolderId
        of childIdsDeepestFirst
      ) {
        const {
          error:
            childDeleteError,
        } = await supabase
          .from("folders")
          .delete()
          .eq(
            "id",
            childFolderId
          )
          .eq(
            "owner_id",
            ownerId
          );

        if (
          childDeleteError
        ) {
          throw childDeleteError;
        }
      }

      const {
        error:
          folderDeleteError,
      } = await supabase
        .from("folders")
        .delete()
        .eq(
          "id",
          folderId
        )
        .eq(
          "owner_id",
          ownerId
        );

      if (
        folderDeleteError
      ) {
        throw folderDeleteError;
      }

      return res
        .status(200)
        .json({
          message:
            "Folder and all contents permanently deleted",

          deleted: {
            folderId,

            folderName:
              folder.name,

            foldersDeleted:
              descendantFolderIds.length +
              1,

            filesDeleted:
              files.length,
          },
        });
    } catch (error) {
      console.error(
        "Recursive permanent folder delete error:",
        error
      );

      return res
        .status(500)
        .json({
          error: {
            code:
              "INTERNAL_SERVER_ERROR",
            message:
              "Unable to permanently delete folder and its contents",
          },
        });
    }
  };

// ======================================================
// EXPORTS
// ======================================================

module.exports = {
  createFolder,
  getRootFolders,
  getFolderContents,
  updateFolder,
  deleteFolder,
  restoreFolder,
  permanentlyDeleteFolder,
};