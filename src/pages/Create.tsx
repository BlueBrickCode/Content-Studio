import {
  useEffect,
  useMemo,
  useState,
} from "react";

import Database from "@tauri-apps/plugin-sql";
import { open } from "@tauri-apps/plugin-dialog";

import {
  convertFileSrc,
  invoke,
} from "@tauri-apps/api/core";

type CreateMode = "single" | "batch";

type LibraryType =
  | "video"
  | "text"
  | "audio";

type MediaItem = {
  id: string;
  name: string;
  path: string;
  media_type: string;
  size: number;
  created_at: string;
};

type Category = {
  id: string;
  name: string;
  category_type: LibraryType;
  created_at: string;
  updated_at: string;
};

type CategoryMedia = {
  category_id: string;
  media_id: string;
};

type TextItem = {
  id: string;
  category_id: string;
  text: string;
  created_at: string;
  updated_at: string;
};

type TemplateItem = {
  id: string;
  name: string;
  layers_json?: string;
  width?: number;
  height?: number;
};

type ProjectRow = {
  id: string;
  name: string;
  source_media_id: string | null;
  template_id: string | null;
  width: number;
  height: number;
  status: string;
  settings_json: string;
  created_at: string;
  updated_at: string;
};

type RenderedVideo = {
  id: string;
  project_id: string;
  variation_id: number;
  variation_text: string;
  output_path: string;
  created_at: string;
};

type TemplateLayer = {
  id: string;
  type: "video" | "text";
  text?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  fontSize: number;
  color: string;
  opacity: number;
  borderWidth: number;
  borderColor: string;
  shadow: boolean;
};

type TemplateDocument = {
  backgroundColor: string;
  layers: TemplateLayer[];
};

type GeneratedCombination = {
  variationId: number;
  video: MediaItem;
  text: TextItem;
  audio: MediaItem;
  template: TemplateItem;
  templateDocument: TemplateDocument;
};

type ProjectSettings = {
  mode: CreateMode;
  variationCount: number;
  clipLength: string;
  originalAudio: number;
  muteOriginalAudio: boolean;
  addedAudioPath: string | null;
  addedAudioName: string | null;
  variations: string[];

  videoCategoryId: string | null;
  textCategoryId: string | null;
  audioCategoryId: string | null;

  randomizeTemplate: boolean;
  templatePoolIds: string[];

  generatedCombinations?: {
    variationId: number;
    videoId: string;
    textId: string;
    audioId: string;
    templateId: string;
  }[];
};

type RenderJob = {
  project_id: string;
  variation_id: number;
  variation_text: string;
  source_path: string;
  template_layers_json: string;
  output_width: number;
  output_height: number;
  fps: number;
  bitrate: string;
  clip_length: number;
  original_audio: number;
  mute_original_audio: boolean;
  added_audio_path: string | null;
  output_path: string;
};

const EMPTY_TEMPLATE_DOCUMENT: TemplateDocument = {
  backgroundColor: "#FFFFFF",
  layers: [],
};

