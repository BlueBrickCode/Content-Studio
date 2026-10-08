import {
  useEffect,
  useMemo,
  useState,
  type SyntheticEvent,
} from "react";
import Database from "@tauri-apps/plugin-sql";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

type MediaItem = {
  id: string;
  name: string;
  path: string;
  media_type: string;
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
};

type RenderedVideo = {
  id: string;
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
};

type PendingImport = {
  path: string;
  mediaType: string;
};

type MediaCategory =
  | "all"
  | "video"
  | "image"
  | "audio"
  | "file";

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];

  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );

  return `${(bytes / Math.pow(1024, index)).toFixed(
    index === 0 ? 0 : 1
  )} ${units[index]}`;
}

function formatDate(value: string) {
  if (!value) {
    return "";
  }

  const timestamp = Number(value);

  if (!Number.isNaN(timestamp) && timestamp > 0) {
    return new Date(timestamp).toLocaleString();
  }

  const parsed = new Date(value);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString();
  }

  return value;
}

function getFileName(path: string) {
  const cleaned = path.replace(/\\/g, "/");

  const fileName =
    cleaned.split("/").pop() || "Untitled Media";

  return fileName.replace(/\.[^/.]+$/, "");
}

/*
 * Determine media type from the REAL file extension.
 *
 * Do not use the database value as the source of truth here.
 * Older records may have been saved incorrectly as "file".
 */
