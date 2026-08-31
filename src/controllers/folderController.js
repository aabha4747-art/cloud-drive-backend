const supabase = require("../config/supabase");

const {
  deleteFileFromStorage,
} = require("../services/storageService");

// ======================================================
// HELPER - CALCULATE RECURSIVE FOLDER SIZES
// ======================================================

const calculateFolderSizes = async (
  ownerId,
  targetFolderIds
) => {
  if (
    !Array.isArray(targetFolderIds) ||
    targetFolderIds.length === 0
  ) {
    return {};
  }

  // --------------------------------------------------
  // Get every folder belonging to this owner.
  //
  // We need the full folder tree so that a parent
  // folder can include files stored in nested folders.
  // --------------------------------------------------

  const {
    data: allFolders,
    error: foldersError,
  } = await supabase
    .from("folders")
    .select(
      "id, parent_id, is_deleted"
    )
    .eq(
      "owner_id",
      ownerId
    )
    .eq(
      "is_deleted",
      false
    );

  if (foldersError) {
    throw foldersError;
  }

  // --------------------------------------------------
  // Get all active files belonging to the owner.
  // --------------------------------------------------

  const {
    data: allFiles,
    error: filesError,
  } = await supabase
    .from("files")
    .select(
      "id, folder_id, size_bytes"
    )
    .eq(
      "owner_id",
      ownerId
    )
    .eq(
      "is_deleted",
      false
    );

  if (filesError) {
    throw filesError;
  }

  const folders =
    allFolders || [];

  const files =
    allFiles || [];

  // --------------------------------------------------
  // parentFolderId -> child folder IDs
  // --------------------------------------------------

  const childrenMap =
    new Map();

  for (const folder of folders) {
    if (!folder.parent_id) {
      continue;
    }

    if (
      !childrenMap.has(
        folder.parent_id
      )
    ) {
      childrenMap.set(
        folder.parent_id,
        []
      );
    }

    childrenMap
      .get(folder.parent_id)
      .push(folder.id);
  }

  // --------------------------------------------------
  // folderId -> bytes belonging directly to folder
  // --------------------------------------------------

  const directSizeMap =
    new Map();

  for (const file of files) {
    if (!file.folder_id) {
      continue;
    }

    const fileSize =
      Number(
        file.size_bytes
      ) || 0;

    directSizeMap.set(
      file.folder_id,
      (
        directSizeMap.get(
          file.folder_id
        ) || 0
      ) + fileSize
    );
  }

  // --------------------------------------------------
  // Recursive size calculator
  // --------------------------------------------------

  const memo =
    new Map();

  const calculateSize = (
    folderId,
    visited = new Set()
  ) => {
    if (memo.has(folderId)) {
      return memo.get(
        folderId
      );
    }

    // Protect against corrupted circular folder trees.
    if (
      visited.has(folderId)
    ) {
      return 0;
    }

    const nextVisited =
      new Set(visited);

    nextVisited.add(
      folderId
    );

    let totalSize =
      directSizeMap.get(
        folderId
      ) || 0;

    const childIds =
      childrenMap.get(
        folderId
      ) || [];

    for (
      const childId
      of childIds
    ) {
      totalSize +=
        calculateSize(
          childId,
          nextVisited
        );
    }

    memo.set(
      folderId,
      totalSize
    );

    return totalSize;
  };

  // --------------------------------------------------
  // Return only sizes requested by the caller.
  // --------------------------------------------------

  const result = {};

  for (
    const folderId
    of targetFolderIds
  ) {
    result[folderId] =
      calculateSize(
        folderId
      );
  }

  return result;
};

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
      "id, name, owner_id, parent_id, is_deleted, is_starred, is_project, created_at, updated_at"
    )
    .eq("id", folderId)
    .maybeSingle();

  if (folderError) {
    throw folderError;
  }

  if (!folder || folder.is_deleted) {
    return {
      folder: null,
      hasAccess: false,
      permission: null,
      sharedRootId: null,
    };
  }

  // ==================================================
  // OWNER
  // ==================================================

  if (folder.owner_id === userId) {
    return {
      folder,
      hasAccess: true,
      permission: "owner",
      sharedRootId: null,
    };
  }

  // ==================================================
  // SHARED / INHERITED ACCESS
  // ==================================================

  let currentFolder = folder;

  const visited = new Set();

  while (
    currentFolder &&
    !visited.has(currentFolder.id)
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
// CREATE NORMAL FOLDER
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

    if (!name || !name.trim()) {
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

    // ==================================================
    // VALIDATE PARENT
    // ==================================================

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
        .maybeSingle();

      if (parentError) {
        throw parentError;
      }

      if (!parentFolder) {
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
                "You cannot create a folder here",
            },
          });
      }
    }

    // ==================================================
    // DUPLICATE CHECK
    // ==================================================

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

    if (parentId === null) {
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
      data: existingFolder,
      error: existingError,
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

    // ==================================================
    // CREATE
    // ==================================================

    const {
      data: folder,
      error,
    } = await supabase
      .from("folders")
      .insert({
        name: name.trim(),

        owner_id:
          ownerId,

        parent_id:
          parentId,

        is_project:
          false,
      })
      .select(
        "id, name, owner_id, parent_id, is_deleted, is_starred, is_project, created_at, updated_at"
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
          id:
            folder.id,

          name:
            folder.name,

          ownerId:
            folder.owner_id,

          parentId:
            folder.parent_id,

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
// CREATE PROJECT
// ======================================================

const createProject = async (
  req,
  res
) => {
  try {
    const ownerId =
      req.user.id;

    const {
      name,
      parentId = null,
    } = req.body;

    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({
          error: {
            code:
              "VALIDATION_ERROR",

            message:
              "Project name is required",
          },
        });
    }

    const projectName =
      name.trim();

    // ==================================================
    // VALIDATE PARENT
    // ==================================================

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
        .maybeSingle();

      if (parentError) {
        throw parentError;
      }

      if (!parentFolder) {
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
                "You cannot create a project here",
            },
          });
      }
    }

    // ==================================================
    // DUPLICATE CHECK
    // ==================================================

    let existingProjectQuery =
      supabase
        .from("folders")
        .select("id")
        .eq(
          "owner_id",
          ownerId
        )
        .eq(
          "name",
          projectName
        )
        .eq(
          "is_deleted",
          false
        );

    if (parentId === null) {
      existingProjectQuery =
        existingProjectQuery.is(
          "parent_id",
          null
        );
    } else {
      existingProjectQuery =
        existingProjectQuery.eq(
          "parent_id",
          parentId
        );
    }

    const {
      data: existingProject,
      error: existingError,
    } =
      await existingProjectQuery.maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existingProject) {
      return res
        .status(409)
        .json({
          error: {
            code:
              "PROJECT_EXISTS",

            message:
              "A folder or project with this name already exists here",
          },
        });
    }

    // ==================================================
    // CREATE PROJECT ROOT
    // ==================================================

    const {
      data: projectFolder,
      error: projectError,
    } = await supabase
      .from("folders")
      .insert({
        name:
          projectName,

        owner_id:
          ownerId,

        parent_id:
          parentId,

        is_project:
          true,
      })
      .select(
        "id, name, owner_id, parent_id, is_deleted, is_starred, is_project, created_at, updated_at"
      )
      .single();

    if (projectError) {
      throw projectError;
    }

    // ==================================================
    // PROJECT DEFAULT FOLDERS
    // ==================================================

    const defaultFolders = [
      "Documents",
      "Assets",
      "Data",
      "Notes",
    ];

    const childFolderRows =
      defaultFolders.map(
        (folderName) => ({
          name:
            folderName,

          owner_id:
            ownerId,

          parent_id:
            projectFolder.id,

          is_project:
            false,
        })
      );

    const {
      data: createdFolders,
      error:
        childFoldersError,
    } = await supabase
      .from("folders")
      .insert(
        childFolderRows
      )
      .select(
        "id, name, owner_id, parent_id, is_deleted, is_starred, is_project, created_at, updated_at"
      );

    if (childFoldersError) {
      console.error(
        "Create project subfolders error:",
        childFoldersError
      );

      await supabase
        .from("folders")
        .delete()
        .eq(
          "parent_id",
          projectFolder.id
        )
        .eq(
          "owner_id",
          ownerId
        );

      await supabase
        .from("folders")
        .delete()
        .eq(
          "id",
          projectFolder.id
        )
        .eq(
          "owner_id",
          ownerId
        );

      throw childFoldersError;
    }

    return res
      .status(201)
      .json({
        message:
          "Project created successfully",

        project: {
          id:
            projectFolder.id,

          name:
            projectFolder.name,

          ownerId:
            projectFolder.owner_id,

          parentId:
            projectFolder.parent_id,

          isDeleted:
            projectFolder.is_deleted,

          isStarred:
            projectFolder.is_starred,

          isProject:
            projectFolder.is_project,

          createdAt:
            projectFolder.created_at,

          updatedAt:
            projectFolder.updated_at,

          folders:
            (
              createdFolders ||
              []
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
        },
      });
  } catch (error) {
    console.error(
      "Create project error:",
      error
    );

    return res
      .status(500)
      .json({
        error: {
          code:
            "INTERNAL_SERVER_ERROR",

          message:
            "Unable to create project",
        },
      });
  }
};