const createId = (
  prefix: string,
) =>
  `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;

const now = () =>
  new Date().toISOString();

const defaultVariations = (
  count: number,
) =>
  Array.from(
    { length: count },
    () => "",
  );

const formatBytes = (
  bytes: number,
) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB",
  ];

  const index = Math.min(
    Math.floor(
      Math.log(bytes) /
        Math.log(1024),
    ),
    units.length - 1,
  );

  return `${(
    bytes /
    Math.pow(1024, index)
  ).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const renderFileName = (
  projectName: string,
  variationId: number,
) => {
  const safeName =
    projectName
      .trim()
      .replace(/[^a-z0-9-_]+/gi, "-")
      .replace(/^-+|-+$/g, "") ||
    "content";

  return `${safeName}-${String(
    variationId,
  ).padStart(3, "0")}.mp4`;
};

const parseTemplateDocument = (
  value: string | null | undefined,
): TemplateDocument => {
  if (!value) {
    return EMPTY_TEMPLATE_DOCUMENT;
  }

  try {
    const parsed =
      JSON.parse(value);

    if (
      !parsed ||
      typeof parsed !== "object"
    ) {
      return EMPTY_TEMPLATE_DOCUMENT;
    }

    return {
      backgroundColor:
        typeof parsed.backgroundColor ===
        "string"
          ? parsed.backgroundColor
          : "#FFFFFF",
      layers:
        Array.isArray(
          parsed.layers,
        )
          ? parsed.layers
          : [],
    };
  } catch {
    return EMPTY_TEMPLATE_DOCUMENT;
  }
};

const previewText = (
  value: string,
  variation: string,
) =>
  value
    .replace(
      /\{\{text\}\}/gi,
      variation,
    )
    .replace(
      /\{\{variation\}\}/gi,
      variation,
    );

const shuffle = <T,>(
  values: T[],
) => {
  const result = [...values];

  for (
    let index = result.length - 1;
    index > 0;
    index -= 1
  ) {
    const randomIndex =
      Math.floor(
        Math.random() *
          (index + 1),
      );

    [
      result[index],
      result[randomIndex],
    ] = [
      result[randomIndex],
      result[index],
    ];
  }

  return result;
};

const clamp = (
  value: number,
  minimum: number,
  maximum: number,
) =>
  Math.min(
    maximum,
    Math.max(
      minimum,
      value,
    ),
  );

function Create() {
  const [db, setDb] =
    useState<Database | null>(null);

  const [projectId, setProjectId] =
    useState<string | null>(null);

  const [projectName, setProjectName] =
    useState("Untitled Project");

  const [mode, setMode] =
    useState<CreateMode>("batch");

  const [variationCount, setVariationCount] =
    useState(10);

  const [clipLength, setClipLength] =
    useState("12");

  const [originalAudio, setOriginalAudio] =
    useState(80);

  const [muteOriginalAudio, setMuteOriginalAudio] =
    useState(false);

  const [addedAudioPath, setAddedAudioPath] =
    useState<string | null>(null);

  const [addedAudioName, setAddedAudioName] =
    useState<string | null>(null);

  const [variations, setVariations] =
    useState<string[]>(
      defaultVariations(10),
    );

  const [videos, setVideos] =
    useState<MediaItem[]>([]);

  const [audioMedia, setAudioMedia] =
    useState<MediaItem[]>([]);

  const [templates, setTemplates] =
    useState<TemplateItem[]>([]);

  const [categories, setCategories] =
    useState<Category[]>([]);

  const [categoryMedia, setCategoryMedia] =
    useState<CategoryMedia[]>([]);

  const [textItems, setTextItems] =
    useState<TextItem[]>([]);

  const [selectedVideo, setSelectedVideo] =
    useState<MediaItem | null>(null);

  const [selectedTemplate, setSelectedTemplate] =
    useState("No template");

  const [videoCategoryId, setVideoCategoryId] =
    useState<string>("");

  const [textCategoryId, setTextCategoryId] =
    useState<string>("");

  const [audioCategoryId, setAudioCategoryId] =
    useState<string>("");

  const [randomizeTemplate, setRandomizeTemplate] =
    useState(false);

  const [templatePoolIds, setTemplatePoolIds] =
    useState<string[]>([]);

  const [templateDocument, setTemplateDocument] =
    useState<TemplateDocument>(
      EMPTY_TEMPLATE_DOCUMENT,
    );

  const [generatedCombinations, setGeneratedCombinations] =
    useState<GeneratedCombination[]>([]);

  const [rendered, setRendered] =
    useState<RenderedVideo[]>([]);

  const [showMediaPicker, setShowMediaPicker] =
    useState(false);

  const [showAudioPicker, setShowAudioPicker] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [rendering, setRendering] =
    useState(false);

  const [renderProgress, setRenderProgress] =
    useState(0);

  const [message, setMessage] =
    useState<string | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  const videoCategories =
    useMemo(
      () =>
        categories.filter(
          (category) =>
            category.category_type ===
            "video",
        ),
      [categories],
    );

  const textCategories =
    useMemo(
      () =>
        categories.filter(
          (category) =>
            category.category_type ===
            "text",
        ),
      [categories],
    );

  const audioCategories =
    useMemo(
      () =>
        categories.filter(
          (category) =>
            category.category_type ===
            "audio",
        ),
      [categories],
    );

  const selectedVideoCategory =
    useMemo(
      () =>
        videoCategories.find(
          (category) =>
            category.id ===
            videoCategoryId,
        ) ?? null,
      [
        videoCategories,
        videoCategoryId,
      ],
    );

  const selectedTextCategory =
    useMemo(
      () =>
        textCategories.find(
          (category) =>
            category.id ===
            textCategoryId,
        ) ?? null,
      [
        textCategories,
        textCategoryId,
      ],
    );

  const selectedAudioCategory =
    useMemo(
      () =>
        audioCategories.find(
          (category) =>
            category.id ===
            audioCategoryId,
        ) ?? null,
      [
        audioCategories,
        audioCategoryId,
      ],
    );

  const categoryVideoItems =
    useMemo(() => {
      if (!videoCategoryId) {
        return [];
      }

      const ids = new Set(
        categoryMedia
          .filter(
            (item) =>
              item.category_id ===
              videoCategoryId,
          )
          .map(
            (item) =>
              item.media_id,
          ),
      );

      return videos.filter(
        (video) =>
          ids.has(video.id),
      );
    }, [
      videoCategoryId,
      categoryMedia,
      videos,
    ]);

  const categoryAudioItems =
    useMemo(() => {
      if (!audioCategoryId) {
        return [];
      }

      const ids = new Set(
        categoryMedia
          .filter(
            (item) =>
              item.category_id ===
              audioCategoryId,
          )
          .map(
            (item) =>
              item.media_id,
          ),
      );

      return audioMedia.filter(
        (audio) =>
          ids.has(audio.id),
      );
    }, [
      audioCategoryId,
      categoryMedia,
      audioMedia,
    ]);

  const categoryTextItems =
    useMemo(() => {
      if (!textCategoryId) {
        return [];
      }

      return textItems.filter(
        (item) =>
          item.category_id ===
          textCategoryId,
      );
    }, [
      textCategoryId,
      textItems,
    ]);

  const availableTemplates =
    useMemo(
      () =>
        templates.filter(
          (template) =>
            template.id !==
            selectedTemplate,
        ),
      [
        templates,
        selectedTemplate,
      ],
    );

  const activeTemplatePool =
    useMemo(() => {
      const pool = templates.filter(
        (template) =>
          templatePoolIds.includes(
            template.id,
          ),
      );

      return pool.length > 0
        ? pool
        : templates.filter(
            (template) =>
              template.id ===
              selectedTemplate,
          );
    }, [
      templates,
      templatePoolIds,
      selectedTemplate,
    ]);

  const categoryCombinationCount =
    categoryVideoItems.length *
    categoryTextItems.length *
    categoryAudioItems.length;

  const generatedCount =
    generatedCombinations.length;

  const canGenerate =
    categoryVideoItems.length > 0 &&
    categoryTextItems.length > 0 &&
    categoryAudioItems.length > 0 &&
    activeTemplatePool.length > 0;

  const loadVideos = async (
    database: Database,
  ) => {
    const loaded =
      await database.select<
        MediaItem[]
      >(
        `
          SELECT
            id,
            name,
            path,
            media_type,
            size,
            created_at
          FROM media
          WHERE media_type = 'video'
          ORDER BY created_at DESC
        `,
      );

    setVideos(loaded);
  };

  const loadAudio = async (
    database: Database,
  ) => {
    const loaded =
      await database.select<
        MediaItem[]
      >(
        `
          SELECT
            id,
            name,
            path,
            media_type,
            size,
            created_at
          FROM media
          WHERE media_type = 'audio'
          ORDER BY created_at DESC
        `,
      );

    setAudioMedia(loaded);
  };

  const loadTemplates = async (
    database: Database,
  ) => {
    const loaded =
      await database.select<
        TemplateItem[]
      >(
        `
          SELECT
            id,
            name,
            layers_json,
            width,
            height
          FROM templates
          ORDER BY name COLLATE NOCASE ASC
        `,
      );

    setTemplates(loaded);
  };

  const loadLibrary = async (
    database: Database,
  ) => {
    const loadedCategories =
      await database.select<
        Category[]
      >(
        `
          SELECT
            id,
            name,
            category_type,
            created_at,
            updated_at
          FROM library_categories
          ORDER BY name COLLATE NOCASE ASC
        `,
      );

    const loadedCategoryMedia =
      await database.select<
        CategoryMedia[]
      >(
        `
          SELECT
            category_id,
            media_id
          FROM library_category_media
        `,
      );

    const loadedText =
      await database.select<
        TextItem[]
      >(
        `
          SELECT
            id,
            category_id,
            text,
            created_at,
            updated_at
          FROM library_text_items
          ORDER BY created_at DESC
        `,
      );

    setCategories(
      loadedCategories,
    );

    setCategoryMedia(
      loadedCategoryMedia,
    );

    setTextItems(
      loadedText,
    );

    if (
      !videoCategoryId
    ) {
      setVideoCategoryId(
        loadedCategories.find(
          (category) =>
            category.category_type ===
            "video",
        )?.id ?? "",
      );
    }

    if (
      !textCategoryId
    ) {
      setTextCategoryId(
        loadedCategories.find(
          (category) =>
            category.category_type ===
            "text",
        )?.id ?? "",
      );
    }

    if (
      !audioCategoryId
    ) {
      setAudioCategoryId(
        loadedCategories.find(
          (category) =>
            category.category_type ===
            "audio",
        )?.id ?? "",
      );
    }
  };

  const loadTemplateLayers =
    async (
      database: Database,
      templateId: string,
    ) => {
      const rows =
        await database.select<
          TemplateItem[]
        >(
          `
            SELECT
              id,
              name,
              layers_json,
              width,
              height
            FROM templates
            WHERE id = ?
            LIMIT 1
          `,
          [templateId],
        );

      if (rows.length === 0) {
        setTemplateDocument(
          EMPTY_TEMPLATE_DOCUMENT,
        );
        return EMPTY_TEMPLATE_DOCUMENT;
      }

      const document =
        parseTemplateDocument(
          rows[0].layers_json,
        );

      setTemplateDocument(
        document,
      );

      return document;
    };

  const loadRenders = async (
    database: Database,
  ) => {
    try {
      const loaded =
        await invoke<
          RenderedVideo[]
        >(
          "list_rendered_videos",
        );

      setRendered(
        loaded ?? [],
      );
    } catch {
      setRendered([]);
    }
  };

  const loadProject = async (
    database: Database,
    savedProjectId: string,
  ) => {
    const rows =
      await database.select<
        ProjectRow[]
      >(
        `
          SELECT
            id,
            name,
            source_media_id,
            template_id,
            width,
            height,
            status,
            settings_json,
            created_at,
            updated_at
          FROM projects
          WHERE id = ?
          LIMIT 1
        `,
        [savedProjectId],
      );

    if (rows.length === 0) {
      return;
    }

    const project =
      rows[0];

    setProjectId(
      project.id,
    );

    setProjectName(
      project.name,
    );

    if (
      project.source_media_id
    ) {
      const source =
        videos.find(
          (video) =>
            video.id ===
            project.source_media_id,
        );

      if (source) {
        setSelectedVideo(
          source,
        );
      }
    }

    if (
      project.template_id
    ) {
      setSelectedTemplate(
        project.template_id,
      );

      await loadTemplateLayers(
        database,
        project.template_id,
      );
    }

    try {
      const settings =
        JSON.parse(
          project.settings_json ||
            "{}",
        ) as Partial<ProjectSettings>;

      if (
        settings.mode
      ) {
        setMode(
          settings.mode,
        );
      }

      if (
        typeof settings.variationCount ===
        "number"
      ) {
        setVariationCount(
          settings.variationCount,
        );
      }

      if (
        settings.clipLength
      ) {
        setClipLength(
          settings.clipLength,
        );
      }

      if (
        typeof settings.originalAudio ===
        "number"
      ) {
        setOriginalAudio(
          settings.originalAudio,
        );
      }

      if (
        typeof settings.muteOriginalAudio ===
        "boolean"
      ) {
        setMuteOriginalAudio(
          settings.muteOriginalAudio,
        );
      }

      setAddedAudioPath(
        settings.addedAudioPath ??
          null,
      );

      setAddedAudioName(
        settings.addedAudioName ??
          null,
      );

      if (
        Array.isArray(
          settings.variations,
        )
      ) {
        setVariations(
          settings.variations,
        );
      }

      if (
        settings.videoCategoryId
      ) {
        setVideoCategoryId(
          settings.videoCategoryId,
        );
      }

      if (
        settings.textCategoryId
      ) {
        setTextCategoryId(
          settings.textCategoryId,
        );
      }

      if (
        settings.audioCategoryId
      ) {
        setAudioCategoryId(
          settings.audioCategoryId,
        );
      }

      if (
        typeof settings.randomizeTemplate ===
        "boolean"
      ) {
        setRandomizeTemplate(
          settings.randomizeTemplate,
        );
      }

      if (
        Array.isArray(
          settings.templatePoolIds,
        )
      ) {
        setTemplatePoolIds(
          settings.templatePoolIds,
        );
      }
    } catch {
      // Keep defaults if older project settings cannot be parsed.
    }
  };

  const initializeDatabase =
    async () => {
      const database =
        await Database.load(
          "sqlite:content-studio.db",
        );

      await database.execute(`
        CREATE TABLE IF NOT EXISTS library_categories (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          category_type TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      await database.execute(`
        CREATE TABLE IF NOT EXISTS library_category_media (
          category_id TEXT NOT NULL,
          media_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (category_id, media_id)
        );
      `);

      await database.execute(`
        CREATE TABLE IF NOT EXISTS library_text_items (
          id TEXT PRIMARY KEY NOT NULL,
          category_id TEXT NOT NULL,
          text TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      return database;
    };

  useEffect(() => {
    let mounted = true;

    const start =
      async () => {
        try {
          setLoading(true);
          setError(null);

          const database =
            await initializeDatabase();

          if (!mounted) {
            return;
          }

          setDb(database);

          await Promise.all([
            loadVideos(
              database,
            ),
            loadAudio(
              database,
            ),
            loadTemplates(
              database,
            ),
            loadLibrary(
              database,
            ),
            loadRenders(
              database,
            ),
          ]);

          const savedProjectId =
            sessionStorage.getItem(
              "content-studio-project-id",
            );

          if (
            savedProjectId
          ) {
            await loadProject(
              database,
              savedProjectId,
            );
          }
        } catch (err) {
          console.error(
            "Unable to initialize Create page:",
            err,
          );

          if (mounted) {
            setError(
              "Unable to load the Create page.",
            );
          }
        } finally {
          if (mounted) {
            setLoading(false);
          }
        }
      };

    start();

    const handleOpenCreate =
      () => {
        sessionStorage.removeItem(
          "content-studio-project-id",
        );

        setProjectId(null);
        setProjectName(
          "Untitled Project",
        );
        setGeneratedCombinations(
          [],
        );
      };

    const handleNewCreate =
      () => {
        sessionStorage.removeItem(
          "content-studio-project-id",
        );

        setProjectId(null);
        setProjectName(
          "Untitled Project",
        );
        setGeneratedCombinations(
          [],
        );
      };

    window.addEventListener(
      "content-studio-open-create",
      handleOpenCreate,
    );

    window.addEventListener(
      "content-studio-new-create",
      handleNewCreate,
    );

    return () => {
      mounted = false;

      window.removeEventListener(
        "content-studio-open-create",
        handleOpenCreate,
      );

      window.removeEventListener(
        "content-studio-new-create",
        handleNewCreate,
      );
    };
  }, []);

  useEffect(() => {
    if (
      !selectedTemplate ||
      selectedTemplate ===
        "No template" ||
      !db
    ) {
      setTemplateDocument(
        EMPTY_TEMPLATE_DOCUMENT,
      );
      return;
    }

    loadTemplateLayers(
      db,
      selectedTemplate,
    );
  }, [
    selectedTemplate,
    db,
  ]);

  useEffect(() => {
    if (
      variationCount < 1
    ) {
      return;
    }

    setVariations(
      (current) => {
        const next =
          [...current];

        while (
          next.length <
          variationCount
        ) {
          next.push("");
        }

        return next.slice(
          0,
          variationCount,
        );
      },
    );
  }, [
    variationCount,
  ]);

  useEffect(() => {
    if (
      !randomizeTemplate &&
      selectedTemplate !==
        "No template"
    ) {
      setTemplatePoolIds([
        selectedTemplate,
      ]);
    }
  }, [
    randomizeTemplate,
    selectedTemplate,
  ]);

  const selectTemplate =
    async (
      templateId: string,
    ) => {
      setSelectedTemplate(
        templateId,
      );

      if (
        !randomizeTemplate
      ) {
        setTemplatePoolIds([
          templateId,
        ]);
      }

      if (
        db &&
        templateId &&
        templateId !==
          "No template"
      ) {
        await loadTemplateLayers(
          db,
          templateId,
        );
      }
    };

  const toggleTemplateInPool =
    (
      templateId: string,
    ) => {
      setTemplatePoolIds(
        (current) => {
          if (
            current.includes(
              templateId,
            )
          ) {
            if (
              current.length ===
              1
            ) {
              return current;
            }

            return current.filter(
              (id) =>
                id !==
                templateId,
            );
          }

          return [
            ...current,
            templateId,
          ];
        },
      );
    };

  const importVideo =
    async () => {
      try {
        setError(null);

        const selected =
          await open({
            multiple: false,
            directory: false,
            filters: [
              {
                name: "Video",
                extensions: [
                  "mp4",
                  "mov",
                  "m4v",
                  "avi",
                  "mkv",
                  "webm",
                ],
              },
            ],
          });

        if (
          !selected ||
          Array.isArray(
            selected,
          )
        ) {
          return;
        }

        const imported =
          await invoke<MediaItem>(
            "import_media",
            {
              sourcePath:
                selected,
            },
          );

        setVideos(
          (current) => [
            imported,
            ...current.filter(
              (item) =>
                item.id !==
                imported.id,
            ),
          ],
        );

        setSelectedVideo(
          imported,
        );

        setMessage(
          "Video imported successfully.",
        );
      } catch (err) {
        console.error(
          "Unable to import video:",
          err,
        );

        setError(
          "Unable to import that video.",
        );
      }
    };

  const selectAudio =
    async () => {
      try {
        setError(null);

        const selected =
          await open({
            multiple: false,
            directory: false,
            filters: [
              {
                name: "Audio",
                extensions: [
                  "mp3",
                  "wav",
                  "m4a",
                  "aac",
                  "flac",
                ],
              },
            ],
          });

        if (
          !selected ||
          Array.isArray(
            selected,
          )
        ) {
          return;
        }

        const imported =
          await invoke<MediaItem>(
            "import_media",
            {
              sourcePath:
                selected,
            },
          );

        setAudioMedia(
          (current) => [
            imported,
            ...current.filter(
              (item) =>
                item.id !==
                imported.id,
            ),
          ],
        );

        setAddedAudioPath(
          imported.path,
        );

        setAddedAudioName(
          imported.name,
        );

        setMessage(
          "Audio added.",
        );
      } catch (err) {
        console.error(
          "Unable to import audio:",
          err,
        );

        setError(
          "Unable to import that audio file.",
        );
      }
    };

  const removeAudio =
    () => {
      setAddedAudioPath(
        null,
      );

      setAddedAudioName(
        null,
      );
    };

  const generateCombinations =
    () => {
      setError(null);
      setMessage(null);

      if (
        categoryVideoItems.length ===
        0
      ) {
        setError(
          "The selected video category has no videos.",
        );
        return;
      }

      if (
        categoryTextItems.length ===
        0
      ) {
        setError(
          "The selected text category has no text.",
        );
        return;
      }

      if (
        categoryAudioItems.length ===
        0
      ) {
        setError(
          "The selected audio category has no audio.",
        );
        return;
      }

      if (
        activeTemplatePool.length ===
        0
      ) {
        setError(
          "Select at least one template.",
        );
        return;
      }

      const requestedCount =
        clamp(
          Number(
            variationCount,
          ),
          1,
          500,
        );

      const videoPool =
        shuffle(
          categoryVideoItems,
        );

      const textPool =
        shuffle(
          categoryTextItems,
        );

      const audioPool =
        shuffle(
          categoryAudioItems,
        );

      const templatePool =
        shuffle(
          activeTemplatePool,
        );

      const allCombinations: {
        video: MediaItem;
        text: TextItem;
        audio: MediaItem;
        template: TemplateItem;
      }[] = [];

      for (
        const video of videoPool
      ) {
        for (
          const text of textPool
        ) {
          for (
            const audio of audioPool
          ) {
            for (
              const template of templatePool
            ) {
              allCombinations.push({
                video,
                text,
                audio,
                template,
              });
            }
          }
        }
      }

      const shuffled =
        shuffle(
          allCombinations,
        );

      const chosen =
        shuffled.slice(
          0,
          Math.min(
            requestedCount,
            shuffled.length,
          ),
        );

      if (
        chosen.length <
        requestedCount
      ) {
        const uniqueCount =
          chosen.length;

        while (
          chosen.length <
          requestedCount
        ) {
          chosen.push(
            shuffled[
              chosen.length %
                Math.max(
                  uniqueCount,
                  1,
                )
            ],
          );
        }
      }

      const combinations =
        chosen.map(
          (
            combination,
            index,
          ) => {
            const document =
              parseTemplateDocument(
                combination
                  .template
                  .layers_json,
              );

            return {
              variationId:
                index + 1,
              video:
                combination.video,
              text:
                combination.text,
              audio:
                combination.audio,
              template:
                combination.template,
              templateDocument:
                document,
            };
          },
        );

      setGeneratedCombinations(
        combinations,
      );

      setVariations(
        combinations.map(
          (combination) =>
            combination.text
              .text,
        ),
      );

      if (
        combinations.length >
        0
      ) {
        setSelectedVideo(
          combinations[0].video,
        );

        if (
          !randomizeTemplate
        ) {
          setSelectedTemplate(
            combinations[0]
              .template.id,
          );

          setTemplateDocument(
            combinations[0]
              .templateDocument,
          );
        }
      }

      setMessage(
        `${combinations.length} video combinations generated.`,
      );
    };

  const saveProject =
    async () => {
      if (!db) {
        return null;
      }

      if (
        !projectName.trim()
      ) {
        setError(
          "Give the project a name first.",
        );
        return null;
      }

      const id =
        projectId ??
        createId(
          "project",
        );

      const timestamp =
        now();

      const cleanedVariations =
        variations
          .slice(
            0,
            variationCount,
          )
          .map(
            (value) =>
              value.trim(),
          );

      const generatedSettings =
        generatedCombinations.map(
          (combination) => ({
            variationId:
              combination.variationId,
            videoId:
              combination.video.id,
            textId:
              combination.text.id,
            audioId:
              combination.audio.id,
            templateId:
              combination.template.id,
          }),
        );

      const settings: ProjectSettings =
        {
          mode,
          variationCount,
          clipLength,
          originalAudio,
          muteOriginalAudio,
          addedAudioPath,
          addedAudioName,
          variations:
            cleanedVariations,
          videoCategoryId:
            videoCategoryId ||
            null,
          textCategoryId:
            textCategoryId ||
            null,
          audioCategoryId:
            audioCategoryId ||
            null,
          randomizeTemplate,
          templatePoolIds,
          generatedCombinations:
            generatedSettings,
        };

      const sourceMediaId =
        generatedCombinations[0]
          ?.video.id ??
        selectedVideo?.id ??
        null;

      const templateId =
        !randomizeTemplate &&
        selectedTemplate !==
          "No template"
          ? selectedTemplate
          : null;

      try {
        setSaving(true);
        setError(null);

        if (projectId) {
          await db.execute(
            `
              UPDATE projects
              SET
                name = ?,
                source_media_id = ?,
                template_id = ?,
                width = ?,
                height = ?,
                status = ?,
                settings_json = ?,
                updated_at = ?
              WHERE id = ?
            `,
            [
              projectName.trim(),
              sourceMediaId,
              templateId,
              1080,
              1920,
              "draft",
              JSON.stringify(
                settings,
              ),
              timestamp,
              id,
            ],
          );
        } else {
          await db.execute(
            `
              INSERT INTO projects (
                id,
                name,
                source_media_id,
                template_id,
                width,
                height,
                status,
                settings_json,
                created_at,
                updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
              id,
              projectName.trim(),
              sourceMediaId,
              templateId,
              1080,
              1920,
              "draft",
              JSON.stringify(
                settings,
              ),
              timestamp,
              timestamp,
            ],
          );
        }

        setProjectId(id);

        sessionStorage.setItem(
          "content-studio-project-id",
          id,
        );

        setMessage(
          projectId
            ? "Project updated."
            : "Project saved.",
        );

        return id;
      } catch (err) {
        console.error(
          "Unable to save project:",
          err,
        );

        setError(
          "Unable to save this project.",
        );

        return null;
      } finally {
        setSaving(false);
      }
    };

  const renderProject =
    async () => {
      setError(null);
      setMessage(null);

      const validClipLength =
        Number(
          clipLength,
        );

      if (
        !Number.isFinite(
          validClipLength,
        ) ||
        validClipLength <= 0
      ) {
        setError(
          "Clip length must be greater than zero.",
        );
        return;
      }

      if (
        selectedTemplate ===
          "No template" &&
        !randomizeTemplate
      ) {
        setError(
          "Select a template first.",
        );
        return;
      }

      if (
        generatedCombinations.length ===
        0
      ) {
        generateCombinations();

        setError(
          "Generate the video combinations first, then click Render All.",
        );

        return;
      }

      const project =
        await saveProject();

      if (!project) {
        return;
      }

      try {
        setRendering(true);
        setRenderProgress(0);

        const jobs: RenderJob[] =
          generatedCombinations.map(
            (
              combination,
              index,
            ) => {
              const outputPath =
                "";

              return {
                project_id:
                  project,
                variation_id:
                  combination.variationId,
                variation_text:
                  combination.text
                    .text,
                source_path:
                  combination.video
                    .path,
                template_layers_json:
                  JSON.stringify(
                    combination
                      .templateDocument,
                  ),
                output_width: 1080,
                output_height: 1920,
                fps: 30,
                bitrate: "8M",
                clip_length:
                  validClipLength,
                original_audio:
                  originalAudio /
                  100,
                mute_original_audio:
                  muteOriginalAudio,
                added_audio_path:
                  combination.audio
                    ?.path ??
                  null,
                output_path:
                  outputPath ||
                  renderFileName(
                    projectName,
                    index + 1,
                  ),
              };
            },
          );

        const result =
          await invoke<
            RenderedVideo[]
          >(
            "render_batch",
            {
              jobs,
            },
          );

        setRendered(
          (current) => [
            ...result,
            ...current.filter(
              (existing) =>
                !result.some(
                  (item) =>
                    item.id ===
                    existing.id,
                ),
            ),
          ],
        );

        setRenderProgress(
          100,
        );

        setMessage(
          `${result.length} video${result.length === 1 ? "" : "s"} rendered successfully.`,
        );
      } catch (err) {
        console.error(
          "Unable to render project:",
          err,
        );

        setError(
          typeof err === "string"
            ? err
            : "Unable to render the videos.",
        );
      } finally {
        setRendering(false);
      }
    };

  const updateVariation =
    (
      index: number,
      value: string,
    ) => {
      setVariations(
        (current) => {
          const next =
            [...current];

          next[index] =
            value;

          return next;
        },
      );

      setGeneratedCombinations(
        (current) =>
          current.map(
            (
              combination,
            ) =>
              combination
                .variationId ===
              index + 1
                ? {
                    ...combination,
                    text: {
                      ...combination.text,
                      text: value,
                    },
                  }
                : combination,
          ),
      );
    };

  const useManualText =
    () => {
      if (
        generatedCombinations.length ===
        0
      ) {
        return;
      }

      setGeneratedCombinations(
        (current) =>
          current.map(
            (
              combination,
              index,
            ) => ({
              ...combination,
              text: {
                ...combination.text,
                text:
                  variations[
                    index
                  ] ??
                  combination.text
                    .text,
              },
            }),
          ),
      );

      setMessage(
        "Your edited text has been applied to the generated batch.",
      );
    };

  const previewCombination =
    generatedCombinations[0];

  const previewDocument =
    previewCombination
      ?.templateDocument ??
    templateDocument;

  const previewVariation =
    previewCombination
      ?.text.text ??
    variations[0] ??
    "";

  const previewLayers =
    previewDocument.layers;

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <p className="eyebrow">
              CONTENT CREATION
            </p>

            <h1>Create Content</h1>

            <p className="page-description">
              Loading your content
              library...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">
            CONTENT CREATION
          </p>

          <h1>
            {projectId
              ? "Edit Project"
              : "Create Content"}
          </h1>

          <p className="page-description">
            Choose your categories,
            template, and number of
            videos. Content Studio
            will build the combinations
            for you.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="secondary-button"
            onClick={
              saveProject
            }
            disabled={saving}
          >
            {saving
              ? "Saving..."
              : projectId
                ? "Update Project"
                : "Save Project"}
          </button>

          <button
            type="button"
            className="primary-button"
            onClick={
              renderProject
            }
            disabled={
              rendering ||
              saving
            }
          >
            {rendering
              ? `Rendering ${renderProgress}%`
              : "Render All"}
          </button>
        </div>
      </div>

      {message && (
        <div
          style={{
            marginBottom: 18,
            padding: "12px 14px",
            borderRadius: 10,
            background:
              "rgba(100, 180, 120, 0.10)",
            border:
              "1px solid rgba(100, 180, 120, 0.25)",
            color: "#a7e0b2",
            fontSize: 13,
          }}
        >
          {message}
        </div>
      )}

      {error && (
        <div
          style={{
            marginBottom: 18,
            padding: "12px 14px",
            borderRadius: 10,
            background:
              "rgba(220, 80, 80, 0.12)",
            border:
              "1px solid rgba(220, 80, 80, 0.28)",
            color: "#ff9b9b",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(0, 1fr) 360px",
          gap: 20,
          alignItems: "start",
        }}
      >
        <div
          style={{
            display: "grid",
            gap: 20,
          }}
        >
          <section className="feature-card">
            <div className="eyebrow">
              PROJECT
            </div>

            <h2
              style={{
                margin:
                  "5px 0 16px",
              }}
            >
              Project Details
            </h2>

            <div
              style={{
                display: "grid",
                gap: 14,
              }}
            >
              <div>
                <label className="form-label">
                  Project Name
                </label>

                <input
                  value={projectName}
                  onChange={(event) =>
                    setProjectName(
                      event.target
                        .value,
                    )
                  }
                  className="form-input"
                  placeholder="Example: Motivation Batch"
                />
              </div>

              <div>
                <label className="form-label">
                  Creation Mode
                </label>

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                  }}
                >
                  <button
                    type="button"
                    className={
                      mode ===
                      "batch"
                        ? "primary-button"
                        : "secondary-button"
                    }
                    onClick={() =>
                      setMode(
                        "batch",
                      )
                    }
                  >
                    Category Batch
                  </button>

                  <button
                    type="button"
                    className={
                      mode ===
                      "single"
                        ? "primary-button"
                        : "secondary-button"
                    }
                    onClick={() =>
                      setMode(
                        "single",
                      )
                    }
                  >
                    Single
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="feature-card">
            <div className="eyebrow">
              AUTOMATIC COMBINATIONS
            </div>

            <h2
              style={{
                margin:
                  "5px 0 8px",
              }}
            >
              Build Your Batch
            </h2>

            <p
              className="muted"
              style={{
                margin:
                  "0 0 20px",
                lineHeight: 1.6,
              }}
            >
              Choose one category for
              each type. Content Studio
              will randomly combine the
              videos, text, and audio.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(3, minmax(0, 1fr))",
                gap: 12,
              }}
            >
              <div>
                <label className="form-label">
                  Video Category
                </label>

                <select
                  className="form-input"
                  value={
                    videoCategoryId
                  }
                  onChange={(event) =>
                    setVideoCategoryId(
                      event.target
                        .value,
                    )
                  }
                >
                  <option value="">
                    Choose video category
                  </option>

                  {videoCategories.map(
                    (
                      category,
                    ) => (
                      <option
                        key={
                          category.id
                        }
                        value={
                          category.id
                        }
                      >
                        {
                          category.name
                        }
                      </option>
                    ),
                  )}
                </select>

                <div
                  className="muted"
                  style={{
                    fontSize: 11,
                    marginTop: 6,
                  }}
                >
                  {
                    categoryVideoItems.length
                  }{" "}
                  videos available
                </div>
              </div>

              <div>
                <label className="form-label">
                  Text Category
                </label>

                <select
                  className="form-input"
                  value={
                    textCategoryId
                  }
                  onChange={(event) =>
                    setTextCategoryId(
                      event.target
                        .value,
                    )
                  }
                >
                  <option value="">
                    Choose text category
                  </option>

                  {textCategories.map(
                    (
                      category,
                    ) => (
                      <option
                        key={
                          category.id
                        }
                        value={
                          category.id
                        }
                      >
                        {
                          category.name
                        }
                      </option>
                    ),
                  )}
                </select>

                <div
                  className="muted"
                  style={{
                    fontSize: 11,
                    marginTop: 6,
                  }}
                >
                  {
                    categoryTextItems.length
                  }{" "}
                  text items available
                </div>
              </div>

              <div>
                <label className="form-label">
                  Audio Category
                </label>

                <select
                  className="form-input"
                  value={
                    audioCategoryId
                  }
                  onChange={(event) =>
                    setAudioCategoryId(
                      event.target
                        .value,
                    )
                  }
                >
                  <option value="">
                    Choose audio category
                  </option>

                  {audioCategories.map(
                    (
                      category,
                    ) => (
                      <option
                        key={
                          category.id
                        }
                        value={
                          category.id
                        }
                      >
                        {
                          category.name
                        }
                      </option>
                    ),
                  )}
                </select>

                <div
                  className="muted"
                  style={{
                    fontSize: 11,
                    marginTop: 6,
                  }}
                >
                  {
                    categoryAudioItems.length
                  }{" "}
                  audio tracks available
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 18,
                padding: 14,
                borderRadius: 10,
                background:
                  "rgba(255,255,255,0.025)",
                border:
                  "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent:
                    "space-between",
                  alignItems: "center",
                  gap: 15,
                }}
              >
                <div>
                  <div
                    style={{
                      color:
                        "#e5e5e9",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    Available combinations
                  </div>

                  <div
                    className="muted"
                    style={{
                      fontSize: 11,
                      marginTop: 4,
                    }}
                  >
                    {
                      categoryVideoItems.length
                    }{" "}
                    ×{" "}
                    {
                      categoryTextItems.length
                    }{" "}
                    ×{" "}
                    {
                      categoryAudioItems.length
                    }{" "}
                    ={" "}
                    {categoryCombinationCount.toLocaleString()}{" "}
                    possible combinations
                  </div>
                </div>

                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    color:
                      "#ffffff",
                  }}
                >
                  {categoryCombinationCount.toLocaleString()}
                </div>
              </div>
            </div>
          </section>

          <section className="feature-card">
            <div className="eyebrow">
              TEMPLATE
            </div>

            <h2
              style={{
                margin:
                  "5px 0 8px",
              }}
            >
              Choose Your Template
            </h2>

            <p
              className="muted"
              style={{
                margin:
                  "0 0 16px",
                lineHeight: 1.6,
              }}
            >
              The template stays the same
              for the entire batch unless
              you turn on template
              randomization.
            </p>

            <select
              className="form-input"
              value={
                selectedTemplate
              }
              onChange={(event) =>
                selectTemplate(
                  event.target
                    .value,
                )
              }
            >
              <option value="No template">
                Choose a template
              </option>

              {templates.map(
                (template) => (
                  <option
                    key={
                      template.id
                    }
                    value={
                      template.id
                    }
                  >
                    {
                      template.name
                    }
                  </option>
                ),
              )}
            </select>

            <label
              style={{
                display: "flex",
                alignItems:
                  "flex-start",
                gap: 10,
                marginTop: 16,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={
                  randomizeTemplate
                }
                onChange={(event) =>
                  setRandomizeTemplate(
                    event.target
                      .checked,
                  )
                }
                style={{
                  marginTop: 3,
                }}
              />

              <span>
                <strong
                  style={{
                    color:
                      "#ffffff",
                    fontSize: 13,
                  }}
                >
                  Randomize templates
                </strong>

                <span
                  className="muted"
                  style={{
                    display:
                      "block",
                    fontSize: 11,
                    marginTop: 3,
                    lineHeight:
                      1.5,
                  }}
                >
                  Off = use the selected
                  template for every
                  video.
                  <br />
                  On = randomly choose
                  from the template pool
                  below.
                </span>
              </span>
            </label>

            {randomizeTemplate && (
              <div
                style={{
                  marginTop: 16,
                  display: "grid",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color:
                      "#d8d8dd",
                  }}
                >
                  Template Pool
                </div>

                {templates.length ===
                0 ? (
                  <div
                    className="muted"
                    style={{
                      fontSize: 12,
                    }}
                  >
                    Create templates
                    first.
                  </div>
                ) : (
                  templates.map(
                    (
                      template,
                    ) => {
                      const checked =
                        templatePoolIds.includes(
                          template.id,
                        );

                      return (
                        <label
                          key={
                            template.id
                          }
                          style={{
                            display:
                              "flex",
                            alignItems:
                              "center",
                            gap: 10,
                            padding:
                              "9px 11px",
                            borderRadius:
                              8,
                            background:
                              checked
                                ? "rgba(255,255,255,0.07)"
                                : "rgba(255,255,255,0.025)",
                            border:
                              "1px solid rgba(255,255,255,0.06)",
                            cursor:
                              "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={
                              checked
                            }
                            onChange={() =>
                              toggleTemplateInPool(
                                template.id,
                              )
                            }
                          />

                          <span
                            style={{
                              color:
                                "#ddddE2",
                              fontSize:
                                12,
                            }}
                          >
                            {
                              template.name
                            }
                          </span>
                        </label>
                      );
                    },
                  )
                )}
              </div>
            )}
          </section>

          <section className="feature-card">
            <div className="eyebrow">
              OUTPUT
            </div>

            <h2
              style={{
                margin:
                  "5px 0 16px",
              }}
            >
              Output Settings
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(3, minmax(0, 1fr))",
                gap: 14,
              }}
            >
              <div>
                <label className="form-label">
                  Number of Videos
                </label>

                <input
                  type="number"
                  min={1}
                  max={500}
                  value={
                    variationCount
                  }
                  onChange={(event) =>
                    setVariationCount(
                      clamp(
                        Number(
                          event.target
                            .value,
                        ) || 1,
                        1,
                        500,
                      ),
                    )
                  }
                  className="form-input"
                />
              </div>

              <div>
                <label className="form-label">
                  Clip Length
                </label>

                <input
                  type="number"
                  min={1}
                  step="1"
                  value={
                    clipLength
                  }
                  onChange={(event) =>
                    setClipLength(
                      event.target
                        .value,
                    )
                  }
                  className="form-input"
                />

                <div
                  className="muted"
                  style={{
                    fontSize: 10,
                    marginTop: 5,
                  }}
                >
                  seconds
                </div>
              </div>

              <div>
                <label className="form-label">
                  Original Video Audio
                </label>

                <input
                  type="range"
                  min={0}
                  max={100}
                  value={
                    originalAudio
                  }
                  onChange={(event) =>
                    setOriginalAudio(
                      Number(
                        event.target
                          .value,
                      ),
                    )
                  }
                  style={{
                    width:
                      "100%",
                    marginTop: 10,
                  }}
                />

                <div
                  style={{
                    display:
                      "flex",
                    justifyContent:
                      "space-between",
                    fontSize: 11,
                    marginTop: 4,
                  }}
                >
                  <span className="muted">
                    0%
                  </span>

                  <span
                    style={{
                      color:
                        "#ffffff",
                      fontWeight:
                        700,
                    }}
                  >
                    {
                      originalAudio
                    }
                    %
                  </span>

                  <span className="muted">
                    100%
                  </span>
                </div>
              </div>
            </div>

            <label
              style={{
                display: "flex",
                alignItems:
                  "center",
                gap: 9,
                marginTop: 18,
                cursor:
                  "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={
                  muteOriginalAudio
                }
                onChange={(event) =>
                  setMuteOriginalAudio(
                    event.target
                      .checked,
                  )
                }
              />

              <span
                style={{
                  color:
                    "#d7d7dc",
                  fontSize: 12,
                }}
              >
                Mute original video
                audio
              </span>
            </label>

            <div
              style={{
                marginTop: 18,
                display: "flex",
                alignItems:
                  "center",
                justifyContent:
                  "space-between",
                gap: 15,
                padding: 12,
                borderRadius: 9,
                background:
                  "rgba(255,255,255,0.025)",
                border:
                  "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div>
                <div
                  style={{
                    color:
                      "#dcdce1",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  Manual Audio
                  Override
                </div>

                <div
                  className="muted"
                  style={{
                    fontSize: 10,
                    marginTop: 3,
                  }}
                >
                  Optional. Category
                  audio is used when
                  this is empty.
                </div>
              </div>

              {addedAudioName ? (
                <div
                  style={{
                    display:
                      "flex",
                    alignItems:
                      "center",
                    gap: 10,
                  }}
                >
                  <span
                    style={{
                      color:
                        "#ffffff",
                      fontSize: 11,
                      maxWidth:
                        180,
                      overflow:
                        "hidden",
                      textOverflow:
                        "ellipsis",
                      whiteSpace:
                        "nowrap",
                    }}
                  >
                    {
                      addedAudioName
                    }
                  </span>

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={
                      removeAudio
                    }
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    setShowAudioPicker(
                      true,
                    )
                  }
                >
                  Add Audio
                </button>
              )}
            </div>
          </section>

          <section className="feature-card">
            <div
              style={{
                display:
                  "flex",
                alignItems:
                  "flex-start",
                justifyContent:
                  "space-between",
                gap: 15,
                marginBottom: 15,
              }}
            >
              <div>
                <div className="eyebrow">
                  GENERATED BATCH
                </div>

                <h2
                  style={{
                    margin:
                      "5px 0 7px",
                  }}
                >
                  Your Combinations
                </h2>

                <p
                  className="muted"
                  style={{
                    margin: 0,
                    fontSize: 12,
                  }}
                >
                  Each row is one unique
                  video combination.
                </p>
              </div>

              <button
                type="button"
                className="primary-button"
                onClick={
                  generateCombinations
                }
                disabled={
                  !canGenerate
                }
              >
                Generate{" "}
                {
                  variationCount
                }{" "}
                Videos
              </button>
            </div>

            {generatedCombinations.length ===
            0 ? (
              <div
                style={{
                  padding:
                    "40px 20px",
                  textAlign:
                    "center",
                  borderRadius: 10,
                  background:
                    "rgba(255,255,255,0.02)",
                  border:
                    "1px dashed rgba(255,255,255,0.09)",
                }}
              >
                <div
                  style={{
                    fontSize: 30,
                    marginBottom: 10,
                  }}
                >
                  ✦
                </div>

                <div
                  style={{
                    color:
                      "#ddddE2",
                    fontWeight:
                      700,
                    fontSize: 14,
                  }}
                >
                  Nothing generated yet
                </div>

                <div
                  className="muted"
                  style={{
                    fontSize: 12,
                    marginTop: 6,
                  }}
                >
                  Choose your three
                  categories and
                  template, then click
                  Generate.
                </div>
              </div>
            ) : (
              <div
                style={{
                  display:
                    "grid",
                  gap: 8,
                  maxHeight:
                    520,
                  overflowY:
                    "auto",
                }}
              >
                {generatedCombinations.map(
                  (
                    combination,
                    index,
                  ) => (
                    <div
                      key={`${combination.variationId}-${combination.video.id}-${combination.text.id}-${combination.audio.id}`}
                      style={{
                        display:
                          "grid",
                        gridTemplateColumns:
                          "38px minmax(120px, 1fr) minmax(160px, 1.5fr) minmax(120px, 1fr) minmax(120px, 1fr)",
                        gap: 10,
                        alignItems:
                          "center",
                        padding:
                          "10px 11px",
                        borderRadius:
                          9,
                        background:
                          "rgba(255,255,255,0.025)",
                        border:
                          "1px solid rgba(255,255,255,0.055)",
                      }}
                    >
                      <div
                        style={{
                          color:
                            "#777780",
                          fontSize:
                            11,
                          fontWeight:
                            700,
                        }}
                      >
                        #
                        {String(
                          index +
                            1,
                        ).padStart(
                          2,
                          "0",
                        )}
                      </div>

                      <div
                        style={{
                          minWidth: 0,
                        }}
                      >
                        <div
                          className="muted"
                          style={{
                            fontSize:
                              9,
                            textTransform:
                              "uppercase",
                            marginBottom:
                              3,
                          }}
                        >
                          Video
                        </div>

                        <div
                          style={{
                            color:
                              "#ddddE2",
                            fontSize:
                              11,
                            overflow:
                              "hidden",
                            textOverflow:
                              "ellipsis",
                            whiteSpace:
                              "nowrap",
                          }}
                        >
                          {
                            combination
                              .video
                              .name
                          }
                        </div>
                      </div>

                      <div
                        style={{
                          minWidth: 0,
                        }}
                      >
                        <div
                          className="muted"
                          style={{
                            fontSize:
                              9,
                            textTransform:
                              "uppercase",
                            marginBottom:
                              3,
                          }}
                        >
                          Text
                        </div>

                        <input
                          value={
                            combination
                              .text
                              .text
                          }
                          onChange={(
                            event,
                          ) =>
                            updateVariation(
                              combination
                                .variationId -
                                1,
                              event
                                .target
                                .value,
                            )
                          }
                          className="form-input"
                          style={{
                            fontSize:
                              11,
                            padding:
                              "7px 9px",
                          }}
                        />
                      </div>

                      <div
                        style={{
                          minWidth: 0,
                        }}
                      >
                        <div
                          className="muted"
                          style={{
                            fontSize:
                              9,
                            textTransform:
                              "uppercase",
                            marginBottom:
                              3,
                          }}
                        >
                          Audio
                        </div>

                        <div
                          style={{
                            color:
                              "#ddddE2",
                            fontSize:
                              11,
                            overflow:
                              "hidden",
                            textOverflow:
                              "ellipsis",
                            whiteSpace:
                              "nowrap",
                          }}
                        >
                          {
                            combination
                              .audio
                              .name
                          }
                        </div>
                      </div>

                      <div
                        style={{
                          minWidth: 0,
                        }}
                      >
                        <div
                          className="muted"
                          style={{
                            fontSize:
                              9,
                            textTransform:
                              "uppercase",
                            marginBottom:
                              3,
                          }}
                        >
                          Template
                        </div>

                        <div
                          style={{
                            color:
                              "#ddddE2",
                            fontSize:
                              11,
                            overflow:
                              "hidden",
                            textOverflow:
                              "ellipsis",
                            whiteSpace:
                              "nowrap",
                          }}
                        >
                          {
                            combination
                              .template
                              .name
                          }
                        </div>
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </section>
        </div>

        <div
          style={{
            display: "grid",
            gap: 20,
            position:
              "sticky",
            top: 20,
          }}
        >
          <section className="feature-card">
            <div className="eyebrow">
              PREVIEW
            </div>

            <h2
              style={{
                margin:
                  "5px 0 15px",
              }}
            >
              Output Preview
            </h2>

            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "center",
              }}
            >
              <div
                style={{
                  width: 250,
                  aspectRatio:
                    "9 / 16",
                  position:
                    "relative",
                  overflow:
                    "hidden",
                  background:
                    previewDocument.backgroundColor ||
                    "#111",
                  borderRadius:
                    10,
                  boxShadow:
                    "0 18px 50px rgba(0,0,0,0.35)",
                }}
              >
                {previewCombination && (
                  <video
                    src={convertFileSrc(
                      previewCombination
                        .video
                        .path,
                    )}
                    muted
                    autoPlay
                    loop
                    playsInline
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
                    }}
                  />
                )}

                {previewLayers.map(
                  (
                    layer,
                  ) => {
                    const scaleX =
                      250 /
                      1080;

                    const scaleY =
                      (250 *
                        (1920 /
                          1080)) /
                      1920;

                    if (
                      layer.type !==
                      "text"
                    ) {
                      return null;
                    }

                    const text =
                      previewText(
                        layer.text ??
                          "",
                        previewVariation,
                      );

                    return (
                      <div
                        key={
                          layer.id
                        }
                        style={{
                          position:
                            "absolute",
                          left:
                            layer.x *
                            scaleX,
                          top:
                            layer.y *
                            scaleY,
                          width:
                            (layer.width ??
                              200) *
                            scaleX,
                          height:
                            (layer.height ??
                              80) *
                            scaleY,
                          display:
                            "flex",
                          alignItems:
                            "center",
                          justifyContent:
                            "center",
                          textAlign:
                            "center",
                          color:
                            layer.color ||
                            "#ffffff",
                          opacity:
                            layer.opacity ??
                            1,
                          fontSize:
                            Math.max(
                              7,
                              layer.fontSize *
                                scaleX,
                            ),
                          fontWeight:
                            700,
                          whiteSpace:
                            "pre-wrap",
                          overflow:
                            "hidden",
                          textShadow:
                            layer.shadow
                              ? "2px 2px 4px rgba(0,0,0,0.8)"
                              : "none",
                          WebkitTextStroke:
                            layer.borderWidth >
                            0
                              ? `${Math.max(
                                  0.25,
                                  layer.borderWidth *
                                    scaleX,
                                )}px ${layer.borderColor}`
                              : undefined,
                        }}
                      >
                        {text}
                      </div>
                    );
                  },
                )}
              </div>
            </div>

            {previewCombination && (
              <div
                style={{
                  marginTop: 14,
                  display: "grid",
                  gap: 7,
                }}
              >
                <div
                  style={{
                    display:
                      "flex",
                    justifyContent:
                      "space-between",
                    gap: 10,
                  }}
                >
                  <span className="muted">
                    Video
                  </span>

                  <span
                    style={{
                      color:
                        "#ddddE2",
                      fontSize:
                        11,
                      maxWidth:
                        180,
                      overflow:
                        "hidden",
                      textOverflow:
                        "ellipsis",
                      whiteSpace:
                        "nowrap",
                    }}
                  >
                    {
                      previewCombination
                        .video
                        .name
                    }
                  </span>
                </div>

                <div
                  style={{
                    display:
                      "flex",
                    justifyContent:
                      "space-between",
                    gap: 10,
                  }}
                >
                  <span className="muted">
                    Audio
                  </span>

                  <span
                    style={{
                      color:
                        "#ddddE2",
                      fontSize:
                        11,
                      maxWidth:
                        180,
                      overflow:
                        "hidden",
                      textOverflow:
                        "ellipsis",
                      whiteSpace:
                        "nowrap",
                    }}
                  >
                    {
                      previewCombination
                        .audio
                        .name
                    }
                  </span>
                </div>

                <div
                  style={{
                    display:
                      "flex",
                    justifyContent:
                      "space-between",
                    gap: 10,
                  }}
                >
                  <span className="muted">
                    Template
                  </span>

                  <span
                    style={{
                      color:
                        "#ddddE2",
                      fontSize:
                        11,
                    }}
                  >
                    {
                      previewCombination
                        .template
                        .name
                    }
                  </span>
                </div>
              </div>
            )}
          </section>

          <section className="feature-card">
            <div className="eyebrow">
              SUMMARY
            </div>

            <h2
              style={{
                margin:
                  "5px 0 16px",
              }}
            >
              Batch Summary
            </h2>

            <div
              style={{
                display:
                  "grid",
                gap: 10,
              }}
            >
              <div
                style={{
                  display:
                    "flex",
                  justifyContent:
                    "space-between",
                }}
              >
                <span className="muted">
                  Video Category
                </span>

                <strong
                  style={{
                    fontSize:
                      11,
                    color:
                      "#ffffff",
                  }}
                >
                  {selectedVideoCategory
                    ?.name ??
                    "Not selected"}
                </strong>
              </div>

              <div
                style={{
                  display:
                    "flex",
                  justifyContent:
                    "space-between",
                }}
              >
                <span className="muted">
                  Text Category
                </span>

                <strong
                  style={{
                    fontSize:
                      11,
                    color:
                      "#ffffff",
                  }}
                >
                  {selectedTextCategory
                    ?.name ??
                    "Not selected"}
                </strong>
              </div>

              <div
                style={{
                  display:
                    "flex",
                  justifyContent:
                    "space-between",
                }}
              >
                <span className="muted">
                  Audio Category
                </span>

                <strong
                  style={{
                    fontSize:
                      11,
                    color:
                      "#ffffff",
                  }}
                >
                  {selectedAudioCategory
                    ?.name ??
                    "Not selected"}
                </strong>
              </div>

              <div
                style={{
                  display:
                    "flex",
                  justifyContent:
                    "space-between",
                }}
              >
                <span className="muted">
                  Videos
                </span>

                <strong
                  style={{
                    fontSize:
                      11,
                    color:
                      "#ffffff",
                  }}
                >
                  {
                    generatedCount
                  }
                </strong>
              </div>

              <div
                style={{
                  display:
                    "flex",
                  justifyContent:
                    "space-between",
                }}
              >
                <span className="muted">
                  Template
                </span>

                <strong
                  style={{
                    fontSize:
                      11,
                    color:
                      "#ffffff",
                  }}
                >
                  {randomizeTemplate
                    ? "Randomized"
                    : templates.find(
                        (
                          template,
                        ) =>
                          template.id ===
                          selectedTemplate,
                      )?.name ??
                      "Not selected"}
                </strong>
              </div>

              <div
                style={{
                  display:
                    "flex",
                  justifyContent:
                    "space-between",
                }}
              >
                <span className="muted">
                  Clip Length
                </span>

                <strong
                  style={{
                    fontSize:
                      11,
                    color:
                      "#ffffff",
                  }}
                >
                  {
                    clipLength
                  }
                  s
                </strong>
              </div>
            </div>
          </section>

          <section className="feature-card">
            <div className="eyebrow">
              RENDERED FILES
            </div>

            <h2
              style={{
                margin:
                  "5px 0 15px",
              }}
            >
              Recent Renders
            </h2>

            {rendered.length ===
            0 ? (
              <div
                className="muted"
                style={{
                  fontSize: 12,
                  lineHeight:
                    1.6,
                }}
              >
                Your rendered videos
                will appear here.
              </div>
            ) : (
              <div
                style={{
                  display:
                    "grid",
                  gap: 8,
                  maxHeight:
                    280,
                  overflowY:
                    "auto",
                }}
              >
                {rendered
                  .slice(0, 10)
                  .map(
                    (item) => (
                      <div
                        key={
                          item.id
                        }
                        style={{
                          padding:
                            10,
                          borderRadius:
                            8,
                          background:
                            "rgba(255,255,255,0.025)",
                          border:
                            "1px solid rgba(255,255,255,0.06)",
                        }}
                      >
                        <div
                          style={{
                            color:
                              "#ddddE2",
                            fontSize:
                              11,
                            fontWeight:
                              600,
                          }}
                        >
                          {
                            item.variation_text
                          }
                        </div>

                        <div
                          style={{
                            color:
                              "#66666f",
                            fontSize:
                              9,
                            marginTop:
                              4,
                          }}
                        >
                          Rendered
                          variation #
                          {
                            item.variation_id
                          }
                        </div>
                      </div>
                    ),
                  )}
              </div>
            )}
          </section>
        </div>
      </div>

      {showMediaPicker && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background:
              "rgba(0,0,0,0.72)",
            display: "flex",
            alignItems:
              "center",
            justifyContent:
              "center",
            zIndex: 1000,
            padding: 20,
          }}
          onMouseDown={() =>
            setShowMediaPicker(
              false,
            )
          }
        >
          <div
            className="feature-card"
            onMouseDown={(event) =>
              event.stopPropagation()
            }
            style={{
              width: "100%",
              maxWidth: 900,
              maxHeight:
                "85vh",
              overflowY:
                "auto",
              padding: 24,
            }}
          >
            <div
              style={{
                display:
                  "flex",
                alignItems:
                  "flex-start",
                justifyContent:
                  "space-between",
                marginBottom:
                  20,
              }}
            >
              <div>
                <div className="eyebrow">
                  SOURCE VIDEO
                </div>

                <h2
                  style={{
                    margin:
                      "5px 0 7px",
                  }}
                >
                  Choose a Video
                </h2>

                <p
                  className="muted"
                  style={{
                    margin: 0,
                  }}
                >
                  This is the manual
                  source-video option.
                </p>
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setShowMediaPicker(
                    false,
                  )
                }
              >
                Close
              </button>
            </div>

            <div
              style={{
                display:
                  "grid",
                gridTemplateColumns:
                  "repeat(auto-fill, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              {videos.map(
                (video) => {
                  const selected =
                    selectedVideo?.id ===
                    video.id;

                  return (
                    <button
                      key={
                        video.id
                      }
                      type="button"
                      onClick={() => {
                        setSelectedVideo(
                          video,
                        );

                        setShowMediaPicker(
                          false,
                        );
                      }}
                      style={{
                        padding: 0,
                        border:
                          selected
                            ? "2px solid #ffffff"
                            : "1px solid rgba(255,255,255,0.08)",
                        borderRadius:
                          10,
                        overflow:
                          "hidden",
                        background:
                          "#111318",
                        cursor:
                          "pointer",
                        textAlign:
                          "left",
                      }}
                    >
                      <div
                        style={{
                          aspectRatio:
                            "16 / 10",
                          background:
                            "#08090b",
                        }}
                      >
                        <video
                          src={convertFileSrc(
                            video.path,
                          )}
                          muted
                          preload="metadata"
                          style={{
                            width:
                              "100%",
                            height:
                              "100%",
                            objectFit:
                              "cover",
                            pointerEvents:
                              "none",
                          }}
                        />
                      </div>

                      <div
                        style={{
                          padding:
                            "10px 11px",
                        }}
                      >
                        <div
                          style={{
                            color:
                              "#e5e5e9",
                            fontSize:
                              12,
                            fontWeight:
                              600,
                            overflow:
                              "hidden",
                            textOverflow:
                              "ellipsis",
                            whiteSpace:
                              "nowrap",
                          }}
                        >
                          {
                            video.name
                          }
                        </div>

                        <div
                          className="muted"
                          style={{
                            fontSize:
                              10,
                            marginTop:
                              4,
                          }}
                        >
                          {formatBytes(
                            video.size,
                          )}
                        </div>
                      </div>
                    </button>
                  );
                },
              )}
            </div>

            <button
              type="button"
              className="secondary-button"
              onClick={
                importVideo
              }
              style={{
                marginTop: 18,
              }}
            >
              + Import New Video
            </button>
          </div>
        </div>
      )}

      {showAudioPicker && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background:
              "rgba(0,0,0,0.72)",
            display: "flex",
            alignItems:
              "center",
            justifyContent:
              "center",
            zIndex: 1000,
            padding: 20,
          }}
          onMouseDown={() =>
            setShowAudioPicker(
              false,
            )
          }
        >
          <div
            className="feature-card"
            onMouseDown={(event) =>
              event.stopPropagation()
            }
            style={{
              width: "100%",
              maxWidth: 700,
              maxHeight:
                "80vh",
              overflowY:
                "auto",
              padding: 24,
            }}
          >
            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "space-between",
                gap: 15,
                marginBottom:
                  20,
              }}
            >
              <div>
                <div className="eyebrow">
                  AUDIO
                </div>

                <h2
                  style={{
                    margin:
                      "5px 0 7px",
                  }}
                >
                  Choose Audio
                </h2>

                <p
                  className="muted"
                  style={{
                    margin: 0,
                  }}
                >
                  Choose a manual
                  audio track instead
                  of category audio.
                </p>
              </div>

              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setShowAudioPicker(
                    false,
                  )
                }
              >
                Close
              </button>
            </div>

            <div
              style={{
                display:
                  "grid",
                gap: 8,
              }}
            >
              {audioMedia.length ===
              0 ? (
                <div
                  className="muted"
                  style={{
                    padding:
                      "30px 0",
                    textAlign:
                      "center",
                  }}
                >
                  No audio files
                  have been imported
                  yet.
                </div>
              ) : (
                audioMedia.map(
                  (audio) => (
                    <button
                      key={
                        audio.id
                      }
                      type="button"
                      onClick={() => {
                        setAddedAudioPath(
                          audio.path,
                        );

                        setAddedAudioName(
                          audio.name,
                        );

                        setShowAudioPicker(
                          false,
                        );
                      }}
                      style={{
                        border:
                          "1px solid rgba(255,255,255,0.07)",
                        borderRadius:
                          9,
                        background:
                          "rgba(255,255,255,0.025)",
                        padding:
                          "12px 14px",
                        color:
                          "#ddddE2",
                        textAlign:
                          "left",
                        cursor:
                          "pointer",
                        display:
                          "flex",
                        justifyContent:
                          "space-between",
                        gap: 15,
                      }}
                    >
                      <span>
                        {
                          audio.name
                        }
                      </span>

                      <span
                        className="muted"
                        style={{
                          fontSize:
                            10,
                        }}
                      >
                        {formatBytes(
                          audio.size,
                        )}
                      </span>
                    </button>
                  ),
                )
              )}
            </div>

            <button
              type="button"
              className="secondary-button"
              onClick={
                selectAudio
              }
              style={{
                marginTop: 18,
              }}
            >
              + Import New Audio
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Create;
