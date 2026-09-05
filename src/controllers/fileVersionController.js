const supabase = require("../config/supabase");

const {
  createSignedDownloadUrl,
  deleteFileFromStorage,
} = require("../services/storageService");

const bucketName =
  process.env.SUPABASE_STORAGE_BUCKET;

// ======================================================
// STORAGE QUOTA
// ======================================================

const DEFAULT_STORAGE_QUOTA_BYTES =
  5 * 1024 * 1024 * 1024;

const getStorageQuotaBytes = () => {
  const configuredQuota =
    Number(
      process.env.STORAGE_QUOTA_BYTES
    );

  if (
    Number.isFinite(
      configuredQuota
    ) &&
    configuredQuota > 0
  ) {
    return configuredQuota;
  }

  return DEFAULT_STORAGE_QUOTA_BYTES;
};

// ======================================================
// HELPER: GET TOTAL USER STORAGE
//
// Includes:
// 1. Current files
// 2. Archived file versions
// ======================================================

const getUserStorageUsage = async (
  ownerId
) => {
  const {
    data: files,
    error: filesError,
  } = await supabase
    .from("files")
    .select("id, size_bytes")
    .eq("owner_id", ownerId);

  if (filesError) {
    throw filesError;
  }

  const activeFiles =
    files || [];

  const currentBytes =
    activeFiles.reduce(
      (total, file) => {
        const size =
          Number(
            file.size_bytes
          );

        return (
          total +
          (
            Number.isFinite(size)
              ? size
              : 0
          )
        );
      },
      0
    );

  if (
    activeFiles.length === 0
  ) {
    return currentBytes;
  }

  const fileIds =
    activeFiles.map(
      (file) => file.id
    );

  const {
    data: versions,
    error: versionsError,
  } = await supabase
    .from("file_versions")
    .select("size_bytes")
    .in(
      "file_id",
      fileIds
    );

  if (versionsError) {
    throw versionsError;
  }

  const versionBytes =
    (
      versions || []
    ).reduce(
      (
        total,
        version
      ) => {
        const size =
          Number(
            version.size_bytes
          );

        return (
          total +
          (
            Number.isFinite(size)
              ? size
              : 0
          )
        );
      },
      0
    );

  return (
    currentBytes +
    versionBytes
  );
};

// ======================================================
// CHECK QUOTA FOR NEW VERSION
// ======================================================

const checkVersionUploadQuota =
  async ({
    ownerId,
    newVersionBytes,
  }) => {
    const quotaBytes =
      getStorageQuotaBytes();

    const usedBytes =
      await getUserStorageUsage(
        ownerId
      );

    const incomingBytes =
      Math.max(
        0,
        Number(
          newVersionBytes
        ) || 0
      );

    /*
      IMPORTANT:

      When uploading Version 2:

      Version 1 is preserved
      +
      Version 2 is added

      Therefore new storage usage increases
      by the size of Version 2.
    */

    const projectedUsedBytes =
      usedBytes +
      incomingBytes;

    return {
      allowed:
        projectedUsedBytes <=
        quotaBytes,

      quotaBytes,

      usedBytes,

      availableBytes:
        Math.max(
          0,
          quotaBytes -
          usedBytes
        ),

      incomingBytes,

      projectedUsedBytes,

      exceededByBytes:
        Math.max(
          0,
          projectedUsedBytes -
          quotaBytes
        ),
    };
  };

// ======================================================
// STORAGE QUOTA ERROR
// ======================================================

const sendStorageQuotaExceeded =
  (
    res,
    quotaResult
  ) => {
    return res
      .status(413)
      .json({
        error: {
          code:
            "STORAGE_QUOTA_EXCEEDED",

          message:
            "Not enough storage space to save this new version.",

          quotaBytes:
            quotaResult.quotaBytes,

          usedBytes:
            quotaResult.usedBytes,

          availableBytes:
            quotaResult.availableBytes,

          requiredBytes:
            quotaResult.incomingBytes,

          projectedUsedBytes:
            quotaResult.projectedUsedBytes,

          exceededByBytes:
            quotaResult.exceededByBytes,
        },
      });
  };

