const supabase = require("../config/supabase");
const { sendShareEmail } = require("../services/emailService");

// ======================================================
// BUILD DIRECT LINK FOR SHARED ITEM
// ======================================================

const buildSharedItemUrl = ({
  clientUrl,
  fileId,
  folderId,
  fileKind,
}) => {
  const baseUrl = clientUrl.replace(/\/+$/, "");

  // Shared folder
  if (folderId) {
    return `${baseUrl}/shared/folders/${folderId}`;
  }

  // Cloud document
  if (fileKind === "document") {
    return `${baseUrl}/documents/${fileId}`;
  }

  // Cloud spreadsheet
  if (fileKind === "spreadsheet") {
    return `${baseUrl}/spreadsheets/${fileId}`;
  }

  // Cloud presentation
  if (fileKind === "presentation") {
    return `${baseUrl}/presentations/${fileId}`;
  }

  // Regular uploaded file
  return `${baseUrl}/shared?fileId=${fileId}`;
};

// ======================================================
// CREATE SHARE
// ======================================================

const createShare = async (req, res) => {
  try {
    const ownerId = req.user.id;

    const {
      email,
      fileId = null,
      folderId = null,
      permission = "viewer",
    } = req.body;

    // --------------------------------------------------
    // VALIDATION
    // --------------------------------------------------

    if (!email) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Email is required",
        },
      });
    }

    if (!fileId && !folderId) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Either fileId or folderId is required",
        },
      });
    }

    if (fileId && folderId) {
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Share either a file or a folder, not both",
        },
      });
    }

    if (!["viewer", "editor"].includes(permission)) {
      return res.status(400).json({
        error: {
          code: "INVALID_PERMISSION",
          message: "Permission must be viewer or editor",
        },
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // --------------------------------------------------
    // GET TARGET USER
    // --------------------------------------------------

    const { data: targetUser, error: userError } = await supabase
      .from("users")
      .select("id, name, email")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (userError) {
      throw userError;
    }

    if (!targetUser) {
      return res.status(404).json({
        error: {
          code: "USER_NOT_FOUND",
          message: "User with this email was not found",
        },
      });
    }

    if (targetUser.id === ownerId) {
      return res.status(400).json({
        error: {
          code: "CANNOT_SHARE_WITH_SELF",
          message: "You cannot share an item with yourself",
        },
      });
    }

    // --------------------------------------------------
    // GET OWNER / SHARER DETAILS
    // --------------------------------------------------

    const { data: ownerUser, error: ownerUserError } = await supabase
      .from("users")
      .select("id, name, email")
      .eq("id", ownerId)
      .maybeSingle();

    if (ownerUserError) {
      console.error("Owner lookup error:", ownerUserError);
    }

    // --------------------------------------------------
    // ITEM DETAILS
    // --------------------------------------------------

    let itemName = "Shared item";
    let resourceType = fileId ? "file" : "folder";
    let fileKind = "file";

    // --------------------------------------------------
    // VALIDATE FILE
    // --------------------------------------------------

    if (fileId) {
      const { data: file, error: fileError } = await supabase
        .from("files")
        .select(
          "id, name, owner_id, is_deleted, file_kind"
        )
        .eq("id", fileId)
        .single();

      if (fileError || !file) {
        return res.status(404).json({
          error: {
            code: "FILE_NOT_FOUND",
            message: "File not found",
          },
        });
      }

      if (file.owner_id !== ownerId) {
        return res.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: "You can only share files that you own",
          },
        });
      }

      if (file.is_deleted) {
        return res.status(400).json({
          error: {
            code: "FILE_DELETED",
            message: "Deleted files cannot be shared",
          },
        });
      }

      itemName = file.name;
      resourceType = "file";
      fileKind = file.file_kind || "file";
    }

    // --------------------------------------------------
    // VALIDATE FOLDER
    // --------------------------------------------------

    if (folderId) {
      const { data: folder, error: folderError } = await supabase
        .from("folders")
        .select(
          "id, name, owner_id, is_deleted"
        )
        .eq("id", folderId)
        .single();

      if (folderError || !folder) {
        return res.status(404).json({
          error: {
            code: "FOLDER_NOT_FOUND",
            message: "Folder not found",
          },
        });
      }

      if (folder.owner_id !== ownerId) {
        return res.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: "You can only share folders that you own",
          },
        });
      }

      if (folder.is_deleted) {
        return res.status(400).json({
          error: {
            code: "FOLDER_DELETED",
            message: "Deleted folders cannot be shared",
          },
        });
      }

      itemName = folder.name;
      resourceType = "folder";
    }

    // --------------------------------------------------
    // CHECK IF ALREADY SHARED
    // --------------------------------------------------

    let existingShareQuery = supabase
      .from("shares")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("shared_with_id", targetUser.id);

    if (fileId) {
      existingShareQuery =
        existingShareQuery.eq("file_id", fileId);
    } else {
      existingShareQuery =
        existingShareQuery.eq("folder_id", folderId);
    }

    const {
      data: existingShare,
      error: existingShareError,
    } = await existingShareQuery.maybeSingle();

    if (existingShareError) {
      throw existingShareError;
    }

    if (existingShare) {
      return res.status(409).json({
        error: {
          code: "ALREADY_SHARED",
          message: "This item is already shared with that user",
        },
      });
    }

    // --------------------------------------------------
    // CREATE SHARE
    // --------------------------------------------------

    const { data: share, error: shareError } = await supabase
      .from("shares")
      .insert({
        owner_id: ownerId,
        shared_with_id: targetUser.id,
        file_id: fileId,
        folder_id: folderId,
        permission,
      })
      .select(
        `
        id,
        owner_id,
        shared_with_id,
        file_id,
        folder_id,
        permission,
        created_at
        `
      )
      .single();

    if (shareError) {
      throw shareError;
    }

    // --------------------------------------------------
    // BUILD DIRECT ITEM LINK
    // --------------------------------------------------

    const clientUrl =
      process.env.CLIENT_URL ||
      "http://localhost:5173";

    const openUrl = buildSharedItemUrl({
      clientUrl,
      fileId,
      folderId,
      fileKind,
    });

    // --------------------------------------------------
    // SEND EMAIL
    // --------------------------------------------------

    let emailSent = false;

    try {
      await sendShareEmail({
        to: targetUser.email,

        recipientName:
          targetUser.name,

        sharerName:
          ownerUser?.name ||
          ownerUser?.email ||
          "Someone",

        itemName,

        resourceType,

        permission,

        openUrl,
      });

      emailSent = true;

      console.log(
        `Share email sent successfully to ${targetUser.email}`
      );

      console.log(
        `Shared item direct URL: ${openUrl}`
      );
    } catch (emailError) {
      console.error(
        "Share created, but notification email failed:",
        emailError
      );
    }

    // --------------------------------------------------
    // RESPONSE
    // --------------------------------------------------

    return res.status(201).json({
      message: "Item shared successfully",

      emailSent,

      openUrl,

      share: {
        id: share.id,

        sharedWith: {
          id: targetUser.id,
          name: targetUser.name,
          email: targetUser.email,
        },

        fileId: share.file_id,

        folderId: share.folder_id,

        permission: share.permission,

        createdAt: share.created_at,
      },
    });
  } catch (error) {
    console.error(
      "Create share error:",
      error
    );

    return res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unable to share item",
      },
    });
  }
};

