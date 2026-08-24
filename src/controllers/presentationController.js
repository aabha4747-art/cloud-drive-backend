const supabase =
  require("../config/supabase");

const {
  buildStoragePath,
  uploadFileToStorage,
  deleteFileFromStorage,
} = require(
  "../services/storageService"
);

const bucketName =
  process.env.SUPABASE_STORAGE_BUCKET;

// ======================================================
// HELPER: INHERITED FOLDER PERMISSION
// ======================================================

const getInheritedFolderPermission =
  async ({
    folderId,
    userId,
  }) => {
    let currentFolderId =
      folderId;

    const visited =
      new Set();

    while (currentFolderId) {
      if (
        visited.has(
          currentFolderId
        )
      ) {
        break;
      }

      visited.add(
        currentFolderId
      );

      const {
        data: share,
        error: shareError,
      } = await supabase
        .from("shares")
        .select(
          "id, permission"
        )
        .eq(
          "folder_id",
          currentFolderId
        )
        .eq(
          "shared_with_id",
          userId
        )
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
        .select(
          "id, parent_id, is_deleted"
        )
        .eq(
          "id",
          currentFolderId
        )
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
// HELPER: FILE ACCESS
// ======================================================

const getFileAccess =
  async ({
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

    if (
      file.owner_id ===
      userId
    ) {
      return {
        hasAccess: true,
        permission: "owner",
        accessType: "owner",
      };
    }

    const {
      data: directShare,
      error:
        directShareError,
    } = await supabase
      .from("shares")
      .select(
        "id, permission"
      )
      .eq(
        "file_id",
        file.id
      )
      .eq(
        "shared_with_id",
        userId
      )
      .maybeSingle();

    if (directShareError) {
      throw directShareError;
    }

    if (directShare) {
      return {
        hasAccess: true,
        permission:
          directShare.permission,
        accessType:
          "direct-file-share",
      };
    }

    if (file.folder_id) {
      const inheritedPermission =
        await getInheritedFolderPermission(
          {
            folderId:
              file.folder_id,
            userId,
          }
        );

      if (
        inheritedPermission
      ) {
        return {
          hasAccess: true,
          permission:
            inheritedPermission,
          accessType:
            "shared-folder",
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
// ======================================================

const validateOwnedTargetFolder =
  async ({
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
      .select(
        "id, owner_id, is_deleted"
      )
      .eq(
        "id",
        folderId
      )
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!folder) {
      return {
        valid: false,
        status: 404,
        error: {
          code:
            "FOLDER_NOT_FOUND",

          message:
            "Target folder not found",
        },
      };
    }

    if (
      folder.owner_id !==
        ownerId ||
      folder.is_deleted
    ) {
      return {
        valid: false,
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
// CREATE PRESENTATION
// ======================================================

const createPresentation =
  async (req, res) => {
    let uploadedStoragePath =
      null;

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
        return res
          .status(400)
          .json({
            error: {
              code:
                "VALIDATION_ERROR",

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
          .endsWith(
            ".cloudslides"
          )
          ? cleanName
          : `${cleanName}.cloudslides`;

      const targetValidation =
        await validateOwnedTargetFolder(
          {
            folderId,
            ownerId,
          }
        );

      if (
        !targetValidation.valid
      ) {
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

      if (
        folderId === null
      ) {
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

      if (
        existingPresentation
      ) {
        return res
          .status(409)
          .json({
            error: {
              code:
                "PRESENTATION_EXISTS",

              message:
                "A presentation with this name already exists here",
            },
          });
      }

      // ==================================================
      // INITIAL PRESENTATION DATA
      // ==================================================

      const initialPresentation =
        {
          version: 1,

          slides: [
            {
              id: "slide-1",

              background: {
                type: "solid",
                value:
                  "#ffffff",
              },

              elements: [
                {
                  id:
                    "title-1",

                  type:
                    "text",

                  x: 10,
                  y: 25,

                  width: 80,
                  height: 15,

                  text:
                    "Click to add title",

                  style: {
                    fontSize:
                      32,

                    fontWeight:
                      "700",

                    textAlign:
                      "center",

                    color:
                      "#0f172a",
                  },
                },

                {
                  id:
                    "subtitle-1",

                  type:
                    "text",

                  x: 15,
                  y: 48,

                  width: 70,
                  height: 10,

                  text:
                    "Click to add subtitle",

                  style: {
                    fontSize:
                      18,

                    fontWeight:
                      "400",

                    textAlign:
                      "center",

                    color:
                      "#64748b",
                  },
                },
              ],
            },
          ],

          activeSlideId:
            "slide-1",

          settings: {
            aspectRatio:
              "16:9",
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

      return res
        .status(201)
        .json({
          message:
            "Presentation created successfully",

          presentation: {
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

      return res
        .status(500)
        .json({
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
// GET PRESENTATION
// ======================================================

const getPresentation =
  async (req, res) => {
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
        return res
          .status(404)
          .json({
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
        return res
          .status(400)
          .json({
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
        return res
          .status(403)
          .json({
            error: {
              code:
                "FORBIDDEN",

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
          JSON.parse(
            rawContent
          );
      } catch {
        return res
          .status(500)
          .json({
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
        error:
          accessUpdateError,
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

      if (
        accessUpdateError
      ) {
        console.error(
          "Unable to update presentation access time:",
          accessUpdateError
        );
      }

      return res
        .status(200)
        .json({
          presentation: {
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
              presentationData,
          },
        });
    } catch (error) {
      console.error(
        "Get presentation error:",
        error
      );

      return res
        .status(500)
        .json({
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
// SAVE PRESENTATION
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
        return res
          .status(400)
          .json({
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
        return res
          .status(404)
          .json({
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
        return res
          .status(400)
          .json({
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
        return res
          .status(403)
          .json({
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

      const content =
        JSON.stringify(data);

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
                "application/json",

              upsert: true,
            }
          );

      if (
        storageUpdateError
      ) {
        throw storageUpdateError;
      }

      const now =
        new Date().toISOString();

      const {
        data: updatedFile,
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

      return res
        .status(200)
        .json({
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

      return res
        .status(500)
        .json({
          error: {
            code:
              "INTERNAL_SERVER_ERROR",

            message:
              "Unable to save presentation",
          },
        });
    }
  };

// ======================================================
// EXPORTS
// ======================================================

module.exports = {
  createPresentation,
  getPresentation,
  updatePresentationContent,
};