// ======================================================
// SAFE STORAGE NAME
// ======================================================

const sanitizeStorageName = (
  value
) => {
  const safe =
    String(
      value || "file"
    )
      .trim()
      .replace(
        /[^a-zA-Z0-9._-]+/g,
        "_"
      )
      .replace(
        /^_+|_+$/g,
        ""
      );

  return (
    safe || "file"
  );
};

// ======================================================
// BUILD VERSION STORAGE PATH
// ======================================================

const buildVersionStoragePath =
  ({
    ownerId,
    fileId,
    versionNumber,
    fileName,
  }) => {
    return [
      String(ownerId),

      "versions",

      String(fileId),

      `v${versionNumber}-${Date.now()}-${sanitizeStorageName(
        fileName
      )}`,
    ].join("/");
  };

// ======================================================
// CHECK SHARED FOLDER PERMISSION
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

    while (
      currentFolderId
    ) {
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
        return (
          share.permission
        );
      }

      const {
        data: folder,
        error: folderError,
      } = await supabase
        .from("folders")
        .select(
          `
          id,
          parent_id,
          is_deleted
          `
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
// GET FILE ACCESS
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

    // OWNER
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

    // DIRECT FILE SHARE
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

    if (
      directShareError
    ) {
      throw (
        directShareError
      );
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

    // INHERITED FROM FOLDER
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
// GET CURRENT FILE
// ======================================================

const getCurrentFile =
  async (
    fileId
  ) => {
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
        created_at,
        updated_at,
        current_version
        `
      )
      .eq(
        "id",
        fileId
      )
      .maybeSingle();

    if (error) {
      throw error;
    }

    return file;
  };

// ======================================================
// GET FILE VERSION HISTORY
// ======================================================

const getFileVersions =
  async (
    req,
    res
  ) => {
    try {
      const userId =
        req.user.id;

      const fileId =
        req.params.id;

      const file =
        await getCurrentFile(
          fileId
        );

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
                "File not found",
            },
          });
      }

      // ==================================================
      // PERMISSION
      // ==================================================

      const access =
        await getFileAccess({
          file,
          userId,
        });

      if (
        !access.hasAccess
      ) {
        return res
          .status(403)
          .json({
            error: {
              code:
                "FORBIDDEN",

              message:
                "You do not have access to this file",
            },
          });
      }

      // ==================================================
      // ARCHIVED VERSIONS
      // ==================================================

      const {
        data:
          archivedVersions,

        error:
          versionsError,
      } = await supabase
        .from(
          "file_versions"
        )
        .select(
          `
          id,
          file_id,
          version_number,
          name,
          mime_type,
          size_bytes,
          storage_path,
          created_by,
          change_note,
          created_at
          `
        )
        .eq(
          "file_id",
          fileId
        )
        .order(
          "version_number",
          {
            ascending:
              false,
          }
        );

      if (
        versionsError
      ) {
        throw versionsError;
      }

      const currentVersionNumber =
        Number(
          file.current_version
        ) || 1;

      // ==================================================
      // CURRENT VERSION
      // ==================================================

      const currentVersion = {
        id: null,

        fileId:
          file.id,

        versionNumber:
          currentVersionNumber,

        name:
          file.name,

        mimeType:
          file.mime_type,

        fileKind:
          file.file_kind,

        sizeBytes:
          Number(
            file.size_bytes
          ) || 0,

        createdBy:
          file.owner_id,

        changeNote:
          null,

        createdAt:
          file.updated_at ||
          file.created_at,

        isCurrent:
          true,
      };

      // ==================================================
      // OLD VERSIONS
      // ==================================================

      const history =
        (
          archivedVersions ||
          []
        ).map(
          (
            version
          ) => ({
            id:
              version.id,

            fileId:
              version.file_id,

            versionNumber:
              version.version_number,

            name:
              version.name,

            mimeType:
              version.mime_type,

            sizeBytes:
              Number(
                version.size_bytes
              ) || 0,

            createdBy:
              version.created_by,

            changeNote:
              version.change_note,

            createdAt:
              version.created_at,

            isCurrent:
              false,
          })
        );

      // ==================================================
      // RESPONSE
      // ==================================================

      return res
        .status(200)
        .json({
          file: {
            id:
              file.id,

            name:
              file.name,

            fileKind:
              file.file_kind,

            currentVersion:
              currentVersionNumber,

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

          versions: [
            currentVersion,
            ...history,
          ],

          archivedCount:
            history.length,

          totalVersions:
            history.length +
            1,
        });
    } catch (error) {
      console.error(
        "Get file versions error:",
        error
      );

      return res
        .status(500)
        .json({
          error: {
            code:
              "INTERNAL_SERVER_ERROR",

            message:
              "Unable to load file version history",
          },
        });
    }
  };

// ======================================================
// UPLOAD NEW VERSION
// ======================================================

const uploadNewFileVersion =
  async (
    req,
    res
  ) => {
    let archiveStoragePath =
      null;

    let archiveRowId =
      null;

    let oldBuffer =
      null;

    let oldMimeType =
      null;

    let currentStorageReplaced =
      false;

    try {
      const userId =
        req.user.id;

      const fileId =
        req.params.id;

      const changeNote =
        typeof req.body
          ?.changeNote ===
          "string"
          ? req.body
              .changeNote
              .trim()
              .slice(
                0,
                500
              ) ||
            null
          : null;

      // ==================================================
      // VALIDATE FILE
      // ==================================================

      if (!req.file) {
        return res
          .status(400)
          .json({
            error: {
              code:
                "FILE_REQUIRED",

              message:
                "Please select a file for the new version",
            },
          });
      }

      const file =
        await getCurrentFile(
          fileId
        );

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
                "File not found",
            },
          });
      }

      // ==================================================
      // REGULAR FILES ONLY FOR NOW
      // ==================================================

      if (
        file.file_kind !==
        "file"
      ) {
        return res
          .status(400)
          .json({
            error: {
              code:
                "VERSION_UPLOAD_NOT_SUPPORTED",

              message:
                "Upload New Version is currently available for regular files.",
            },
          });
      }

      // ==================================================
      // PERMISSIONS
      // ==================================================

      const access =
        await getFileAccess({
          file,
          userId,
        });

      if (
        !access.hasAccess
      ) {
        return res
          .status(403)
          .json({
            error: {
              code:
                "FORBIDDEN",

              message:
                "You do not have access to this file",
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

      // ==================================================
      // STORAGE QUOTA
      // ==================================================

      const quotaResult =
        await checkVersionUploadQuota(
          {
            ownerId:
              file.owner_id,

            newVersionBytes:
              req.file.size,
          }
        );

      if (
        !quotaResult.allowed
      ) {
        return sendStorageQuotaExceeded(
          res,
          quotaResult
        );
      }

      // ==================================================
      // DOWNLOAD CURRENT STORAGE CONTENT
      // ==================================================

      const {
        data:
          currentStorageFile,

        error:
          currentDownloadError,
      } =
        await supabase
          .storage
          .from(
            bucketName
          )
          .download(
            file.storage_path
          );

      if (
        currentDownloadError
      ) {
        throw (
          currentDownloadError
        );
      }

      const arrayBuffer =
        await currentStorageFile
          .arrayBuffer();

      oldBuffer =
        Buffer.from(
          arrayBuffer
        );

      oldMimeType =
        file.mime_type ||
        "application/octet-stream";

      // ==================================================
      // VERSION NUMBERS
      // ==================================================

      const currentVersion =
        Number(
          file.current_version
        ) || 1;

      const nextVersion =
        currentVersion +
        1;

      // ==================================================
      // BUILD ARCHIVE PATH
      // ==================================================

      archiveStoragePath =
        buildVersionStoragePath(
          {
            ownerId:
              file.owner_id,

            fileId:
              file.id,

            versionNumber:
              currentVersion,

            fileName:
              file.name,
          }
        );

      // ==================================================
      // COPY CURRENT FILE TO ARCHIVE
      // ==================================================

      const {
        error:
          archiveUploadError,
      } =
        await supabase
          .storage
          .from(
            bucketName
          )
          .upload(
            archiveStoragePath,
            oldBuffer,
            {
              contentType:
                oldMimeType,

              upsert:
                false,
            }
          );

      if (
        archiveUploadError
      ) {
        throw (
          archiveUploadError
        );
      }

      // ==================================================
      // CREATE ARCHIVED VERSION RECORD
      // ==================================================

      const {
        data:
          archivedVersion,

        error:
          archiveInsertError,
      } = await supabase
        .from(
          "file_versions"
        )
        .insert({
          file_id:
            file.id,

          version_number:
            currentVersion,

          name:
            file.name,

          mime_type:
            file.mime_type,

          size_bytes:
            Number(
              file.size_bytes
            ) || 0,

          storage_path:
            archiveStoragePath,

          created_by:
            userId,

          change_note:
            changeNote,

          created_at:
            file.updated_at ||
            file.created_at ||
            new Date()
              .toISOString(),
        })
        .select("id")
        .single();

      if (
        archiveInsertError
      ) {
        throw (
          archiveInsertError
        );
      }

      archiveRowId =
        archivedVersion.id;

      // ==================================================
      // REPLACE CURRENT STORAGE OBJECT
      // ==================================================

      const {
        error:
          currentUpdateError,
      } =
        await supabase
          .storage
          .from(
            bucketName
          )
          .update(
            file.storage_path,

            req.file.buffer,

            {
              contentType:
                req.file
                  .mimetype ||
                "application/octet-stream",

              upsert:
                true,
            }
          );

      if (
        currentUpdateError
      ) {
        throw (
          currentUpdateError
        );
      }

      currentStorageReplaced =
        true;

      // ==================================================
      // UPDATE CURRENT FILE DATABASE METADATA
      //
      // NOTE:
      // Drive filename remains the same.
      // ==================================================

      const now =
        new Date()
          .toISOString();

      const {
        data:
          updatedFile,

        error:
          metadataUpdateError,
      } = await supabase
        .from("files")
        .update({
          mime_type:
            req.file
              .mimetype ||
            file.mime_type ||
            "application/octet-stream",

          size_bytes:
            req.file.size,

          current_version:
            nextVersion,

          updated_at:
            now,

          last_accessed_at:
            now,
        })
        .eq(
          "id",
          file.id
        )
        .eq(
          "current_version",
          currentVersion
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
          current_version,
          created_at,
          updated_at
          `
        )
        .maybeSingle();

      if (
        metadataUpdateError
      ) {
        throw (
          metadataUpdateError
        );
      }

      if (!updatedFile) {
        throw new Error(
          "VERSION_CONFLICT"
        );
      }

      // ==================================================
      // SUCCESS
      // ==================================================

      return res
        .status(201)
        .json({
          message:
            `Version ${nextVersion} uploaded successfully`,

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

            currentVersion:
              updatedFile.current_version,

            createdAt:
              updatedFile.created_at,

            updatedAt:
              updatedFile.updated_at,
          },

          archivedVersion: {
            id:
              archiveRowId,

            versionNumber:
              currentVersion,
          },

          currentVersion:
            nextVersion,
        });
    } catch (error) {
      console.error(
        "Upload new file version error:",
        error
      );

      // ==================================================
      // ROLLBACK CURRENT STORAGE
      // ==================================================

      if (
        currentStorageReplaced &&
        oldBuffer
      ) {
        try {
          const file =
            await getCurrentFile(
              req.params.id
            );

          if (
            file?.storage_path
          ) {
            await supabase
              .storage
              .from(
                bucketName
              )
              .update(
                file.storage_path,

                oldBuffer,

                {
                  contentType:
                    oldMimeType ||
                    "application/octet-stream",

                  upsert:
                    true,
                }
              );
          }
        } catch (
          rollbackStorageError
        ) {
          console.error(
            "Version rollback storage error:",
            rollbackStorageError
          );
        }
      }

      // ==================================================
      // DELETE ARCHIVED DATABASE ROW
      // ==================================================

      if (archiveRowId) {
        try {
          await supabase
            .from(
              "file_versions"
            )
            .delete()
            .eq(
              "id",
              archiveRowId
            );
        } catch (
          rollbackRowError
        ) {
          console.error(
            "Version rollback DB error:",
            rollbackRowError
          );
        }
      }

      // ==================================================
      // DELETE ARCHIVED STORAGE COPY
      // ==================================================

      if (
        archiveStoragePath
      ) {
        try {
          await deleteFileFromStorage(
            archiveStoragePath
          );
        } catch (
          rollbackArchiveError
        ) {
          console.error(
            "Version rollback archive error:",
            rollbackArchiveError
          );
        }
      }

      // ==================================================
      // VERSION CONFLICT
      // ==================================================

      if (
        error?.message ===
        "VERSION_CONFLICT"
      ) {
        return res
          .status(409)
          .json({
            error: {
              code:
                "VERSION_CONFLICT",

              message:
                "The file changed while the version was being uploaded. Refresh and try again.",
            },
          });
      }

      return res
        .status(500)
        .json({
          error: {
            code:
              "INTERNAL_SERVER_ERROR",

            message:
              "Unable to upload new file version",
          },
        });
    }
  };