// ======================================================
// GET PROJECTS
// ======================================================

const getProjects = async (
  req,
  res
) => {
  try {
    const ownerId =
      req.user.id;

    const {
      data: projects,
      error,
    } = await supabase
      .from("folders")
      .select(
        "id, name, owner_id, parent_id, is_starred, is_project, created_at, updated_at"
      )
      .eq(
        "owner_id",
        ownerId
      )
      .eq(
        "is_deleted",
        false
      )
      .eq(
        "is_project",
        true
      )
      .order(
        "updated_at",
        {
          ascending: false,
        }
      );

    if (error) {
      throw error;
    }

    return res
      .status(200)
      .json({
        projects:
          (
            projects || []
          ).map(
            (project) => ({
              id:
                project.id,

              name:
                project.name,

              ownerId:
                project.owner_id,

              parentId:
                project.parent_id,

              isStarred:
                project.is_starred,

              isProject:
                project.is_project,

              createdAt:
                project.created_at,

              updatedAt:
                project.updated_at,
            })
          ),
      });
  } catch (error) {
    console.error(
      "Get projects error:",
      error
    );

    return res
      .status(500)
      .json({
        error: {
          code:
            "INTERNAL_SERVER_ERROR",

          message:
            "Unable to fetch projects",
        },
      });
  }
};

