import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  FileText,
  Folder,
  Loader2,
  Star,
} from "lucide-react";

import api from "../api/axios";

function StarredPage() {
  const navigate = useNavigate();

  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // ======================================================
  // FORMAT FILE SIZE
  // ======================================================

  const formatFileSize = (bytes) => {
    if (bytes === null || bytes === undefined) {
      return "";
    }

    if (bytes === 0) {
      return "0 B";
    }

    const units = ["B", "KB", "MB", "GB"];

    const index = Math.min(
      Math.floor(
        Math.log(bytes) / Math.log(1024)
      ),
      units.length - 1
    );

    const value =
      bytes / Math.pow(1024, index);

    return `${value.toFixed(
      index === 0 ? 0 : 1
    )} ${units[index]}`;
  };

  // ======================================================
  // FETCH STARRED ITEMS
  // ======================================================

  const fetchStarredItems =
    useCallback(async () => {
      try {
        setLoading(true);
        setError("");

        const response = await api.get(
          "/starred"
        );

        setFiles(
          response.data.files || []
        );

        setFolders(
          response.data.folders || []
        );
      } catch (err) {
        console.error(
          "Unable to fetch starred items:",
          err
        );

        if (
          err.response?.status === 401
        ) {
          localStorage.removeItem(
            "token"
          );

          localStorage.removeItem(
            "user"
          );

          navigate("/login");

          return;
        }

        setError(
          err.response?.data?.error
            ?.message ||
            err.response?.data
              ?.message ||
            "Unable to load starred items."
        );
      } finally {
        setLoading(false);
      }
    }, [navigate]);

  useEffect(() => {
    fetchStarredItems();
  }, [fetchStarredItems]);

  // ======================================================
  // OPEN FOLDER
  // ======================================================

  const handleOpenFolder = (folder) => {
    /*
      For now we return to My Drive.
      Later we can pass folder state/URL params
      so Dashboard opens the exact folder directly.
    */

    navigate("/dashboard");
  };

  // ======================================================
  // OPEN FILE
  // ======================================================

  const handleOpenFile = async (file) => {
    try {
      setError("");
      setMessage("");

      const response = await api.get(
        `/files/${file.id}`
      );

      const fileUrl =
        response.data.downloadUrl ||
        response.data.signedUrl ||
        response.data.url ||
        response.data.file
          ?.downloadUrl ||
        response.data.file
          ?.signedUrl ||
        response.data.file?.url;

      if (!fileUrl) {
        throw new Error(
          "Download URL not returned by backend"
        );
      }

      window.open(
        fileUrl,
        "_blank",
        "noopener,noreferrer"
      );
    } catch (err) {
      console.error(
        "Open file error:",
        err
      );

      setError(
        err.response?.data?.error
          ?.message ||
          err.response?.data
            ?.message ||
          err.message ||
          "Unable to open file."
      );
    }
  };

  // ======================================================
  // UNSTAR FILE
  // ======================================================

  const handleUnstarFile = async (
    file
  ) => {
    try {
      setError("");
      setMessage("");

      await api.patch(
        `/starred/files/${file.id}`
      );

      setFiles((currentFiles) =>
        currentFiles.filter(
          (item) =>
            item.id !== file.id
        )
      );

      setMessage(
        `"${file.name}" removed from Starred.`
      );
    } catch (err) {
      console.error(
        "Unstar file error:",
        err
      );

      setError(
        err.response?.data?.error
          ?.message ||
          err.response?.data
            ?.message ||
          "Unable to unstar file."
      );
    }
  };

  // ======================================================
  // UNSTAR FOLDER
  // ======================================================

  const handleUnstarFolder = async (
    folder
  ) => {
    try {
      setError("");
      setMessage("");

      await api.patch(
        `/starred/folders/${folder.id}`
      );

      setFolders(
        (currentFolders) =>
          currentFolders.filter(
            (item) =>
              item.id !== folder.id
          )
      );

      setMessage(
        `"${folder.name}" removed from Starred.`
      );
    } catch (err) {
      console.error(
        "Unstar folder error:",
        err
      );

      setError(
        err.response?.data?.error
          ?.message ||
          err.response?.data
            ?.message ||
          "Unable to unstar folder."
      );
    }
  };

  // ======================================================
  // EMPTY STATE
  // ======================================================

  const isEmpty =
    !loading &&
    files.length === 0 &&
    folders.length === 0;

  // ======================================================
  // PAGE
  // ======================================================

  return (
    <div className="min-h-screen bg-[#F6F8FC] p-6 lg:p-8">

      <div className="mx-auto max-w-[1600px]">

        {/* ================================================
            PAGE HEADER
           ================================================ */}

        <div className="mb-8 flex items-start gap-4">

          <button
            type="button"
            onClick={() =>
              navigate("/dashboard")
            }
            className="
              mt-1
              flex h-10 w-10
              items-center
              justify-center
              rounded-xl
              text-slate-500
              transition-all
              duration-200
              hover:bg-white
              hover:text-violet-600
              hover:shadow-sm
            "
            title="Back to My Drive"
          >
            <ArrowLeft size={21} />
          </button>

          <div>

            <div className="flex items-center gap-3">

              <h1 className="text-3xl font-bold tracking-tight text-slate-950">
                Starred
              </h1>

              <Star
                size={25}
                className="fill-amber-400 text-amber-400"
              />

            </div>

            <p className="mt-1 text-sm text-slate-500">
              Files and folders you marked as important.
            </p>

          </div>

        </div>

        {/* ================================================
            SUCCESS MESSAGE
           ================================================ */}

        {message && (
          <div className="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-700">
            {message}
          </div>
        )}

        {/* ================================================
            ERROR MESSAGE
           ================================================ */}

        {error && (
          <div className="mb-6 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-medium text-red-600">
            {error}
          </div>
        )}

        {/* ================================================
            LOADING
           ================================================ */}

        {loading && (
          <div className="flex min-h-[420px] items-center justify-center">

            <div className="flex flex-col items-center gap-3 text-slate-400">

              <Loader2
                size={30}
                className="animate-spin text-violet-500"
              />

              <p className="text-sm font-medium">
                Loading starred items...
              </p>

            </div>

          </div>
        )}

        {/* ================================================
            EMPTY STATE
           ================================================ */}

        {isEmpty && (
          <div className="flex min-h-[460px] items-center justify-center">

            <div className="text-center">

              <div
                className="
                  mx-auto
                  flex h-20 w-20
                  items-center
                  justify-center
                  rounded-3xl
                  bg-violet-50
                "
              >
                <Star
                  size={34}
                  className="text-violet-300"
                />
              </div>

              <h2 className="mt-5 text-lg font-semibold text-slate-700">
                Nothing starred yet
              </h2>

              <p className="mt-2 text-sm text-slate-400">
                Star important files and folders to find them quickly here.
              </p>

            </div>

          </div>
        )}

        {/* ================================================
            FOLDERS
           ================================================ */}

        {!loading &&
          folders.length > 0 && (
            <section className="mb-12">

              <div className="mb-5 flex items-center justify-between">

                <h2 className="text-xs font-bold tracking-[0.22em] text-slate-400">
                  FOLDERS
                </h2>

                <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-white px-2 text-xs font-medium text-slate-500 shadow-sm">
                  {folders.length}
                </span>

              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">

                {folders.map(
                  (folder) => (
                    <div
                      key={folder.id}
                      className="
                        group
                        rounded-2xl
                        border
                        border-slate-200/80
                        bg-white
                        p-4
                        shadow-sm
                        transition-all
                        duration-200
                        hover:-translate-y-1
                        hover:border-violet-200
                        hover:shadow-lg
                        hover:shadow-slate-200/50
                      "
                    >

                      <button
                        type="button"
                        onClick={() =>
                          handleOpenFolder(
                            folder
                          )
                        }
                        className="flex w-full items-center gap-3 text-left"
                      >

                        <div
                          className="
                            flex h-11 w-11
                            shrink-0
                            items-center
                            justify-center
                            rounded-xl
                            bg-gradient-to-br
                            from-indigo-50
                            to-violet-100
                            text-violet-600
                          "
                        >
                          <Folder
                            size={23}
                          />
                        </div>

                        <div className="min-w-0 flex-1">

                          <p className="truncate font-semibold text-slate-800">
                            {folder.name}
                          </p>

                          <p className="mt-0.5 text-xs text-slate-400">
                            Folder
                          </p>

                        </div>

                        <Star
                          size={19}
                          className="shrink-0 fill-amber-400 text-amber-400"
                        />

                      </button>

                      <div className="mt-4 border-t border-slate-100 pt-3">

                        <button
                          type="button"
                          onClick={() =>
                            handleUnstarFolder(
                              folder
                            )
                          }
                          className="
                            flex
                            items-center
                            gap-2
                            rounded-xl
                            px-3
                            py-2
                            text-xs
                            font-semibold
                            text-slate-500
                            transition-all
                            duration-200
                            hover:bg-amber-50
                            hover:text-amber-600
                          "
                        >
                          <Star
                            size={14}
                            className="fill-current"
                          />

                          Unstar
                        </button>

                      </div>

                    </div>
                  )
                )}

              </div>

            </section>
          )}

        {/* ================================================
            FILES
           ================================================ */}

        {!loading &&
          files.length > 0 && (
            <section>

              <div className="mb-5 flex items-center justify-between">

                <h2 className="text-xs font-bold tracking-[0.22em] text-slate-400">
                  FILES
                </h2>

                <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-white px-2 text-xs font-medium text-slate-500 shadow-sm">
                  {files.length}
                </span>

              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">

                {files.map(
                  (file) => (
                    <div
                      key={file.id}
                      className="
                        group
                        overflow-hidden
                        rounded-2xl
                        border
                        border-slate-200/80
                        bg-white
                        shadow-sm
                        transition-all
                        duration-200
                        hover:-translate-y-1
                        hover:border-violet-200
                        hover:shadow-lg
                        hover:shadow-slate-200/50
                      "
                    >

                      <button
                        type="button"
                        onClick={() =>
                          handleOpenFile(
                            file
                          )
                        }
                        className="block w-full text-left"
                      >

                        <div className="m-4 flex h-24 items-center justify-center rounded-xl bg-gradient-to-br from-slate-50 to-slate-100">

                          <FileText
                            size={36}
                            className="text-slate-400 transition group-hover:text-violet-500"
                          />

                        </div>

                        <div className="px-4 pb-4">

                          <div className="flex items-start gap-3">

                            <div className="min-w-0 flex-1">

                              <p
                                title={file.name}
                                className="truncate font-semibold text-slate-800"
                              >
                                {file.name}
                              </p>

                              <p className="mt-1 text-xs text-slate-400">
                                {formatFileSize(
                                  file.sizeBytes
                                )}
                              </p>

                            </div>

                            <Star
                              size={18}
                              className="shrink-0 fill-amber-400 text-amber-400"
                            />

                          </div>

                        </div>

                      </button>

                      <div className="mx-4 border-t border-slate-100 pb-4 pt-3">

                        <button
                          type="button"
                          onClick={() =>
                            handleUnstarFile(
                              file
                            )
                          }
                          className="
                            flex
                            items-center
                            gap-2
                            rounded-xl
                            px-3
                            py-2
                            text-xs
                            font-semibold
                            text-slate-500
                            transition-all
                            duration-200
                            hover:bg-amber-50
                            hover:text-amber-600
                          "
                        >
                          <Star
                            size={14}
                            className="fill-current"
                          />

                          Unstar
                        </button>

                      </div>

                    </div>
                  )
                )}

              </div>

            </section>
          )}

      </div>

    </div>
  );
}

export default StarredPage;