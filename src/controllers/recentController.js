const supabase = require("../config/supabase");

const getRecentFiles = async (req, res) => {
  try {
    const ownerId = req.user.id;

    const { data: files, error } = await supabase
      .from("files")
      .select(
        "id, name, mime_type, size_bytes, owner_id, folder_id, created_at, updated_at, last_accessed_at"
      )
      .eq("owner_id", ownerId)
      .eq("is_deleted", false)
      .not("last_accessed_at", "is", null)
      .order("last_accessed_at", { ascending: false })
      .limit(20);

    if (error) {
      throw error;
    }

    return res.status(200).json({
      files: files.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mime_type,
        sizeBytes: file.size_bytes,
        ownerId: file.owner_id,
        folderId: file.folder_id,
        createdAt: file.created_at,
        updatedAt: file.updated_at,
        lastAccessedAt: file.last_accessed_at,
      })),
    });
  } catch (error) {
    console.error("Get recent files error:", error);

    return res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unable to fetch recent files",
      },
    });
  }
};

module.exports = {
  getRecentFiles,
};