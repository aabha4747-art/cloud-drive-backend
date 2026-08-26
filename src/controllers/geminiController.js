const {
  GoogleGenAI,
} = require("@google/genai");

const pool =
  require(
    "../config/db"
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
// HELPERS
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
    const result =
      await pool.query(
        `
        SELECT
          id,
          name,
          mime_type,
          file_kind,
          size_bytes,
          folder_id,
          created_at,
          updated_at
        FROM files
        WHERE id = $1
          AND owner_id = $2
          AND deleted_at IS NULL
        LIMIT 1
        `,
        [
          fileId,
          ownerId,
        ]
      );

    if (
      result.rows.length ===
      0
    ) {
      return null;
    }

    const file =
      result.rows[0];

    return {
      resourceType:
        "file",

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

      folderId:
        file.folder_id,

      createdAt:
        file.created_at,

      updatedAt:
        file.updated_at,
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
    const folderResult =
      await pool.query(
        `
        SELECT
          id,
          name,
          parent_id,
          created_at,
          updated_at
        FROM folders
        WHERE id = $1
          AND owner_id = $2
          AND deleted_at IS NULL
        LIMIT 1
        `,
        [
          folderId,
          ownerId,
        ]
      );

    if (
      folderResult.rows
        .length === 0
    ) {
      return null;
    }

    const folder =
      folderResult.rows[0];

    const filesResult =
      await pool.query(
        `
        SELECT
          id,
          name,
          mime_type,
          file_kind,
          size_bytes,
          created_at,
          updated_at
        FROM files
        WHERE folder_id = $1
          AND owner_id = $2
          AND deleted_at IS NULL
        ORDER BY name ASC
        LIMIT 100
        `,
        [
          folderId,
          ownerId,
        ]
      );

    const foldersResult =
      await pool.query(
        `
        SELECT
          id,
          name,
          created_at,
          updated_at
        FROM folders
        WHERE parent_id = $1
          AND owner_id = $2
          AND deleted_at IS NULL
        ORDER BY name ASC
        LIMIT 100
        `,
        [
          folderId,
          ownerId,
        ]
      );

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
        foldersResult.rows,

      files:
        filesResult.rows,
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

      const contextItems = [];

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
- If the user asks about information not available in the context, clearly say that the current integration only has file/folder metadata and folder listings.
- Be concise but useful.
- Mention relevant file or folder names when helpful.
`;

      const response =
        await ai.models
          .generateContent({
            model:
              "gemini-2.5-flash",

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