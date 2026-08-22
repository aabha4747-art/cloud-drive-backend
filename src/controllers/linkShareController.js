const crypto = require("crypto");
const supabase = require("../config/supabase");

const {
  createSignedDownloadUrl,
} = require("../services/storageService");


// ======================================================
// CREATE PUBLIC SHARE LINK
// POST /api/links
// ======================================================

const createShareLink = async (req, res) => {
  try {
    const ownerId = req.user.id;

    const {
      fileId = null,
      folderId = null,
      expiresAt = null,
    } = req.body;

    // Exactly one item must be provided
    if (
      (!fileId && !folderId) ||
      (fileId && folderId)
    ) {
      return res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message:
            "Provide exactly one of fileId or folderId",
        },
      });
    }

    // ==================================================
    // CHECK FILE OWNERSHIP
    // ==================================================

    if (fileId) {
      const { data: file, error: fileError } =
        await supabase
          .from("files")
          .select("id, name, owner_id, is_deleted")
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
            message:
              "You can only create links for files you own",
          },
        });
      }

      if (file.is_deleted) {
        return res.status(400).json({
          error: {
            code: "FILE_DELETED",
            message:
              "Deleted files cannot be shared publicly",
          },
        });
      }
    }

    // ==================================================
    // CHECK FOLDER OWNERSHIP
    // ==================================================

    if (folderId) {
      const { data: folder, error: folderError } =
        await supabase
          .from("folders")
          .select("id, name, owner_id, is_deleted")
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
            message:
              "You can only create links for folders you own",
          },
        });
      }

      if (folder.is_deleted) {
        return res.status(400).json({
          error: {
            code: "FOLDER_DELETED",
            message:
              "Deleted folders cannot be shared publicly",
          },
        });
      }
    }

    // ==================================================
    // VALIDATE EXPIRATION
    // ==================================================

    let expiration = null;

    if (expiresAt) {
      expiration = new Date(expiresAt);

      if (Number.isNaN(expiration.getTime())) {
        return res.status(400).json({
          error: {
            code: "INVALID_EXPIRATION",
            message:
              "expiresAt must be a valid date",
          },
        });
      }

      if (expiration <= new Date()) {
        return res.status(400).json({
          error: {
            code: "INVALID_EXPIRATION",
            message:
              "Expiration date must be in the future",
          },
        });
      }
    }

    // Generate secure public token
    const token = crypto
      .randomBytes(32)
      .toString("hex");

    // ==================================================
    // SAVE LINK
    // ==================================================

    const { data: link, error } = await supabase
      .from("link_shares")
      .insert({
        owner_id: ownerId,
        file_id: fileId,
        folder_id: folderId,
        token,
        expires_at: expiration
          ? expiration.toISOString()
          : null,
      })
      .select(
        "id, owner_id, file_id, folder_id, token, expires_at, is_active, created_at"
      )
      .single();

    if (error) {
      throw error;
    }

    return res.status(201).json({
      message:
        "Public share link created successfully",

      link: {
        id: link.id,
        token: link.token,
        fileId: link.file_id,
        folderId: link.folder_id,
        expiresAt: link.expires_at,
        isActive: link.is_active,
        createdAt: link.created_at,

        publicUrl: `${req.protocol}://${req.get(
          "host"
        )}/api/links/public/${link.token}`,
      },
    });
  } catch (error) {
    console.error(
      "Create public link error:",
      error
    );

    return res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message:
          "Unable to create public share link",
      },
    });
  }
};


// ======================================================
// GET PUBLIC SHARE
// NO LOGIN REQUIRED
// GET /api/links/public/:token
// ======================================================

const getPublicShare = async (req, res) => {
  try {
    const { token } = req.params;

    const { data: link, error: linkError } =
      await supabase
        .from("link_shares")
        .select(
          "id, file_id, folder_id, expires_at, is_active"
        )
        .eq("token", token)
        .maybeSingle();

    if (linkError) {
      throw linkError;
    }

    if (!link || !link.is_active) {
      return res.status(404).json({
        error: {
          code: "LINK_NOT_FOUND",
          message:
            "Share link is invalid or disabled",
        },
      });
    }

    // Expiration check
    if (
      link.expires_at &&
      new Date(link.expires_at) <= new Date()
    ) {
      return res.status(410).json({
        error: {
          code: "LINK_EXPIRED",
          message:
            "This share link has expired",
        },
      });
    }

    // ==================================================
    // PUBLIC FILE
    // ==================================================

    if (link.file_id) {
      const { data: file, error: fileError } =
        await supabase
          .from("files")
          .select(
            "id, name, mime_type, size_bytes, storage_path, is_deleted, created_at, updated_at"
          )
          .eq("id", link.file_id)
          .single();

      if (
        fileError ||
        !file ||
        file.is_deleted
      ) {
        return res.status(404).json({
          error: {
            code: "FILE_NOT_FOUND",
            message:
              "Shared file no longer exists",
          },
        });
      }

      const signedUrl =
        await createSignedDownloadUrl(
          file.storage_path,
          300
        );

      return res.status(200).json({
        resourceType: "file",

        file: {
          id: file.id,
          name: file.name,
          mimeType: file.mime_type,
          sizeBytes: file.size_bytes,
          createdAt: file.created_at,
          updatedAt: file.updated_at,
        },

        signedUrl,

        expiresIn: 300,
      });
    }

    // ==================================================
    // PUBLIC FOLDER
    // ==================================================

    const { data: folder, error: folderError } =
      await supabase
        .from("folders")
        .select(
          "id, name, parent_id, is_deleted, created_at, updated_at"
        )
        .eq("id", link.folder_id)
        .single();

    if (
      folderError ||
      !folder ||
      folder.is_deleted
    ) {
      return res.status(404).json({
        error: {
          code: "FOLDER_NOT_FOUND",
          message:
            "Shared folder no longer exists",
        },
      });
    }

    return res.status(200).json({
      resourceType: "folder",

      folder: {
        id: folder.id,
        name: folder.name,
        parentId: folder.parent_id,
        createdAt: folder.created_at,
        updatedAt: folder.updated_at,
      },
    });
  } catch (error) {
    console.error(
      "Get public link error:",
      error
    );

    return res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message:
          "Unable to access public share link",
      },
    });
  }
};


// ======================================================
// REVOKE PUBLIC LINK
// DELETE /api/links/:id
// ======================================================

const revokeShareLink = async (req, res) => {
  try {
    const ownerId = req.user.id;
    const linkId = req.params.id;

    const { data: link, error: linkError } =
      await supabase
        .from("link_shares")
        .select("id, owner_id, is_active")
        .eq("id", linkId)
        .single();

    if (linkError || !link) {
      return res.status(404).json({
        error: {
          code: "LINK_NOT_FOUND",
          message: "Share link not found",
        },
      });
    }

    if (link.owner_id !== ownerId) {
      return res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message:
            "Only the owner can revoke this link",
        },
      });
    }

    const { error } = await supabase
      .from("link_shares")
      .update({
        is_active: false,
      })
      .eq("id", linkId);

    if (error) {
      throw error;
    }

    return res.status(200).json({
      message:
        "Public share link revoked successfully",
    });
  } catch (error) {
    console.error(
      "Revoke public link error:",
      error
    );

    return res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message:
          "Unable to revoke public share link",
      },
    });
  }
};


module.exports = {
  createShareLink,
  getPublicShare,
  revokeShareLink,
};