// ======================================================
// GET OLD VERSION SIGNED DOWNLOAD URL
// ======================================================

const getArchivedVersionDownloadUrl =
  async (
    req,
    res
  ) => {
    try {
      const userId =
        req.user.id;

      const fileId =
        req.params.id;

      const versionId =
        req.params.versionId;

      const file =
        await getCurrentFile(
          fileId
        );

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
                "File not found",
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

      if (
        !access.hasAccess
      ) {
        return res
          .status(403)
          .json({
            error: {
              code:
                "FORBIDDEN",

              message:
                "You do not have access to this file",
            },
          });
      }

      // ==================================================
      // LOAD VERSION
      // ==================================================

      const {
        data: version,
        error:
          versionError,
      } = await supabase
        .from(
          "file_versions"
        )
        .select(
          `
          id,
          file_id,
          version_number,
          name,
          mime_type,
          size_bytes,
          storage_path
          `
        )
        .eq(
          "id",
          versionId
        )
        .eq(
          "file_id",
          fileId
        )
        .maybeSingle();

      if (
        versionError
      ) {
        throw versionError;
      }

      if (!version) {
        return res
          .status(404)
          .json({
            error: {
              code:
                "VERSION_NOT_FOUND",

              message:
                "File version not found",
            },
          });
      }

      // ==================================================
      // SIGNED URL
      // ==================================================

      const signedUrl =
        await createSignedDownloadUrl(
          version.storage_path,
          300
        );

      return res
        .status(200)
        .json({
          version: {
            id:
              version.id,

            fileId:
              version.file_id,

            versionNumber:
              version.version_number,

            name:
              version.name,

            mimeType:
              version.mime_type,

            sizeBytes:
              version.size_bytes,
          },

          signedUrl,

          expiresIn:
            300,
        });
    } catch (error) {
      console.error(
        "Get archived version URL error:",
        error
      );

      return res
        .status(500)
        .json({
          error: {
            code:
              "INTERNAL_SERVER_ERROR",

            message:
              "Unable to open this file version",
          },
        });
    }
  };

// ======================================================
// EXPORTS
// ======================================================

module.exports = {
  getFileVersions,
  uploadNewFileVersion,
  getArchivedVersionDownloadUrl,
};