// ======================================================
// GET SHARED WITH ME
// ======================================================

const getSharedWithMe = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: shares, error } = await supabase
      .from("shares")
      .select(`
        id,
        owner_id,
        shared_with_id,
        file_id,
        folder_id,
        permission,
        created_at
      `)
      .eq("shared_with_id", userId)
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      throw error;
    }

    const sharedItems = [];

    for (const share of shares) {
      // ----------------------------------------------
      // SHARED FILE
      // ----------------------------------------------

      if (share.file_id) {
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
            owner_id,
            folder_id,
            is_deleted,
            created_at,
            updated_at
            `
          )
          .eq("id", share.file_id)
          .single();

        if (
          !fileError &&
          file &&
          !file.is_deleted
        ) {
          sharedItems.push({
            shareId:
              share.id,

            resourceType:
              "file",

            permission:
              share.permission,

            sharedAt:
              share.created_at,

            item: {
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

              createdAt:
                file.created_at,

              updatedAt:
                file.updated_at,
            },
          });
        }
      }

      // ----------------------------------------------
      // SHARED FOLDER
      // ----------------------------------------------

      if (share.folder_id) {
        const {
          data: folder,
          error: folderError,
        } = await supabase
          .from("folders")
          .select(
            `
            id,
            name,
            owner_id,
            parent_id,
            is_deleted,
            created_at,
            updated_at
            `
          )
          .eq("id", share.folder_id)
          .single();

        if (
          !folderError &&
          folder &&
          !folder.is_deleted
        ) {
          sharedItems.push({
            shareId:
              share.id,

            resourceType:
              "folder",

            permission:
              share.permission,

            sharedAt:
              share.created_at,

            item: {
              id:
                folder.id,

              name:
                folder.name,

              ownerId:
                folder.owner_id,

              parentId:
                folder.parent_id,

              createdAt:
                folder.created_at,

              updatedAt:
                folder.updated_at,
            },
          });
        }
      }
    }

    return res.status(200).json({
      items: sharedItems,
    });
  } catch (error) {
    console.error(
      "Get shared with me error:",
      error
    );

    return res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message:
          "Unable to fetch shared items",
      },
    });
  }
};

// ======================================================
// GET SHARES FOR ITEM
// ======================================================

const getSharesForItem = async (req, res) => {
  try {
    const ownerId =
      req.user.id;

    const {
      fileId,
      folderId,
    } = req.query;

    if (
      !fileId &&
      !folderId
    ) {
      return res.status(400).json({
        error: {
          code:
            "VALIDATION_ERROR",

          message:
            "fileId or folderId is required",
        },
      });
    }

    if (
      fileId &&
      folderId
    ) {
      return res.status(400).json({
        error: {
          code:
            "VALIDATION_ERROR",

          message:
            "Provide either fileId or folderId, not both",
        },
      });
    }

    // --------------------------------------------------
    // VERIFY FILE OWNER
    // --------------------------------------------------

    if (fileId) {
      const {
        data: file,
        error: fileError,
      } = await supabase
        .from("files")
        .select(
          "id, owner_id"
        )
        .eq(
          "id",
          fileId
        )
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
              "Only the owner can view sharing details",
          },
        });
      }
    }

    // --------------------------------------------------
    // VERIFY FOLDER OWNER
    // --------------------------------------------------

    if (folderId) {
      const {
        data: folder,
        error: folderError,
      } = await supabase
        .from("folders")
        .select(
          "id, owner_id"
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
        return res.status(404).json({
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
        return res.status(403).json({
          error: {
            code:
              "FORBIDDEN",

            message:
              "Only the owner can view sharing details",
          },
        });
      }
    }

    // --------------------------------------------------
    // GET SHARES
    // --------------------------------------------------

    let query =
      supabase
        .from("shares")
        .select(
          `
          id,
          shared_with_id,
          permission,
          file_id,
          folder_id,
          created_at
          `
        )
        .eq(
          "owner_id",
          ownerId
        );

    if (fileId) {
      query =
        query.eq(
          "file_id",
          fileId
        );
    } else {
      query =
        query.eq(
          "folder_id",
          folderId
        );
    }

    const {
      data: shares,
      error,
    } = await query;

    if (error) {
      throw error;
    }

    const results = [];

    for (
      const share
      of shares
    ) {
      const {
        data: user,
        error: userError,
      } = await supabase
        .from("users")
        .select(
          "id, name, email"
        )
        .eq(
          "id",
          share.shared_with_id
        )
        .single();

      if (
        !userError &&
        user
      ) {
        results.push({
          id:
            share.id,

          user,

          permission:
            share.permission,

          createdAt:
            share.created_at,
        });
      }
    }

    return res.status(200).json({
      shares:
        results,
    });
  } catch (error) {
    console.error(
      "Get shares error:",
      error
    );

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to fetch sharing details",
      },
    });
  }
};

// ======================================================
// UPDATE SHARE PERMISSION
// ======================================================

const updateSharePermission = async (req, res) => {
  try {
    const ownerId =
      req.user.id;

    const shareId =
      req.params.id;

    const {
      permission,
    } = req.body;

    if (
      ![
        "viewer",
        "editor",
      ].includes(
        permission
      )
    ) {
      return res.status(400).json({
        error: {
          code:
            "INVALID_PERMISSION",

          message:
            "Permission must be viewer or editor",
        },
      });
    }

    const {
      data: share,
      error: shareError,
    } = await supabase
      .from("shares")
      .select("*")
      .eq(
        "id",
        shareId
      )
      .single();

    if (
      shareError ||
      !share
    ) {
      return res.status(404).json({
        error: {
          code:
            "SHARE_NOT_FOUND",

          message:
            "Share not found",
        },
      });
    }

    if (
      share.owner_id !==
      ownerId
    ) {
      return res.status(403).json({
        error: {
          code:
            "FORBIDDEN",

          message:
            "Only the owner can change permissions",
        },
      });
    }

    const {
      data:
        updatedShare,
      error,
    } = await supabase
      .from("shares")
      .update({
        permission,
      })
      .eq(
        "id",
        shareId
      )
      .select(
        `
        id,
        shared_with_id,
        file_id,
        folder_id,
        permission,
        created_at
        `
      )
      .single();

    if (error) {
      throw error;
    }

    return res.status(200).json({
      message:
        "Permission updated successfully",

      share:
        updatedShare,
    });
  } catch (error) {
    console.error(
      "Update share permission error:",
      error
    );

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to update permission",
      },
    });
  }
};

// ======================================================
// REVOKE SHARE
// ======================================================

const revokeShare = async (req, res) => {
  try {
    const ownerId =
      req.user.id;

    const shareId =
      req.params.id;

    const {
      data: share,
      error: shareError,
    } = await supabase
      .from("shares")
      .select(
        "id, owner_id"
      )
      .eq(
        "id",
        shareId
      )
      .single();

    if (
      shareError ||
      !share
    ) {
      return res.status(404).json({
        error: {
          code:
            "SHARE_NOT_FOUND",

          message:
            "Share not found",
        },
      });
    }

    if (
      share.owner_id !==
      ownerId
    ) {
      return res.status(403).json({
        error: {
          code:
            "FORBIDDEN",

          message:
            "Only the owner can revoke access",
        },
      });
    }

    const {
      error,
    } = await supabase
      .from("shares")
      .delete()
      .eq(
        "id",
        shareId
      );

    if (error) {
      throw error;
    }

    return res.status(200).json({
      message:
        "Share revoked successfully",
    });
  } catch (error) {
    console.error(
      "Revoke share error:",
      error
    );

    return res.status(500).json({
      error: {
        code:
          "INTERNAL_SERVER_ERROR",

        message:
          "Unable to revoke share",
      },
    });
  }
};

// ======================================================
// EXPORTS
// ======================================================

module.exports = {
  createShare,
  getSharedWithMe,
  getSharesForItem,
  updateSharePermission,
  revokeShare,
};