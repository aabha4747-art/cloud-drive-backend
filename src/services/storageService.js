const path = require("path");
const crypto = require("crypto");

const supabase = require("../config/supabase");

const bucketName = process.env.SUPABASE_STORAGE_BUCKET;

const sanitizeFileName = (fileName) => {
  return fileName
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-");
};

const buildStoragePath = ({ ownerId, folderId, originalName }) => {
  const extension = path.extname(originalName);
  const baseName = path.basename(originalName, extension);

  const safeBaseName = sanitizeFileName(baseName);
  const uniqueId = crypto.randomUUID();

  const folderPart = folderId || "root";

  return `users/${ownerId}/folders/${folderPart}/${uniqueId}-${safeBaseName}${extension}`;
};

const uploadFileToStorage = async ({
  buffer,
  storagePath,
  mimeType,
}) => {
  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    throw error;
  }

  return data;
};

const createSignedDownloadUrl = async (
  storagePath,
  expiresInSeconds = 300
) => {
  const { data, error } = await supabase.storage
    .from(bucketName)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error) {
    throw error;
  }

  return data.signedUrl;
};

const deleteFileFromStorage = async (storagePath) => {
  const { error } = await supabase.storage
    .from(bucketName)
    .remove([storagePath]);

  if (error) {
    throw error;
  }
};

module.exports = {
  buildStoragePath,
  uploadFileToStorage,
  createSignedDownloadUrl,
  deleteFileFromStorage,
};