// ======================================================
// GET ROOT CONTENTS
// PROJECTS HIDDEN FROM MY DRIVE
// ======================================================

const getRootFolders = async (
  req,
  res
) => {
  try {
    const ownerId =
      req.user.id;

    // ==================================================
    // ROOT FOLDERS
    // ==================================================

    const {
      data: folders,
      error: foldersError,
    } = await supabase
      .from("folders")
      .select(
        "id, name, owner_id, parent_id, is_starred, is_project, created_at, updated_at"
      )
      .eq(
        "owner_id",
        ownerId
      )
      .eq(
        "is_deleted",
        false
      )
      .eq(
        "is_project",
        false
      )
      .is(
        "parent_id",
        null
      )
      .order(
        "name",
        {
          ascending: true,
        }
      );

    if (foldersError) {
      throw foldersError;
    }

    // ==================================================
    // ROOT FILES
    //
    // IMPORTANT:
    // file_kind is now returned.
    // ==================================================

    const {
      data: files,
      error: filesError,
    } = await supabase
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
        false
      )
      .is(
        "folder_id",
        null
      )
      .order(
        "name",
        {
          ascending: true,
        }
      );

    if (filesError) {
  throw filesError;
}

// ==================================================
// CALCULATE RECURSIVE ROOT FOLDER SIZES
// ==================================================

const folderSizes =
  await calculateFolderSizes(
    ownerId,
    (folders || []).map(
      (folder) =>
        folder.id
    )
  );

return res
  .status(200)
  .json({
        folders:
          (
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

              isProject:
                folder.is_project,

              sizeBytes:
                folderSizes[
                  folder.id
                ] || 0,

              createdAt:
                folder.created_at,

              updatedAt:
                folder.updated_at,
            })
          ),

        files:
          (
            files || []
          ).map(
            (file) => ({
              id:
                file.id,

              name:
                file.name,

              mimeType:
                file.mime_type,

              // IMPORTANT
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
// OWNER / VIEWER / EDITOR
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

      const folderOwnerId =
        folder.owner_id;

      // ==================================================
      // CHILD FOLDERS
      // ==================================================

      const {
        data: childFolders,
        error: childError,
      } = await supabase
        .from("folders")
        .select(
          "id, name, owner_id, parent_id, is_starred, is_project, created_at, updated_at"
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
        .order(
          "name",
          {
            ascending: true,
          }
        );

      if (childError) {
        throw childError;
      }

      // ==================================================
      // FILES INSIDE FOLDER
      //
      // IMPORTANT:
      // file_kind is now returned.
      // ==================================================

      const {
        data: files,
        error: filesError,
      } = await supabase
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
          is_starred,
          created_at,
          updated_at
          `
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
        .order(
          "name",
          {
            ascending: true,
          }
        );

      if (filesError) {
  throw filesError;
}

// ==================================================
// CALCULATE RECURSIVE CHILD FOLDER SIZES
// ==================================================

const childFolderSizes =
  await calculateFolderSizes(
    folderOwnerId,
    (
      childFolders || []
    ).map(
      (childFolder) =>
        childFolder.id
    )
  );

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

            isProject:
              folder.is_project,

            createdAt:
              folder.created_at,

            updatedAt:
              folder.updated_at,
          },

          access: {
            isOwner,

            permission,

            sharedRootId,

            canEdit:
              permission ===
                "owner" ||
              permission ===
                "editor",
          },

          folders:
            (
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

                isProject:
                  childFolder.is_project,

                sizeBytes:
                  childFolderSizes[
                    childFolder.id
                  ] || 0,

                createdAt:
                  childFolder.created_at,

                updatedAt:
                  childFolder.updated_at,
              })
            ),

          files:
            (
              files || []
            ).map(
              (file) => ({
                id:
                  file.id,

                name:
                  file.name,

                mimeType:
                  file.mime_type,

                // IMPORTANT
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
// UPDATE / RENAME FOLDER
// ======================================================

const updateFolder = async (
  req,
  res
) => {
  try {
    const userId =
      req.user.id;

    const folderId =
      req.params.id;

    const {
      name,
      parentId,
    } = req.body;

    const {
      folder,
      hasAccess,
      permission,
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
              "You do not have permission to modify this folder",
          },
        });
    }

    if (folder.is_deleted) {
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

    const isOwner =
      permission === "owner";

    const isEditor =
      permission === "editor";

    if (
      !isOwner &&
      !isEditor
    ) {
      return res
        .status(403)
        .json({
          error: {
            code:
              "VIEWER_READ_ONLY",

            message:
              "Viewer access is read-only",
          },
        });
    }

    // Editor cannot move folders
    if (
      !isOwner &&
      parentId !== undefined
    ) {
      return res
        .status(403)
        .json({
          error: {
            code:
              "EDITOR_RENAME_ONLY",

            message:
              "Editors can rename shared folders but cannot move them",
          },
        });
    }

    const updates = {};

    // ==================================================
    // RENAME
    // ==================================================

    if (name !== undefined) {
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

    // ==================================================
    // MOVE - OWNER ONLY
    // ==================================================

    if (
      parentId !== undefined
    ) {
      if (
        parentId === folderId
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

      if (parentId !== null) {
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
          .maybeSingle();

        if (parentError) {
          throw parentError;
        }

        if (!parentFolder) {
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
            folder.owner_id ||
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
      parentId === undefined
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
      data: updatedFolder,
      error,
    } = await supabase
      .from("folders")
      .update(updates)
      .eq(
        "id",
        folderId
      )
      .select(
        "id, name, owner_id, parent_id, is_deleted, is_starred, is_project, created_at, updated_at"
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

          isProject:
            updatedFolder.is_project,

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
      error: folderError,
    } = await supabase
      .from("folders")
      .select(
        "id, owner_id, is_deleted"
      )
      .eq(
        "id",
        folderId
      )
      .maybeSingle();

    if (folderError) {
      throw folderError;
    }

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
              "Only the owner can delete this folder",
          },
        });
    }

    if (folder.is_deleted) {
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
      data: deletedFolder,
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
        "id, name, is_deleted, is_starred, is_project, updated_at"
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

          isProject:
            deletedFolder.is_project,

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
        error: folderError,
      } = await supabase
        .from("folders")
        .select(
          "id, name, owner_id, parent_id, is_deleted, is_starred, is_project"
        )
        .eq(
          "id",
          folderId
        )
        .maybeSingle();

      if (folderError) {
        throw folderError;
      }

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
                "Only the owner can restore this folder",
            },
          });
      }

      if (!folder.is_deleted) {
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

      if (restoreParentId) {
        const {
          data: parentFolder,
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
        data: restoredFolder,
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
          "id, name, parent_id, is_deleted, is_starred, is_project, created_at, updated_at"
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

            isProject:
              restoredFolder.is_project,

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
        error: folderError,
      } = await supabase
        .from("folders")
        .select(
          "id, name, owner_id, parent_id, is_deleted, is_project"
        )
        .eq(
          "id",
          folderId
        )
        .maybeSingle();

      if (folderError) {
        throw folderError;
      }

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
                "Only the owner can permanently delete this folder",
            },
          });
      }

      if (!folder.is_deleted) {
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

      // ==================================================
      // GET ALL OWNER FOLDERS
      // ==================================================

      const {
        data: allFolders,
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

      if (allFoldersError) {
        throw allFoldersError;
      }

      // ==================================================
      // FIND DESCENDANTS
      // ==================================================

      const descendantFolderIds =
        [];

      const findChildren = (
        parentId
      ) => {
        const children =
          (
            allFolders || []
          ).filter(
            (item) =>
              item.parent_id ===
              parentId
          );

        for (
          const child
          of children
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

      const folderTreeIds = [
        folderId,
        ...descendantFolderIds,
      ];

      // ==================================================
      // GET ALL FILES IN TREE
      // ==================================================

      const {
        data: folderFiles,
        error: filesError,
      } = await supabase
        .from("files")
        .select(
          `
          id,
          name,
          file_kind,
          storage_path,
          folder_id,
          owner_id
          `
        )
        .eq(
          "owner_id",
          ownerId
        )
        .in(
          "folder_id",
          folderTreeIds
        );

      if (filesError) {
        throw filesError;
      }

      const files =
        folderFiles || [];

      // ==================================================
      // DELETE STORAGE OBJECTS
      // ==================================================

      for (
        const file
        of files
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

      // ==================================================
      // DELETE FILE ROWS
      // ==================================================

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

      // ==================================================
      // DEPTH CALCULATION
      // ==================================================

      const getFolderDepth = (
        id
      ) => {
        let depth = 0;

        let current =
          (
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

          current =
            (
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
            getFolderDepth(b) -
            getFolderDepth(a)
        );

      // ==================================================
      // DELETE CHILD FOLDERS
      // ==================================================

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

      // ==================================================
      // DELETE ROOT FOLDER / PROJECT
      // ==================================================

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

            wasProject:
              Boolean(
                folder.is_project
              ),

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
  createProject,
  getProjects,
  getRootFolders,
  getFolderContents,
  updateFolder,
  deleteFolder,
  restoreFolder,
  permanentlyDeleteFolder,
};