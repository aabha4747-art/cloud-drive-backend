const supabase = require("../config/supabase");

// ======================================================
// STAR / UNSTAR FILE
// ======================================================

const toggleFileStar = async (req, res) => {
  try {
    const userId = req.user.id;
    const fileId = req.params.id;

    const { data: file, error: fileError } = await supabase
      .from("files")
      .select("id, owner_id, is_deleted, is_starred")
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

    if (file.owner_id !== userId) {
      return res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "You can only star your own files",
        },
      });
    }

    if (file.is_deleted) {
      return res.status(400).json({
        error: {
          code: "FILE_DELETED",
          message: "Deleted files cannot be starred",
        },
      });
    }

    const newStarValue = !file.is_starred;

    const { data: updatedFile, error } = await supabase
      .from("files")
      .update({
        is_starred: newStarValue,
        updated_at: new Date().toISOString(),
      })
      .eq("id", fileId)
      .select("id, name, is_starred")
      .single();

    if (error) {
      throw error;
    }

    return res.status(200).json({
      message: newStarValue
        ? "File starred successfully"
        : "File unstarred successfully",
      file: {
        id: updatedFile.id,
        name: updatedFile.name,
        isStarred: updatedFile.is_starred,
      },
    });
  } catch (error) {
    console.error("Toggle file star error:", error);

    return res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unable to update file star status",
      },
    });
  }
};

// ======================================================
// STAR / UNSTAR FOLDER
// ======================================================

const toggleFolderStar = async (req, res) => {
  try {
    const userId = req.user.id;
    const folderId = req.params.id;

    const { data: folder, error: folderError } = await supabase
      .from("folders")
      .select("id, owner_id, is_deleted, is_starred")
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

    if (folder.owner_id !== userId) {
      return res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "You can only star your own folders",
        },
      });
    }

    if (folder.is_deleted) {
      return res.status(400).json({
        error: {
          code: "FOLDER_DELETED",
          message: "Deleted folders cannot be starred",
        },
      });
    }

    const newStarValue = !folder.is_starred;

    const { data: updatedFolder, error } = await supabase
      .from("folders")
      .update({
        is_starred: newStarValue,
        updated_at: new Date().toISOString(),
      })
      .eq("id", folderId)
      .select("id, name, is_starred")
      .single();

    if (error) {
      throw error;
    }

    return res.status(200).json({
      message: newStarValue
        ? "Folder starred successfully"
        : "Folder unstarred successfully",
      folder: {
        id: updatedFolder.id,
        name: updatedFolder.name,
        isStarred: updatedFolder.is_starred,
      },
    });
  } catch (error) {
    console.error("Toggle folder star error:", error);

    return res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unable to update folder star status",
      },
    });
  }
};

// ======================================================
// GET STARRED ITEMS
// ======================================================

const getStarredItems = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: files, error: filesError } = await supabase
      .from("files")
      .select(
        "id, name, mime_type, size_bytes, folder_id, created_at, updated_at, is_starred"
      )
      .eq("owner_id", userId)
      .eq("is_deleted", false)
      .eq("is_starred", true)
      .order("updated_at", { ascending: false });

    if (filesError) {
      throw filesError;
    }

    const { data: folders, error: foldersError } = await supabase
      .from("folders")
      .select(
        "id, name, parent_id, created_at, updated_at, is_starred"
      )
      .eq("owner_id", userId)
      .eq("is_deleted", false)
      .eq("is_starred", true)
      .order("updated_at", { ascending: false });

    if (foldersError) {
      throw foldersError;
    }

    return res.status(200).json({
      files: files.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mime_type,
        sizeBytes: file.size_bytes,
        folderId: file.folder_id,
        createdAt: file.created_at,
        updatedAt: file.updated_at,
        isStarred: file.is_starred,
      })),

      folders: folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parent_id,
        createdAt: folder.created_at,
        updatedAt: folder.updated_at,
        isStarred: folder.is_starred,
      })),
    });
  } catch (error) {
    console.error("Get starred items error:", error);

    return res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unable to fetch starred items",
      },
    });
  }
};

module.exports = {
  toggleFileStar,
  toggleFolderStar,
  getStarredItems,
};