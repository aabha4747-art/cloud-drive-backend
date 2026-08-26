const {
  GoogleGenAI,
} = require(
  "@google/genai"
);

const supabase =
  require(
    "../config/supabase"
  );

// ======================================================
// GEMINI CLIENT
// ======================================================

const ai =
  new GoogleGenAI({
    apiKey:
      process.env
        .GEMINI_API_KEY,
  });

// ======================================================
// NORMALIZE ITEMS
// ======================================================

const normalizeItems =
  (items) => {
    if (
      !Array.isArray(
        items
      )
    ) {
      return [];
    }

    return items
      .filter(
        (item) =>
          item &&
          item.id &&
          item.resourceType
      )
      .map(
        (item) => ({
          id:
            item.id,

          resourceType:
            item.resourceType,
        })
      );
  };

// ======================================================
// GET FILE CONTEXT
// ======================================================

const getFileContext =
  async (
    fileId,
    ownerId
  ) => {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "files"
        )
        .select(
          `
          id,
          name,
          mime_type,
          file_kind,
          size_bytes,
          folder_id,
          created_at,
          updated_at
          `
        )
        .eq(
          "id",
          fileId
        )
        .eq(
          "owner_id",
          ownerId
        )
        .eq(
          "is_deleted",
          false
        )
        .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return {
      resourceType:
        "file",

      id:
        data.id,

      name:
        data.name,

      mimeType:
        data.mime_type,

      fileKind:
        data.file_kind,

      sizeBytes:
        data.size_bytes,

      folderId:
        data.folder_id,

      createdAt:
        data.created_at,

      updatedAt:
        data.updated_at,
    };
  };

// ======================================================
// GET FOLDER CONTEXT
// ======================================================

const getFolderContext =
  async (
    folderId,
    ownerId
  ) => {
    const {
      data:
        folder,
      error:
        folderError,
    } =
      await supabase
        .from(
          "folders"
        )
        .select(
          `
          id,
          name,
          parent_id,
          created_at,
          updated_at
          `
        )
        .eq(
          "id",
          folderId
        )
        .eq(
          "owner_id",
          ownerId
        )
        .eq(
          "is_deleted",
          false
        )
        .maybeSingle();

    if (
      folderError
    ) {
      throw folderError;
    }

    if (!folder) {
      return null;
    }

    const {
      data:
        childFiles,
      error:
        filesError,
    } =
      await supabase
        .from(
          "files"
        )
        .select(
          `
          id,
          name,
          mime_type,
          file_kind,
          size_bytes,
          created_at,
          updated_at
          `
        )
        .eq(
          "folder_id",
          folderId
        )
        .eq(
          "owner_id",
          ownerId
        )
        .eq(
          "is_deleted",
          false
        )
        .order(
          "name",
          {
            ascending:
              true,
          }
        )
        .limit(
          100
        );

    if (
      filesError
    ) {
      throw filesError;
    }

    const {
      data:
        childFolders,
      error:
        foldersError,
    } =
      await supabase
        .from(
          "folders"
        )
        .select(
          `
          id,
          name,
          created_at,
          updated_at
          `
        )
        .eq(
          "parent_id",
          folderId
        )
        .eq(
          "owner_id",
          ownerId
        )
        .eq(
          "is_deleted",
          false
        )
        .order(
          "name",
          {
            ascending:
              true,
          }
        )
        .limit(
          100
        );

    if (
      foldersError
    ) {
      throw foldersError;
    }

    return {
      resourceType:
        "folder",

      id:
        folder.id,

      name:
        folder.name,

      parentId:
        folder.parent_id,

      createdAt:
        folder.created_at,

      updatedAt:
        folder.updated_at,

      childFolders:
        childFolders ||
        [],

      files:
        childFiles ||
        [],
    };
  };

// ======================================================
// ASK GEMINI
// ======================================================

const askGemini =
  async (
    req,
    res
  ) => {
    try {
      if (
        !process.env
          .GEMINI_API_KEY
      ) {
        return res
          .status(500)
          .json({
            error: {
              code:
                "GEMINI_NOT_CONFIGURED",

              message:
                "Gemini API key is not configured.",
            },
          });
      }

      const ownerId =
        req.user.id;

      const {
        question,
        items,
      } = req.body;

      const cleanQuestion =
        question
          ?.trim();

      if (
        !cleanQuestion
      ) {
        return res
          .status(400)
          .json({
            error: {
              code:
                "VALIDATION_ERROR",

              message:
                "Question is required.",
            },
          });
      }

      const normalizedItems =
        normalizeItems(
          items
        );

      if (
        normalizedItems.length ===
        0
      ) {
        return res
          .status(400)
          .json({
            error: {
              code:
                "VALIDATION_ERROR",

              message:
                "Select at least one file or folder.",
            },
          });
      }

      if (
        normalizedItems.length >
        25
      ) {
        return res
          .status(400)
          .json({
            error: {
              code:
                "TOO_MANY_ITEMS",

              message:
                "You can ask Gemini about up to 25 selected items at once.",
            },
          });
      }

      const contextItems =
        [];

      for (
        const item of
        normalizedItems
      ) {
        if (
          item.resourceType ===
          "folder"
        ) {
          const folderContext =
            await getFolderContext(
              item.id,
              ownerId
            );

          if (
            folderContext
          ) {
            contextItems.push(
              folderContext
            );
          }
        } else {
          const fileContext =
            await getFileContext(
              item.id,
              ownerId
            );

          if (
            fileContext
          ) {
            contextItems.push(
              fileContext
            );
          }
        }
      }

      if (
        contextItems.length ===
        0
      ) {
        return res
          .status(404)
          .json({
            error: {
              code:
                "NO_ACCESSIBLE_ITEMS",

              message:
                "None of the selected items could be accessed.",
            },
          });
      }

      const prompt = `
You are an AI assistant inside a cloud drive application.

The user selected the following drive items.

SELECTED ITEMS:
${JSON.stringify(
  contextItems,
  null,
  2
)}

USER QUESTION:
${cleanQuestion}

Instructions:
- Answer only from the supplied selected-item context.
- Do not invent file contents that are not present.
- If the user asks about information that is not available in the supplied metadata or folder listing, clearly say so.
- Mention relevant file and folder names when useful.
- Keep the answer concise and practical.
`;

      const response =
        await ai.models
          .generateContent({
            model:
              "gemini-3.6-flash",

            contents:
              prompt,
          });

      const answer =
        response.text?.trim();

      if (
        !answer
      ) {
        throw new Error(
          "Gemini returned an empty response."
        );
      }

      return res
        .status(200)
        .json({
          answer,

          selectedCount:
            contextItems.length,

          model:
            "gemini-2.5-flash",
        });
    } catch (err) {
      console.error(
        "Gemini request error:",
        err
      );

      return res
        .status(500)
        .json({
          error: {
            code:
              "GEMINI_REQUEST_FAILED",

            message:
              err.message ||
              "Unable to get a response from Gemini.",
          },
        });
    }
  };

// ======================================================
// EXPORTS
// ======================================================

module.exports = {
  askGemini,
};