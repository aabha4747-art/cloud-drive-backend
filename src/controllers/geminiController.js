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
// CONFIG
// ======================================================

const bucketName =
  process.env
    .SUPABASE_STORAGE_BUCKET;

const MAX_TEXT_FILE_BYTES =
  2 * 1024 * 1024; // 2 MB

const MAX_TEXT_CHARS =
  100000;

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
// CHECK WHETHER FILE CAN BE READ AS TEXT
// ======================================================

const isReadableTextFile =
  (file) => {
    const mimeType =
      (
        file.mime_type ||
        ""
      ).toLowerCase();

    const name =
      (
        file.name ||
        ""
      ).toLowerCase();

    return (
      mimeType ===
        "text/plain" ||
      name.endsWith(
        ".txt"
      )
    );
  };

// ======================================================
// READ FILE CONTENT FROM SUPABASE STORAGE
// ======================================================

const readTextFileContent =
  async (file) => {
    if (
      !bucketName
    ) {
      return {
        available:
          false,

        reason:
          "Storage bucket is not configured.",
      };
    }

    if (
      !file.storage_path
    ) {
      return {
        available:
          false,

        reason:
          "This file does not have a storage path.",
      };
    }

    if (
      file.size_bytes &&
      Number(
        file.size_bytes
      ) >
        MAX_TEXT_FILE_BYTES
    ) {
      return {
        available:
          false,

        reason:
          "The text file is too large for this Gemini request.",
      };
    }

    if (
      !isReadableTextFile(
        file
      )
    ) {
      return {
        available:
          false,

        reason:
          "Actual content extraction is not enabled for this file type yet.",
      };
    }

    try {
      const {
        data,
        error,
      } =
        await supabase
          .storage
          .from(
            bucketName
          )
          .download(
            file.storage_path
          );

      if (error) {
        throw error;
      }

      if (!data) {
        return {
          available:
            false,

          reason:
            "The file could not be downloaded from storage.",
        };
      }

      const arrayBuffer =
        await data.arrayBuffer();

      const buffer =
        Buffer.from(
          arrayBuffer
        );

      let text =
        buffer.toString(
          "utf8"
        );

      text =
        text.replace(
          /\u0000/g,
          ""
        );

      if (
        text.length >
        MAX_TEXT_CHARS
      ) {
        text =
          `${text.slice(
            0,
            MAX_TEXT_CHARS
          )}

[Content truncated because the file is very large.]`;
      }

      return {
        available:
          true,

        text:
          text.trim(),
      };
    } catch (err) {
      console.error(
        "Read text file error:",
        {
          fileId:
            file.id,

          storagePath:
            file.storage_path,

          message:
            err.message,
        }
      );

      return {
        available:
          false,

        reason:
          "The file content could not be read from storage.",
      };
    }
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
          storage_path,
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

    const contentResult =
      await readTextFileContent(
        data
      );

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

      contentAvailable:
        contentResult
          .available,

      content:
        contentResult
          .available
          ? contentResult.text
          : null,

      contentNote:
        contentResult
          .available
          ? null
          : contentResult.reason,
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

    // ==================================================
    // CHILD FILES
    // ==================================================

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
          storage_path,
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

    // ==================================================
    // CHILD FOLDERS
    // ==================================================

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

    // ==================================================
    // READ TXT CONTENT FOR FILES INSIDE FOLDER
    // ==================================================

    const enhancedFiles =
      [];

    for (
      const file of
      childFiles || []
    ) {
      const contentResult =
        await readTextFileContent(
          file
        );

      enhancedFiles.push({
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

        createdAt:
          file.created_at,

        updatedAt:
          file.updated_at,

        contentAvailable:
          contentResult
            .available,

        content:
          contentResult
            .available
            ? contentResult.text
            : null,

        contentNote:
          contentResult
            .available
            ? null
            : contentResult.reason,
      });
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
        enhancedFiles,
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
      // ==================================================
      // CONFIG CHECK
      // ==================================================

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

      // ==================================================
      // USER
      // ==================================================

      const ownerId =
        req.user.id;

      // ==================================================
      // REQUEST BODY
      // ==================================================

      const {
        question,
        items,
      } = req.body;

      const cleanQuestion =
        question
          ?.trim();

      // ==================================================
      // VALIDATE QUESTION
      // ==================================================

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

      // ==================================================
      // NORMALIZE ITEMS
      // ==================================================

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

      // ==================================================
      // BUILD CONTEXT
      // ==================================================

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

      // ==================================================
      // NOTHING ACCESSIBLE
      // ==================================================

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

      // ==================================================
      // GEMINI PROMPT
      // ==================================================

      const prompt = `
You are an AI assistant inside a cloud drive application.

The user selected files and/or folders from their own cloud drive.

The supplied JSON can contain:

- file metadata
- folder metadata
- folder listings
- actual text content when contentAvailable is true

SELECTED ITEMS:

${JSON.stringify(
  contextItems,
  null,
  2
)}

USER QUESTION:

${cleanQuestion}

Instructions:

1. Use actual file content whenever "contentAvailable" is true.

2. If actual content is available, answer questions about that content normally.

3. If "contentAvailable" is false, do not pretend that you know what is inside that file.

4. If content is unavailable for a file, explain that the file type is not supported for content extraction yet only when that limitation matters to the user's question.

5. When multiple files are selected, clearly distinguish which information came from which file.

6. For summaries, summarize actual content rather than merely listing metadata whenever content is available.

7. For comparisons, compare the actual supplied contents whenever possible.

8. For action-item requests, extract concrete tasks, deadlines, responsibilities, or next steps found in the supplied content.

9. Never invent information that is not present.

10. Keep answers clear, useful, and reasonably concise.
`;

      // ==================================================
      // CALL GEMINI
      // ==================================================

      const response =
        await ai.models
          .generateContent({
            model:
              "gemini-3.6-flash",

            contents:
              prompt,
          });

      // ==================================================
      // ANSWER
      // ==================================================

      const answer =
        response.text
          ?.trim();

      if (
        !answer
      ) {
        throw new Error(
          "Gemini returned an empty response."
        );
      }

      // ==================================================
      // SUCCESS
      // ==================================================

      return res
        .status(200)
        .json({
          answer,

          selectedCount:
            contextItems.length,

          model:
            "gemini-3.6-flash",
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