function getMediaTypeFromPath(path: string) {
  if (!path) {
    return "file";
  }

  const cleanedPath = path.split(/[?#]/)[0];

  const fileName =
    cleanedPath.split(/[\\/]/).pop() || "";

  const extension =
    fileName.includes(".")
      ? fileName
          .split(".")
          .pop()
          ?.toLowerCase() || ""
      : "";

  if (
    [
      "mp4",
      "mov",
      "m4v",
      "avi",
      "mkv",
      "webm",
      "wmv",
      "mpeg",
      "mpg",
      "3gp",
      "ts",
      "mts",
      "m2ts",
      "flv",
    ].includes(extension)
  ) {
    return "video";
  }

  if (
    [
      "mp3",
      "wav",
      "m4a",
      "aac",
      "flac",
      "ogg",
      "oga",
      "opus",
      "wma",
      "aiff",
      "aif",
    ].includes(extension)
  ) {
    return "audio";
  }

  if (
    [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "webp",
      "bmp",
      "svg",
      "avif",
      "tif",
      "tiff",
    ].includes(extension)
  ) {
    return "image";
  }

  return "file";
}

/*
 * The path is the primary source of truth.
 *
 * This repairs old records where:
 *
 * path      = /media/media_123.mp4
 * media_type = file
 *
 * The UI will still correctly treat the item as a video.
 */
function getActualMediaType(item: MediaItem) {
  const detectedType =
    getMediaTypeFromPath(item.path);

  if (detectedType !== "file") {
    return detectedType;
  }

  const databaseType =
    String(item.media_type || "").toLowerCase();

  if (
    databaseType === "video" ||
    databaseType === "image" ||
    databaseType === "audio" ||
    databaseType === "file"
  ) {
    return databaseType;
  }

  return "file";
}

function isVideo(item: MediaItem) {
  return getActualMediaType(item) === "video";
}

function isImage(item: MediaItem) {
  return getActualMediaType(item) === "image";
}

function isAudio(item: MediaItem) {
  return getActualMediaType(item) === "audio";
}

function getCategoryLabel(
  category: MediaCategory
) {
  switch (category) {
    case "video":
      return "Videos";

    case "image":
      return "Images";

    case "audio":
      return "Audio";

    case "file":
      return "Other";

    default:
      return "All Media";
  }
}

export default function Media() {
  const [media, setMedia] =
    useState<MediaItem[]>([]);

  const [renders, setRenders] =
    useState<RenderedVideo[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [message, setMessage] =
    useState("");

  const [selectedCategory, setSelectedCategory] =
    useState<MediaCategory>("all");

  const [thumbnailPaths, setThumbnailPaths] =
    useState<Record<string, string>>({});

  const [thumbnailErrors, setThumbnailErrors] =
    useState<Record<string, boolean>>({});

  const [videoPlaybackErrors, setVideoPlaybackErrors] =
    useState<Record<string, boolean>>({});

  const [renderPlaybackErrors, setRenderPlaybackErrors] =
    useState<Record<string, boolean>>({});

  const [nameDialogOpen, setNameDialogOpen] =
    useState(false);

  const [pendingImport, setPendingImport] =
    useState<PendingImport | null>(null);

  const [mediaName, setMediaName] =
    useState("");

  const [renameDialogOpen, setRenameDialogOpen] =
    useState(false);

  const [renameItem, setRenameItem] =
    useState<MediaItem | null>(null);

  const [renameValue, setRenameValue] =
    useState("");

  /*
   * Generate a thumbnail for a video.
   *
   * Thumbnail failure does NOT make the media itself fail.
   */
  const generateThumbnail = async (
    item: MediaItem
  ) => {
    if (!isVideo(item)) {
      return null;
    }

    try {
      const thumbnailPath =
        await invoke<string>(
          "generate_media_thumbnail",
          {
            path: item.path,
          }
        );

      if (!thumbnailPath) {
        return null;
      }

      setThumbnailPaths(
        (current) => ({
          ...current,
          [item.id]: thumbnailPath,
        })
      );

      setThumbnailErrors(
        (current) => {
          const updated = {
            ...current,
          };

          delete updated[item.id];

          return updated;
        }
      );

      return thumbnailPath;
    } catch (error) {
      console.error(
        `Unable to generate thumbnail for ${item.name}:`,
        error
      );

      setThumbnailErrors(
        (current) => ({
          ...current,
          [item.id]: true,
        })
      );

      return null;
    }
  };

  const load = async () => {
    setLoading(true);
    setMessage("");

    try {
      const db = await Database.load(
        "sqlite:content-studio.db"
      );

      /*
       * IMPORTANT:
       *
       * There is intentionally NO media_type WHERE clause.
       *
       * We want every media row in the database.
       */
      const rows =
        await db.select<MediaItem[]>(
          `
          SELECT
            id,
            name,
            path,
            media_type,
            size,
            duration,
            width,
            height,
            created_at
          FROM media
          ORDER BY created_at DESC
          `
        );

      const loadedMedia =
        rows || [];

      /*
       * Repair old records in memory.
       */
      const repairedMedia =
        loadedMedia.map((item) => {
          const actualType =
            getMediaTypeFromPath(
              item.path
            );

          if (
            actualType !== "file" &&
            actualType !== item.media_type
          ) {
            return {
              ...item,
              media_type: actualType,
            };
          }

          return item;
        });

      setMedia(repairedMedia);

      /*
       * Permanently repair old database records.
       */
      for (const item of repairedMedia) {
        const actualType =
          getMediaTypeFromPath(
            item.path
          );

        if (
          actualType !== "file" &&
          actualType !== item.media_type
        ) {
          try {
            await db.execute(
              `
              UPDATE media
              SET media_type = ?
              WHERE id = ?
              `,
              [
                actualType,
                item.id,
              ]
            );
          } catch (repairError) {
            console.error(
              `Unable to repair media type for ${item.name}:`,
              repairError
            );
          }
        }
      }

      const rendered =
        await invoke<RenderedVideo[]>(
          "list_rendered_videos"
        );

      setRenders(
        rendered || []
      );

      /*
       * Generate thumbnails for all videos.
       *
       * This also repairs older videos that don't
       * have thumbnails yet.
       */
      const videoItems =
        repairedMedia.filter(
          isVideo
        );

      if (
        videoItems.length > 0
      ) {
        await Promise.all(
          videoItems.map(
            (item) =>
              generateThumbnail(
                item
              )
          )
        );
      }
    } catch (error) {
      console.error(error);

      setMessage(
        `Unable to load media: ${String(
          error
        )}`
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  /*
   * Category counts.
   *
   * These are calculated from the actual file extensions,
   * so old incorrectly-labelled records are counted correctly.
   */
  const categoryCounts = useMemo(() => {
    const counts = {
      all: media.length,
      video: 0,
      image: 0,
      audio: 0,
      file: 0,
    };

    for (const item of media) {
      const type =
        getActualMediaType(item);

      if (type === "video") {
        counts.video += 1;
      } else if (type === "image") {
        counts.image += 1;
      } else if (type === "audio") {
        counts.audio += 1;
      } else {
        counts.file += 1;
      }
    }

    return counts;
  }, [media]);

  /*
   * Filter the library by category.
   *
   * "all" always contains every database record.
   */
  const visibleMedia =
    useMemo(() => {
      if (
        selectedCategory ===
        "all"
      ) {
        return media;
      }

      return media.filter(
        (item) =>
          getActualMediaType(
            item
          ) === selectedCategory
      );
    }, [
      media,
      selectedCategory,
    ]);

  const importMedia = async () => {
    setMessage("");

    try {
      const selected =
        await open({
          multiple: false,
          directory: false,
          title: "Choose Media",
          filters: [
            {
              name: "Media",
              extensions: [
                "mp4",
                "mov",
                "m4v",
                "avi",
                "mkv",
                "webm",
                "wmv",
                "mpeg",
                "mpg",
                "3gp",
                "ts",
                "mts",
                "m2ts",
                "flv",

                "mp3",
                "wav",
                "m4a",
                "aac",
                "flac",
                "ogg",
                "oga",
                "opus",
                "wma",
                "aiff",
                "aif",

                "jpg",
                "jpeg",
                "png",
                "gif",
                "webp",
                "bmp",
                "svg",
                "avif",
                "tif",
                "tiff",
              ],
            },
          ],
        });

      if (
        !selected ||
        Array.isArray(selected)
      ) {
        return;
      }

      const sourcePath =
        selected as string;

      const mediaType =
        getMediaTypeFromPath(
          sourcePath
        );

      if (
        mediaType === "file"
      ) {
        setMessage(
          "That file type is not supported by the Media Library."
        );

        return;
      }

      const suggestedName =
        getFileName(
          sourcePath
        );

      setPendingImport({
        path: sourcePath,
        mediaType,
      });

      setMediaName(
        suggestedName
      );

      setNameDialogOpen(
        true
      );
    } catch (error) {
      console.error(error);

      setMessage(
        `Unable to choose media: ${String(
          error
        )}`
      );
    }
  };

  const cancelImport = () => {
    setNameDialogOpen(
      false
    );

    setPendingImport(
      null
    );

    setMediaName("");
  };

  const confirmImport = async () => {
    if (!pendingImport) {
      return;
    }

    const trimmedName =
      mediaName.trim() ||
      getFileName(
        pendingImport.path
      );

    try {
      setMessage("");

      /*
       * Copy the source into Content Studio's
       * managed media folder.
       */
      const importedPath =
        await invoke<string>(
          "import_media",
          {
            sourcePath:
              pendingImport.path,
          }
        );

      if (!importedPath) {
        throw new Error(
          "The imported media path was empty."
        );
      }

      const db =
        await Database.load(
          "sqlite:content-studio.db"
        );

      const id =
        `media_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`;

      /*
       * Determine the type from the actual destination
       * path rather than trusting the original selection.
       */
      const importedMediaType =
        getMediaTypeFromPath(
          importedPath
        );

      const finalMediaType =
        importedMediaType !== "file"
          ? importedMediaType
          : pendingImport.mediaType;

      await db.execute(
        `
        INSERT INTO media (
          id,
          name,
          path,
          media_type,
          size,
          duration,
          width,
          height,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          id,
          trimmedName,
          importedPath,
          finalMediaType,
          0,
          null,
          null,
          null,
          new Date().toISOString(),
        ]
      );

      /*
       * Generate the video thumbnail immediately.
       *
       * If this fails, the media remains imported.
       */
      if (
        finalMediaType ===
        "video"
      ) {
        try {
          const thumbnailPath =
            await invoke<string>(
              "generate_media_thumbnail",
              {
                path:
                  importedPath,
              }
            );

          if (thumbnailPath) {
            setThumbnailPaths(
              (current) => ({
                ...current,
                [id]:
                  thumbnailPath,
              })
            );
          }
        } catch (thumbnailError) {
          console.error(
            "Unable to generate imported video thumbnail:",
            thumbnailError
          );
        }
      }

      cancelImport();

      await load();
    } catch (error) {
      console.error(error);

      setMessage(
        `Unable to import media: ${String(
          error
        )}`
      );
    }
  };

  const deleteMedia = async (
    item: MediaItem
  ) => {
    const confirmed =
      window.confirm(
        `Delete "${item.name}" from Content Studio?\n\nThis will remove the imported copy from the app.`
      );

    if (!confirmed) {
      return;
    }

    try {
      setMessage("");

      await invoke(
        "delete_media",
        {
          path: item.path,
        }
      );

      const db =
        await Database.load(
          "sqlite:content-studio.db"
        );

      await db.execute(
        `DELETE FROM media WHERE id = ?`,
        [item.id]
      );

      setThumbnailPaths(
        (current) => {
          const updated = {
            ...current,
          };

          delete updated[
            item.id
          ];

          return updated;
        }
      );

      setThumbnailErrors(
        (current) => {
          const updated = {
            ...current,
          };

          delete updated[
            item.id
          ];

          return updated;
        }
      );

      setVideoPlaybackErrors(
        (current) => {
          const updated = {
            ...current,
          };

          delete updated[
            item.id
          ];

          return updated;
        }
      );

      await load();
    } catch (error) {
      console.error(error);

      setMessage(
        `Unable to delete media: ${String(
          error
        )}`
      );
    }
  };

  const openRename = (
    item: MediaItem
  ) => {
    setRenameItem(item);
    setRenameValue(
      item.name
    );
    setRenameDialogOpen(
      true
    );
  };

  const cancelRename = () => {
    setRenameDialogOpen(
      false
    );

    setRenameItem(
      null
    );

    setRenameValue("");
  };

  const confirmRename = async () => {
    if (!renameItem) {
      return;
    }

    const trimmedName =
      renameValue.trim();

    if (!trimmedName) {
      setMessage(
        "Please enter a name."
      );

      return;
    }

    try {
      setMessage("");

      const db =
        await Database.load(
          "sqlite:content-studio.db"
        );

      await db.execute(
        `
        UPDATE media
        SET name = ?
        WHERE id = ?
        `,
        [
          trimmedName,
          renameItem.id,
        ]
      );

      setMedia(
        (current) =>
          current.map(
            (item) =>
              item.id ===
              renameItem.id
                ? {
                    ...item,
                    name: trimmedName,
                  }
                : item
          )
      );

      cancelRename();
    } catch (error) {
      console.error(error);

      setMessage(
        `Unable to rename media: ${String(
          error
        )}`
      );
    }
  };

  const deleteRender = async (
    render: RenderedVideo
  ) => {
    const confirmed =
      window.confirm(
        `Delete "${render.name}"?\n\nThis permanently removes the rendered video from Content Studio.`
      );

    if (!confirmed) {
      return;
    }

    try {
      setMessage("");

      await invoke(
        "delete_rendered_video",
        {
          path: render.path,
        }
      );

      await load();
    } catch (error) {
      console.error(error);

      setMessage(
        `Unable to delete render: ${String(
          error
        )}`
      );
    }
  };

  const revealRender = async (
    render: RenderedVideo
  ) => {
    try {
      setMessage("");

      await invoke(
        "reveal_rendered_video",
        {
          path: render.path,
        }
      );
    } catch (error) {
      console.error(error);

      setMessage(
        `Unable to show render: ${String(
          error
        )}`
      );
    }
  };

  const handleVideoError = (
    item: MediaItem,
    event: SyntheticEvent<HTMLVideoElement>
  ) => {
    console.error(
      `Video preview failed for "${item.name}"`,
      event.currentTarget.error
    );

    setVideoPlaybackErrors(
      (current) => ({
        ...current,
        [item.id]: true,
      })
    );
  };

  const handleRenderError = (
    render: RenderedVideo,
    event: SyntheticEvent<HTMLVideoElement>
  ) => {
    console.error(
      `Rendered video preview failed for "${render.name}"`,
      event.currentTarget.error
    );

    setRenderPlaybackErrors(
      (current) => ({
        ...current,
        [render.id]: true,
      })
    );
  };

  const totalMediaStorage =
    media.reduce(
      (total, item) =>
        total + (item.size || 0),
      0
    );

  const totalRenderStorage =
    renders.reduce(
      (total, item) =>
        total + (item.size || 0),
      0
    );

  return (
    <div className="page">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 20,
          marginBottom: 24,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 1.5,
              opacity: 0.55,
              marginBottom: 6,
            }}
          >
            MEDIA LIBRARY
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: 32,
            }}
          >
            Media
          </h1>

          <p
            style={{
              marginTop: 8,
              opacity: 0.65,
            }}
          >
            Manage your imported videos,
            images, audio, and rendered
            content.
          </p>
        </div>

        <button
          className="primary-button"
          onClick={importMedia}
        >
          + Add Media
        </button>
      </div>

      {message && (
        <div
          style={{
            padding: "12px 16px",
            marginBottom: 20,
            borderRadius: 10,
            background:
              "rgba(255, 80, 80, 0.12)",
            border:
              "1px solid rgba(255, 80, 80, 0.25)",
            color: "#ffb0b0",
          }}
        >
          {message}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(3, minmax(0, 1fr))",
          gap: 16,
          marginBottom: 30,
        }}
      >
        <div className="stat-card">
          <div className="stat-label">
            IMPORTED MEDIA
          </div>

          <div className="stat-value">
            {media.length}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">
            MEDIA STORAGE
          </div>

          <div className="stat-value">
            {formatBytes(
              totalMediaStorage
            )}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">
            RENDER STORAGE
          </div>

          <div className="stat-value">
            {formatBytes(
              totalRenderStorage
            )}
          </div>
        </div>
      </div>

      <section>
        <div
          style={{
            display: "flex",
            justifyContent:
              "space-between",
            alignItems: "center",
            marginBottom: 16,
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>
              Imported Media
            </h2>

            <div
              style={{
                opacity: 0.55,
                marginTop: 4,
                fontSize: 13,
              }}
            >
              Your reusable videos, images,
              and audio.
            </div>
          </div>
        </div>

        /*
         * CATEGORY BAR
         *
         * This uses plain buttons and your existing styling,
         * so there are no new dependencies.
         */
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 20,
          }}
        >
          {(
            [
              {
                id: "all",
                label: "All",
                count:
                  categoryCounts.all,
              },
              {
                id: "video",
                label: "Videos",
                count:
                  categoryCounts.video,
              },
              {
                id: "image",
                label: "Images",
                count:
                  categoryCounts.image,
              },
              {
                id: "audio",
                label: "Audio",
                count:
                  categoryCounts.audio,
              },
              {
                id: "file",
                label: "Other",
                count:
                  categoryCounts.file,
              },
            ] as {
              id: MediaCategory;
              label: string;
              count: number;
            }[]
          ).map((category) => {
            const active =
              selectedCategory ===
              category.id;

            return (
              <button
                key={category.id}
                onClick={() =>
                  setSelectedCategory(
                    category.id
                  )
                }
                style={{
                  border: active
                    ? "1px solid rgba(255,255,255,0.35)"
                    : "1px solid rgba(255,255,255,0.1)",
                  background: active
                    ? "rgba(255,255,255,0.12)"
                    : "rgba(255,255,255,0.04)",
                  color: "inherit",
                  borderRadius: 8,
                  padding:
                    "8px 12px",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: active
                    ? 700
                    : 500,
                  display: "flex",
                  alignItems:
                    "center",
                  gap: 7,
                }}
              >
                <span>
                  {category.label}
                </span>

                <span
                  style={{
                    opacity: 0.55,
                    fontSize: 11,
                  }}
                >
                  {category.count}
                </span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="empty-state">
            Loading media...
          </div>
        ) : visibleMedia.length ===
          0 ? (
          <div className="empty-state">
            <div
              style={{
                fontSize: 42,
                marginBottom: 12,
              }}
            >
              {selectedCategory ===
              "video"
                ? "🎬"
                : selectedCategory ===
                  "image"
                ? "🖼️"
                : selectedCategory ===
                  "audio"
                ? "🎵"
                : "📁"}
            </div>

            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
              }}
            >
              No{" "}
              {getCategoryLabel(
                selectedCategory
              ).toLowerCase()}
            </div>

            <div
              style={{
                opacity: 0.6,
                marginTop: 6,
              }}
            >
              Add media to this category
              to see it here.
            </div>
          </div>
        ) : (
          <div className="video-grid">
            {visibleMedia.map(
              (item) => {
                const assetUrl =
                  convertFileSrc(
                    item.path
                  );

                const actualMediaType =
                  getActualMediaType(
                    item
                  );

                const thumbnailPath =
                  thumbnailPaths[
                    item.id
                  ];

                const thumbnailUrl =
                  thumbnailPath &&
                  !thumbnailErrors[
                    item.id
                  ]
                    ? convertFileSrc(
                        thumbnailPath
                      )
                    : undefined;

                const playbackFailed =
                  videoPlaybackErrors[
                    item.id
                  ];

                return (
                  <div
                    className="video-card"
                    key={item.id}
                    style={{
                      overflow:
                        "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: 220,
                        background:
                          "#090b0f",
                        display:
                          "flex",
                        alignItems:
                          "center",
                        justifyContent:
                          "center",
                        overflow:
                          "hidden",
                        position:
                          "relative",
                      }}
                    >
                      {actualMediaType ===
                      "video" ? (
                        <>
                          {thumbnailUrl && (
                            <img
                              src={
                                thumbnailUrl
                              }
                              alt=""
                              aria-hidden="true"
                              onError={() =>
                                setThumbnailErrors(
                                  (
                                    current
                                  ) => ({
                                    ...current,
                                    [item.id]:
                                      true,
                                  })
                                )
                              }
                              style={{
                                position:
                                  "absolute",
                                inset: 0,
                                width:
                                  "100%",
                                height:
                                  "100%",
                                objectFit:
                                  "cover",
                                display:
                                  "block",
                              }}
                            />
                          )}

                          {!playbackFailed && (
                            <video
                              src={
                                assetUrl
                              }
                              poster={
                                thumbnailUrl
                              }
                              autoPlay
                              muted
                              loop
                              playsInline
                              preload="auto"
                              controls={
                                false
                              }
                              onError={(
                                event
                              ) =>
                                handleVideoError(
                                  item,
                                  event
                                )
                              }
                              style={{
                                position:
                                  "relative",
                                zIndex: 2,
                                width:
                                  "100%",
                                height:
                                  "100%",
                                objectFit:
                                  "cover",
                                display:
                                  "block",
                                background:
                                  "transparent",
                              }}
                            />
                          )}

                          {playbackFailed && (
                            <div
                              style={{
                                position:
                                  "absolute",
                                inset: 0,
                                zIndex: 3,
                                display:
                                  "flex",
                                alignItems:
                                  "flex-end",
                                padding: 12,
                                background:
                                  thumbnailUrl
                                    ? "linear-gradient(transparent, rgba(0,0,0,0.7))"
                                    : "#090b0f",
                                pointerEvents:
                                  "none",
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 11,
                                  fontWeight:
                                    700,
                                  opacity:
                                    0.8,
                                  background:
                                    "rgba(0,0,0,0.55)",
                                  padding:
                                    "5px 8px",
                                  borderRadius:
                                    6,
                                }}
                              >
                                {thumbnailUrl
                                  ? "Thumbnail preview"
                                  : "Video preview unavailable"}
                              </div>
                            </div>
                          )}
                        </>
                      ) : actualMediaType ===
                        "image" ? (
                        <img
                          src={
                            assetUrl
                          }
                          alt={
                            item.name
                          }
                          style={{
                            width:
                              "100%",
                            height:
                              "100%",
                            objectFit:
                              "contain",
                            display:
                              "block",
                          }}
                        />
                      ) : actualMediaType ===
                        "audio" ? (
                        <div
                          style={{
                            width:
                              "100%",
                            height:
                              "100%",
                            display:
                              "flex",
                            flexDirection:
                              "column",
                            alignItems:
                              "center",
                            justifyContent:
                              "center",
                            gap: 18,
                            padding: 20,
                            boxSizing:
                              "border-box",
                          }}
                        >
                          <div
                            style={{
                              fontSize:
                                48,
                            }}
                          >
                            🎵
                          </div>

                          <audio
                            src={
                              assetUrl
                            }
                            controls
                            preload="metadata"
                            style={{
                              width:
                                "100%",
                            }}
                          />
                        </div>
                      ) : (
                        <div
                          style={{
                            opacity: 0.5,
                          }}
                        >
                          No preview
                        </div>
                      )}
                    </div>

                    <div
                      style={{
                        padding: 16,
                      }}
                    >
                      <div
                        style={{
                          fontWeight:
                            800,
                          fontSize: 16,
                          marginBottom:
                            6,
                          overflow:
                            "hidden",
                          textOverflow:
                            "ellipsis",
                          whiteSpace:
                            "nowrap",
                        }}
                        title={
                          item.name
                        }
                      >
                        {item.name}
                      </div>

                      <div
                        style={{
                          display:
                            "flex",
                          justifyContent:
                            "space-between",
                          gap: 10,
                          fontSize: 12,
                          opacity: 0.55,
                          marginBottom:
                            14,
                        }}
                      >
                        <span>
                          {
                            actualMediaType
                          }
                        </span>

                        <span>
                          {formatBytes(
                            item.size
                          )}
                        </span>
                      </div>

                      <div
                        style={{
                          display:
                            "flex",
                          gap: 8,
                          flexWrap:
                            "wrap",
                        }}
                      >
                        <button
                          className="secondary-button"
                          onClick={() =>
                            openRename(
                              item
                            )
                          }
                        >
                          Rename
                        </button>

                        <button
                          className="danger-button"
                          onClick={() =>
                            deleteMedia(
                              item
                            )
                          }
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        )}
      </section>

      <section
        style={{
          marginTop: 42,
        }}
      >
        <div
          style={{
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: 0 }}>
            Rendered Videos
          </h2>

          <div
            style={{
              opacity: 0.55,
              marginTop: 4,
              fontSize: 13,
            }}
          >
            Finished videos created by
            Content Studio.
          </div>
        </div>

        {renders.length === 0 ? (
          <div className="empty-state">
            <div
              style={{
                fontSize: 42,
                marginBottom: 12,
              }}
            >
              📹
            </div>

            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
              }}
            >
              No rendered videos
            </div>

            <div
              style={{
                opacity: 0.6,
                marginTop: 6,
              }}
            >
              Rendered videos will appear
              here.
            </div>
          </div>
        ) : (
          <div className="video-grid">
            {renders.map(
              (render) => {
                const renderUrl =
                  convertFileSrc(
                    render.path
                  );

                const playbackFailed =
                  renderPlaybackErrors[
                    render.id
                  ];

                return (
                  <div
                    className="video-card"
                    key={render.id}
                  >
                    <div
                      style={{
                        height: 320,
                        background:
                          "#090b0f",
                        display:
                          "flex",
                        alignItems:
                          "center",
                        justifyContent:
                          "center",
                        overflow:
                          "hidden",
                      }}
                    >
                      {playbackFailed ? (
                        <div
                          style={{
                            padding: 24,
                            textAlign:
                              "center",
                            opacity:
                              0.65,
                          }}
                        >
                          <div
                            style={{
                              fontSize:
                                40,
                              marginBottom:
                                10,
                            }}
                          >
                            📹
                          </div>

                          <div
                            style={{
                              fontWeight:
                                700,
                              marginBottom:
                                6,
                            }}
                          >
                            Preview unavailable
                          </div>

                          <div
                            style={{
                              fontSize:
                                12,
                              lineHeight:
                                1.5,
                            }}
                          >
                            The rendered
                            file exists,
                            but the
                            WebView could
                            not play it.
                          </div>
                        </div>
                      ) : (
                        <video
                          src={
                            renderUrl
                          }
                          controls
                          playsInline
                          preload="metadata"
                          style={{
                            width:
                              "100%",
                            height:
                              "100%",
                            objectFit:
                              "contain",
                            display:
                              "block",
                          }}
                          onError={(
                            event
                          ) =>
                            handleRenderError(
                              render,
                              event
                            )
                          }
                        />
                      )}
                    </div>

                    <div
                      style={{
                        padding: 16,
                      }}
                    >
                      <div
                        style={{
                          fontWeight:
                            800,
                          fontSize: 15,
                          marginBottom:
                            6,
                          overflow:
                            "hidden",
                          textOverflow:
                            "ellipsis",
                          whiteSpace:
                            "nowrap",
                        }}
                        title={
                          render.name
                        }
                      >
                        {render.name.replace(
                          /\.mp4$/i,
                          ""
                        )}
                      </div>

                      <div
                        style={{
                          fontSize: 12,
                          opacity: 0.55,
                          marginBottom:
                            14,
                        }}
                      >
                        {formatBytes(
                          render.size
                        )}
                        {" • "}
                        {formatDate(
                          render.modifiedAt
                        )}
                      </div>

                      <div
                        style={{
                          display:
                            "flex",
                          gap: 8,
                          flexWrap:
                            "wrap",
                        }}
                      >
                        <button
                          className="secondary-button"
                          onClick={() =>
                            revealRender(
                              render
                            )
                          }
                        >
                          Show in Folder
                        </button>

                        <button
                          className="danger-button"
                          onClick={() =>
                            deleteRender(
                              render
                            )
                          }
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        )}
      </section>

      {nameDialogOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background:
              "rgba(0, 0, 0, 0.65)",
            display: "flex",
            alignItems:
              "center",
            justifyContent:
              "center",
            zIndex: 1000,
            padding: 20,
          }}
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              cancelImport();
            }
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 480,
              background: "#15191f",
              border:
                "1px solid rgba(255,255,255,0.1)",
              borderRadius: 16,
              padding: 24,
              boxShadow:
                "0 25px 80px rgba(0,0,0,0.5)",
            }}
          >
            <h2
              style={{
                marginTop: 0,
              }}
            >
              Name Media
            </h2>

            <p
              style={{
                opacity: 0.6,
                lineHeight: 1.5,
              }}
            >
              Give this media a name
              you will recognize in
              your library and
              categories.
            </p>

            <input
              autoFocus
              value={mediaName}
              onChange={(event) =>
                setMediaName(
                  event.target.value
                )
              }
              onKeyDown={(event) => {
                if (
                  event.key ===
                  "Enter"
                ) {
                  void confirmImport();
                }

                if (
                  event.key ===
                  "Escape"
                ) {
                  cancelImport();
                }
              }}
              placeholder="Media name"
              style={{
                width: "100%",
                boxSizing:
                  "border-box",
                marginTop: 10,
              }}
            />

            <div
              style={{
                display: "flex",
                justifyContent:
                  "flex-end",
                gap: 10,
                marginTop: 20,
              }}
            >
              <button
                className="secondary-button"
                onClick={
                  cancelImport
                }
              >
                Cancel
              </button>

              <button
                className="primary-button"
                onClick={() =>
                  void confirmImport()
                }
              >
                Add Media
              </button>
            </div>
          </div>
        </div>
      )}

      {renameDialogOpen &&
        renameItem && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background:
                "rgba(0, 0, 0, 0.65)",
              display: "flex",
              alignItems:
                "center",
              justifyContent:
                "center",
              zIndex: 1001,
              padding: 20,
            }}
            onMouseDown={(event) => {
              if (
                event.target ===
                event.currentTarget
              ) {
                cancelRename();
              }
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 480,
                background: "#15191f",
                border:
                  "1px solid rgba(255,255,255,0.1)",
                borderRadius: 16,
                padding: 24,
                boxShadow:
                  "0 25px 80px rgba(0,0,0,0.5)",
              }}
            >
              <h2
                style={{
                  marginTop: 0,
                }}
              >
                Rename Media
              </h2>

              <p
                style={{
                  opacity: 0.6,
                  lineHeight: 1.5,
                }}
              >
                Change the name used
                throughout Content
                Studio. The actual
                media file will not
                be renamed.
              </p>

              <input
                autoFocus
                value={
                  renameValue
                }
                onChange={(event) =>
                  setRenameValue(
                    event.target.value
                  )
                }
                onKeyDown={(event) => {
                  if (
                    event.key ===
                    "Enter"
                  ) {
                    void confirmRename();
                  }

                  if (
                    event.key ===
                    "Escape"
                  ) {
                    cancelRename();
                  }
                }}
                placeholder="Enter a new name"
                style={{
                  width: "100%",
                  boxSizing:
                    "border-box",
                  marginTop: 10,
                }}
              />

              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "flex-end",
                  gap: 10,
                  marginTop: 20,
                }}
              >
                <button
                  className="secondary-button"
                  onClick={
                    cancelRename
                  }
                >
                  Cancel
                </button>

                <button
                  className="primary-button"
                  onClick={() =>
                    void confirmRename()
                  }
                >
                  Save Name
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
