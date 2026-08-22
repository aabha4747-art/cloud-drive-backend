const supabase = require("../config/supabase");

const searchItems = async (req, res) => {
  try {
    const ownerId = req.user.id;

    const {
      q = "",
      type = "all",
      sortBy = "name",
      order = "asc",
    } = req.query;

    const searchTerm = q.trim();

    const allowedTypes = ["all", "file", "folder"];
    const allowedSortFields = ["name", "created_at", "updated_at"];
    const allowedOrders = ["asc", "desc"];

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        error: {
          code: "INVALID_TYPE",
          message: "type must be all, file, or folder",
        },
      });
    }

    if (!allowedSortFields.includes(sortBy)) {
      return res.status(400).json({
        error: {
          code: "INVALID_SORT_FIELD",
          message: "Invalid sort field",
        },
      });
    }

    if (!allowedOrders.includes(order)) {
      return res.status(400).json({
        error: {
          code: "INVALID_SORT_ORDER",
          message: "order must be asc or desc",
        },
      });
    }

    const ascending = order === "asc";

    let files = [];
    let folders = [];

    if (type === "all" || type === "file") {
      let fileQuery = supabase
        .from("files")
        .select(
          "id, name, mime_type, size_bytes, owner_id, folder_id, created_at, updated_at"
        )
        .eq("owner_id", ownerId)
        .eq("is_deleted", false);

      if (searchTerm) {
        fileQuery = fileQuery.ilike(
          "name",
          `%${searchTerm}%`
        );
      }

      fileQuery = fileQuery.order(sortBy, {
        ascending,
      });

      const { data, error } = await fileQuery;

      if (error) {
        throw error;
      }

      files = data.map((file) => ({
        resourceType: "file",
        id: file.id,
        name: file.name,
        mimeType: file.mime_type,
        sizeBytes: file.size_bytes,
        ownerId: file.owner_id,
        folderId: file.folder_id,
        createdAt: file.created_at,
        updatedAt: file.updated_at,
      }));
    }

    if (type === "all" || type === "folder") {
      let folderQuery = supabase
        .from("folders")
        .select(
          "id, name, owner_id, parent_id, created_at, updated_at"
        )
        .eq("owner_id", ownerId)
        .eq("is_deleted", false);

      if (searchTerm) {
        folderQuery = folderQuery.ilike(
          "name",
          `%${searchTerm}%`
        );
      }

      folderQuery = folderQuery.order(sortBy, {
        ascending,
      });

      const { data, error } = await folderQuery;

      if (error) {
        throw error;
      }

      folders = data.map((folder) => ({
        resourceType: "folder",
        id: folder.id,
        name: folder.name,
        ownerId: folder.owner_id,
        parentId: folder.parent_id,
        createdAt: folder.created_at,
        updatedAt: folder.updated_at,
      }));
    }

    return res.status(200).json({
      query: searchTerm,
      total: files.length + folders.length,
      files,
      folders,
    });
  } catch (error) {
    console.error("Search error:", error);

    return res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unable to search items",
      },
    });
  }
};

module.exports = {
  searchItems,
};