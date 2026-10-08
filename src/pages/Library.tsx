import {
  useEffect,
  useMemo,
  useState,
} from "react";

import Database from "@tauri-apps/plugin-sql";
import {
  convertFileSrc,
} from "@tauri-apps/api/core";

type LibraryType =
  | "video"
  | "text"
  | "audio";

type Category = {
  id: string;
  name: string;
  category_type: LibraryType;
  created_at: string;
  updated_at: string;
};

type MediaItem = {
  id: string;
  name: string;
  path: string;
  media_type: string;
  size: number;
  created_at: string;
};

type TextItem = {
  id: string;
  category_id: string;
  text: string;
  created_at: string;
  updated_at: string;
};

type CategoryMedia = {
  category_id: string;
  media_id: string;
};

const createId = (
  prefix: string,
) => {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
};

const now = () =>
  new Date().toISOString();

const escapeSqlLike = (
  value: string,
) => {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\\\%")
    .replace(/_/g, "\\_");
};

function Library() {
  const [db, setDb] =
    useState<Database | null>(null);

  const [activeType, setActiveType] =
    useState<LibraryType>("video");

  const [categories, setCategories] =
    useState<Category[]>([]);

  const [media, setMedia] =
    useState<MediaItem[]>([]);

  const [textItems, setTextItems] =
    useState<TextItem[]>([]);

  const [categoryMedia, setCategoryMedia] =
    useState<CategoryMedia[]>([]);

  const [selectedCategoryId, setSelectedCategoryId] =
    useState<string | null>(null);

  const [categoryName, setCategoryName] =
    useState("");

  const [newText, setNewText] =
    useState("");

  const [search, setSearch] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [showCreateCategory, setShowCreateCategory] =
    useState(false);

  const [showAddMedia, setShowAddMedia] =
    useState(false);

  const initializeDatabase = async () => {
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
      CREATE INDEX IF NOT EXISTS idx_library_categories_type
      ON library_categories(category_type);
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
      CREATE INDEX IF NOT EXISTS idx_library_category_media_category
      ON library_category_media(category_id);
    `);

    await database.execute(`
      CREATE INDEX IF NOT EXISTS idx_library_category_media_media
      ON library_category_media(media_id);
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

    await database.execute(`
      CREATE INDEX IF NOT EXISTS idx_library_text_items_category
      ON library_text_items(category_id);
    `);

    return database;
  };

  const loadData = async (
    database: Database,
  ) => {
    const loadedCategories =
      await database.select<Category[]>(
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

    const loadedMedia =
      await database.select<MediaItem[]>(
        `
          SELECT
            id,
            name,
            path,
            media_type,
            size,
            created_at
          FROM media
          WHERE media_type IN ('video', 'audio')
          ORDER BY created_at DESC
        `,
      );

    const loadedText =
      await database.select<TextItem[]>(
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

    const loadedCategoryMedia =
      await database.select<CategoryMedia[]>(
        `
          SELECT
            category_id,
            media_id
          FROM library_category_media
        `,
      );

    setCategories(
      loadedCategories,
    );

    setMedia(
      loadedMedia,
    );

    setTextItems(
      loadedText,
    );

    setCategoryMedia(
      loadedCategoryMedia,
    );

    const typeCategories =
      loadedCategories.filter(
        (category) =>
          category.category_type ===
          activeType,
      );

    if (
      selectedCategoryId &&
      typeCategories.some(
        (category) =>
          category.id ===
          selectedCategoryId,
      )
    ) {
      return;
    }

    setSelectedCategoryId(
      typeCategories[0]?.id ??
        null,
    );
  };

  useEffect(() => {
    let mounted = true;

    const start = async () => {
      try {
        setLoading(true);
        setError(null);

        const database =
          await initializeDatabase();

        if (!mounted) {
          return;
        }

        setDb(database);

        await loadData(database);
      } catch (err) {
        console.error(
          "Unable to initialize content library:",
          err,
        );

        if (mounted) {
          setError(
            "Unable to load the content library.",
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    start();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!db) {
      return;
    }

    const typeCategories =
      categories.filter(
        (category) =>
          category.category_type ===
          activeType,
      );

    if (
      selectedCategoryId &&
      typeCategories.some(
        (category) =>
          category.id ===
          selectedCategoryId,
      )
    ) {
      return;
    }

    setSelectedCategoryId(
      typeCategories[0]?.id ??
        null,
    );
  }, [
    activeType,
    categories,
    db,
    selectedCategoryId,
  ]);

  const activeCategories =
    useMemo(() => {
      return categories.filter(
        (category) =>
          category.category_type ===
          activeType,
      );
    }, [
      categories,
      activeType,
    ]);

  const selectedCategory =
    useMemo(() => {
      return categories.find(
        (category) =>
          category.id ===
          selectedCategoryId,
      ) ?? null;
    }, [
      categories,
      selectedCategoryId,
    ]);

  const selectedMediaIds =
    useMemo(() => {
      if (!selectedCategoryId) {
        return new Set<string>();
      }

      return new Set(
        categoryMedia
          .filter(
            (item) =>
              item.category_id ===
              selectedCategoryId,
          )
          .map(
            (item) =>
              item.media_id,
          ),
      );
    }, [
      categoryMedia,
      selectedCategoryId,
    ]);

  const selectedTextItems =
    useMemo(() => {
      if (!selectedCategoryId) {
        return [];
      }

      return textItems.filter(
        (item) =>
          item.category_id ===
          selectedCategoryId,
      );
    }, [
      textItems,
      selectedCategoryId,
    ]);

  const filteredMedia =
    useMemo(() => {
      const mediaType =
        activeType === "video"
          ? "video"
          : "audio";

      const term =
        escapeSqlLike(
          search.trim(),
        ).toLowerCase();

      return media.filter(
        (item) => {
          if (
            item.media_type !==
            mediaType
          ) {
            return false;
          }

          if (!term) {
            return true;
          }

          return item.name
            .toLowerCase()
            .includes(term);
        },
      );
    }, [
      media,
      activeType,
      search,
    ]);

  const filteredTextItems =
    useMemo(() => {
      const term =
        search.trim().toLowerCase();

      if (!term) {
        return selectedTextItems;
      }

      return selectedTextItems.filter(
        (item) =>
          item.text
            .toLowerCase()
            .includes(term),
      );
    }, [
      selectedTextItems,
      search,
    ]);

  const categoryMediaCount =
    (categoryId: string) => {
      return categoryMedia.filter(
        (item) =>
          item.category_id ===
          categoryId,
      ).length;
    };

  const createCategory = async () => {
    if (!db) {
      return;
    }

    const trimmed =
      categoryName.trim();

    if (!trimmed) {
      return;
    }

    const alreadyExists =
      categories.some(
        (category) =>
          category.category_type ===
            activeType &&
          category.name
            .trim()
            .toLowerCase() ===
            trimmed.toLowerCase(),
      );

    if (alreadyExists) {
      setError(
        "A category with that name already exists.",
      );
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const id =
        createId("category");

      const timestamp =
        now();

      await db.execute(
        `
          INSERT INTO library_categories (
            id,
            name,
            category_type,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?)
        `,
        [
          id,
          trimmed,
          activeType,
          timestamp,
          timestamp,
        ],
      );

      setCategoryName("");
      setShowCreateCategory(false);

      await loadData(db);

      setSelectedCategoryId(id);
    } catch (err) {
      console.error(
        "Unable to create category:",
        err,
      );

      setError(
        "Unable to create that category.",
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (
    categoryId: string,
  ) => {
    if (!db) {
      return;
    }

    const category =
      categories.find(
        (item) =>
          item.id ===
          categoryId,
      );

    if (!category) {
      return;
    }

    const confirmed =
      window.confirm(
        `Delete the "${category.name}" category? Your original media and text will not be deleted.`,
      );

    if (!confirmed) {
      return;
    }

    try {
      setSaving(true);
      setError(null);

      await db.execute(
        `
          DELETE FROM library_category_media
          WHERE category_id = ?
        `,
        [categoryId],
      );

      await db.execute(
        `
          DELETE FROM library_text_items
          WHERE category_id = ?
        `,
        [categoryId],
      );

      await db.execute(
        `
          DELETE FROM library_categories
          WHERE id = ?
        `,
        [categoryId],
      );

      setSelectedCategoryId(
        null,
      );

      await loadData(db);
    } catch (err) {
      console.error(
        "Unable to delete category:",
        err,
      );

      setError(
        "Unable to delete that category.",
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleMediaInCategory =
    async (
      mediaId: string,
    ) => {
      if (
        !db ||
        !selectedCategoryId
      ) {
        return;
      }

      try {
        setSaving(true);
        setError(null);

        const exists =
          selectedMediaIds.has(
            mediaId,
          );

        if (exists) {
          await db.execute(
            `
              DELETE FROM library_category_media
              WHERE category_id = ?
              AND media_id = ?
            `,
            [
              selectedCategoryId,
              mediaId,
            ],
          );
        } else {
          await db.execute(
            `
              INSERT OR IGNORE INTO library_category_media (
                category_id,
                media_id,
                created_at
              )
              VALUES (?, ?, ?)
            `,
            [
              selectedCategoryId,
              mediaId,
              now(),
            ],
          );
        }

        await loadData(db);
      } catch (err) {
        console.error(
          "Unable to update category media:",
          err,
        );

        setError(
          "Unable to update that category.",
        );
      } finally {
        setSaving(false);
      }
    };

  const addTextItem = async () => {
    if (
      !db ||
      !selectedCategoryId
    ) {
      return;
    }

    const trimmed =
      newText.trim();

    if (!trimmed) {
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const timestamp =
        now();

      await db.execute(
        `
          INSERT INTO library_text_items (
            id,
            category_id,
            text,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?)
        `,
        [
          createId("text"),
          selectedCategoryId,
          trimmed,
          timestamp,
          timestamp,
        ],
      );

      setNewText("");

      await loadData(db);
    } catch (err) {
      console.error(
        "Unable to add text:",
        err,
      );

      setError(
        "Unable to add that text.",
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteTextItem = async (
    textId: string,
  ) => {
    if (!db) {
      return;
    }

    try {
      setSaving(true);
      setError(null);

      await db.execute(
        `
          DELETE FROM library_text_items
          WHERE id = ?
        `,
        [textId],
      );

      await loadData(db);
    } catch (err) {
      console.error(
        "Unable to delete text:",
        err,
      );

      setError(
        "Unable to delete that text.",
      );
    } finally {
      setSaving(false);
    }
  };

  const typeLabel =
    activeType === "video"
      ? "Video"
      : activeType === "audio"
        ? "Audio"
        : "Text";

  const categoryDescription =
    activeType === "video"
      ? "Organize your source footage into reusable groups."
      : activeType === "audio"
        ? "Organize music and audio tracks into reusable groups."
        : "Build reusable libraries of hooks, captions, headlines, and other text.";

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <p className="eyebrow">
              CONTENT LIBRARY
            </p>

            <h1>Library</h1>

            <p className="page-description">
              Loading your content library...
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
            CONTENT LIBRARY
          </p>

          <h1>Build Your Library</h1>

          <p className="page-description">
            Organize your videos, text, and
            audio once so you can reuse them
            when creating content.
          </p>
        </div>

        <button
          className="primary-button"
          onClick={() =>
            setShowCreateCategory(
              true,
            )
          }
        >
          + New Category
        </button>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 20,
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

      <section
        style={{
          display: "grid",
          gridTemplateColumns:
            "220px minmax(0, 1fr)",
          gap: 20,
          alignItems: "start",
        }}
      >
        <div
          className="feature-card"
          style={{
            padding: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: 18,
              borderBottom:
                "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <div
              className="eyebrow"
              style={{
                marginBottom: 6,
              }}
            >
              LIBRARY
            </div>

            <div
              style={{
                color: "#8f8f98",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              Choose what you want to
              organize.
            </div>
          </div>

          {(
            [
              ["video", "Videos"],
              ["text", "Text"],
              ["audio", "Audio"],
            ] as [
              LibraryType,
              string,
            ][]
          ).map(
            ([
              type,
              label,
            ]) => {
              const count =
                categories.filter(
                  (category) =>
                    category.category_type ===
                    type,
                ).length;

              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    setActiveType(
                      type,
                    );
                    setSearch("");
                  }}
                  style={{
                    width: "100%",
                    border: 0,
                    borderBottom:
                      "1px solid rgba(255,255,255,0.05)",
                    background:
                      activeType ===
                      type
                        ? "rgba(255,255,255,0.06)"
                        : "transparent",
                    color:
                      activeType ===
                      type
                        ? "#ffffff"
                        : "#9b9ba4",
                    padding:
                      "14px 18px",
                    textAlign: "left",
                    cursor:
                      "pointer",
                    display: "flex",
                    alignItems:
                      "center",
                    justifyContent:
                      "space-between",
                    fontSize: 13,
                    fontWeight:
                      activeType ===
                      type
                        ? 700
                        : 500,
                  }}
                >
                  <span>
                    {label}
                  </span>

                  <span
                    style={{
                      fontSize: 11,
                      color:
                        activeType ===
                        type
                          ? "#ffffff"
                          : "#696971",
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            },
          )}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "240px minmax(0, 1fr)",
            gap: 20,
            minWidth: 0,
          }}
        >
          <div
            className="feature-card"
            style={{
              padding: 0,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: 18,
                borderBottom:
                  "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "#ffffff",
                  marginBottom: 5,
                }}
              >
                {typeLabel} Categories
              </div>

              <div
                style={{
                  color: "#85858e",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {categoryDescription}
              </div>
            </div>

            {activeCategories.length ===
            0 ? (
              <div
                style={{
                  padding: 22,
                  color: "#777780",
                  fontSize: 12,
                  lineHeight: 1.6,
                }}
              >
                You haven't created any
                {` ${typeLabel.toLowerCase()}`}
                {" "}categories yet.
                <br />
                <br />
                Click{" "}
                <strong
                  style={{
                    color: "#ffffff",
                  }}
                >
                  + New Category
                </strong>{" "}
                to create your first
                one.
              </div>
            ) : (
              <div
                style={{
                  padding: 8,
                }}
              >
                {activeCategories.map(
                  (category) => {
                    const selected =
                      category.id ===
                      selectedCategoryId;

                    return (
                      <button
                        key={
                          category.id
                        }
                        type="button"
                        onClick={() =>
                          setSelectedCategoryId(
                            category.id,
                          )
                        }
                        style={{
                          width:
                            "100%",
                          border: 0,
                          borderRadius: 8,
                          background:
                            selected
                              ? "rgba(255,255,255,0.07)"
                              : "transparent",
                          color:
                            selected
                              ? "#ffffff"
                              : "#9b9ba4",
                          padding:
                            "12px 12px",
                          textAlign:
                            "left",
                          cursor:
                            "pointer",
                          display:
                            "flex",
                          alignItems:
                            "center",
                          justifyContent:
                            "space-between",
                          gap: 10,
                          marginBottom:
                            3,
                        }}
                      >
                        <span
                          style={{
                            overflow:
                              "hidden",
                            textOverflow:
                              "ellipsis",
                            whiteSpace:
                              "nowrap",
                            fontSize:
                              13,
                            fontWeight:
                              selected
                                ? 700
                                : 500,
                          }}
                        >
                          {category.name}
                        </span>

                        <span
                          style={{
                            flexShrink:
                              0,
                            fontSize:
                              10,
                            color:
                              selected
                                ? "#ffffff"
                                : "#66666f",
                          }}
                        >
                          {activeType ===
                          "text"
                            ? textItems.filter(
                                (
                                  item,
                                ) =>
                                  item.category_id ===
                                  category.id,
                              ).length
                            : categoryMediaCount(
                                category.id,
                              )}
                        </span>
                      </button>
                    );
                  },
                )}
              </div>
            )}
          </div>

          <div
            className="feature-card"
            style={{
              minWidth: 0,
            }}
          >
            {!selectedCategory ? (
              <div
                style={{
                  minHeight: 360,
                  display: "flex",
                  alignItems:
                    "center",
                  justifyContent:
                    "center",
                  textAlign: "center",
                  padding: 30,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 34,
                      marginBottom: 14,
                    }}
                  >
                    +
                  </div>

                  <h3
                    style={{
                      margin:
                        "0 0 8px",
                    }}
                  >
                    Create a category
                  </h3>

                  <p
                    className="muted"
                    style={{
                      maxWidth: 360,
                      margin:
                        "0 auto 18px",
                    }}
                  >
                    Create a category
                    first, then we'll
                    let you fill it
                    with reusable
                    content.
                  </p>

                  <button
                    className="primary-button"
                    onClick={() =>
                      setShowCreateCategory(
                        true,
                      )
                    }
                  >
                    + New Category
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems:
                      "flex-start",
                    justifyContent:
                      "space-between",
                    gap: 16,
                    marginBottom: 20,
                  }}
                >
                  <div
                    style={{
                      minWidth: 0,
                    }}
                  >
                    <div
                      className="eyebrow"
                      style={{
                        marginBottom: 5,
                      }}
                    >
                      {typeLabel.toUpperCase()}
                    </div>

                    <h2
                      style={{
                        margin:
                          "0 0 6px",
                        overflow:
                          "hidden",
                        textOverflow:
                          "ellipsis",
                      }}
                    >
                      {
                        selectedCategory.name
                      }
                    </h2>

                    <p
                      className="muted"
                      style={{
                        margin: 0,
                        fontSize: 12,
                      }}
                    >
                      {activeType ===
                      "text"
                        ? `${selectedTextItems.length} text items`
                        : `${selectedMediaIds.size} media items`}
                    </p>
                  </div>

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      deleteCategory(
                        selectedCategory.id,
                      )
                    }
                    disabled={saving}
                    style={{
                      flexShrink: 0,
                    }}
                  >
                    Delete Category
                  </button>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    marginBottom: 18,
                  }}
                >
                  <input
                    value={search}
                    onChange={(event) =>
                      setSearch(
                        event.target
                          .value,
                      )
                    }
                    placeholder={
                      activeType ===
                      "text"
                        ? "Search text..."
                        : `Search ${typeLabel.toLowerCase()}...`
                    }
                    className="form-input"
                    style={{
                      flex: 1,
                    }}
                  />

                  {activeType !==
                    "text" && (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() =>
                        setShowAddMedia(
                          true,
                        )
                      }
                    >
                      + Add{" "}
                      {typeLabel}
                    </button>
                  )}
                </div>

                {activeType ===
                  "text" && (
                  <div
                    style={{
                      marginBottom:
                        20,
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
                        fontSize: 12,
                        fontWeight: 700,
                        color:
                          "#d8d8dd",
                        marginBottom:
                          8,
                      }}
                    >
                      Add Text
                    </div>

                    <div
                      style={{
                        display:
                          "flex",
                        gap: 10,
                      }}
                    >
                      <textarea
                        value={
                          newText
                        }
                        onChange={(
                          event,
                        ) =>
                          setNewText(
                            event
                              .target
                              .value,
                          )
                        }
                        placeholder="Enter a hook, caption, headline, CTA, or any reusable text..."
                        className="form-textarea"
                        rows={3}
                        style={{
                          flex: 1,
                          resize:
                            "vertical",
                        }}
                      />

                      <button
                        type="button"
                        className="primary-button"
                        onClick={
                          addTextItem
                        }
                        disabled={
                          saving ||
                          !newText.trim()
                        }
                        style={{
                          alignSelf:
                            "flex-end",
                        }}
                      >
                        Add Text
                      </button>
                    </div>
                  </div>
                )}

                {activeType ===
                  "text" ? (
                  filteredTextItems.length ===
                  0 ? (
                    <div
                      style={{
                        padding:
                          "45px 20px",
                        textAlign:
                          "center",
                        color:
                          "#777780",
                        fontSize: 13,
                      }}
                    >
                      No text has been
                      added to this
                      category yet.
                    </div>
                  ) : (
                    <div
                      style={{
                        display:
                          "grid",
                        gap: 10,
                      }}
                    >
                      {filteredTextItems.map(
                        (
                          item,
                        ) => (
                          <div
                            key={
                              item.id
                            }
                            style={{
                              display:
                                "flex",
                              gap: 14,
                              alignItems:
                                "flex-start",
                              padding:
                                14,
                              borderRadius:
                                10,
                              background:
                                "rgba(255,255,255,0.025)",
                              border:
                                "1px solid rgba(255,255,255,0.06)",
                            }}
                          >
                            <div
                              style={{
                                flex: 1,
                                color:
                                  "#e7e7eb",
                                fontSize:
                                  13,
                                lineHeight:
                                  1.55,
                                whiteSpace:
                                  "pre-wrap",
                              }}
                            >
                              {
                                item.text
                              }
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                deleteTextItem(
                                  item.id,
                                )
                              }
                              disabled={
                                saving
                              }
                              style={{
                                border: 0,
                                background:
                                  "transparent",
                                color:
                                  "#777780",
                                cursor:
                                  "pointer",
                                fontSize:
                                  11,
                                padding:
                                  "4px 0",
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        ),
                      )}
                    </div>
                  )
                ) : (
                  <div
                    style={{
                      display:
                        "grid",
                      gridTemplateColumns:
                        "repeat(auto-fill, minmax(180px, 1fr))",
                      gap: 12,
                    }}
                  >
                    {filteredMedia.length ===
                    0 ? (
                      <div
                        style={{
                          gridColumn:
                            "1 / -1",
                          padding:
                            "45px 20px",
                          textAlign:
                            "center",
                          color:
                            "#777780",
                          fontSize:
                            13,
                        }}
                      >
                        No{" "}
                        {typeLabel.toLowerCase()}{" "}
                        found in your
                        media library.
                        <br />
                        <br />
                        Import some{" "}
                        {typeLabel.toLowerCase()}
                        {" "}from the Media
                        page first.
                      </div>
                    ) : (
                      filteredMedia.map(
                        (item) => {
                          const inCategory =
                            selectedMediaIds.has(
                              item.id,
                            );

                          return (
                            <button
                              key={
                                item.id
                              }
                              type="button"
                              onClick={() =>
                                toggleMediaInCategory(
                                  item.id,
                                )
                              }
                              style={{
                                position:
                                  "relative",
                                padding: 0,
                                border:
                                  inCategory
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
                                  overflow:
                                    "hidden",
                                }}
                              >
                                {item.media_type ===
                                "video" ? (
                                  <video
                                    src={convertFileSrc(
                                      item.path,
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
                                ) : (
                                  <div
                                    style={{
                                      height:
                                        "100%",
                                      display:
                                        "flex",
                                      alignItems:
                                        "center",
                                      justifyContent:
                                        "center",
                                      fontSize:
                                        30,
                                      color:
                                        "#777780",
                                    }}
                                  >
                                    ♪
                                  </div>
                                )}
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
                                    item.name
                                  }
                                </div>

                                <div
                                  style={{
                                    marginTop:
                                      4,
                                    color:
                                      inCategory
                                        ? "#ffffff"
                                        : "#66666f",
                                    fontSize:
                                      10,
                                    fontWeight:
                                      700,
                                    textTransform:
                                      "uppercase",
                                  }}
                                >
                                  {inCategory
                                    ? "IN CATEGORY"
                                    : "Click to add"}
                                </div>
                              </div>
                            </button>
                          );
                        },
                      )
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {showCreateCategory && (
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
            setShowCreateCategory(
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
              maxWidth: 430,
              padding: 24,
            }}
          >
            <div
              className="eyebrow"
              style={{
                marginBottom: 7,
              }}
            >
              NEW CATEGORY
            </div>

            <h2
              style={{
                margin:
                  "0 0 8px",
              }}
            >
              Create {typeLabel}
              {" "}Category
            </h2>

            <p
              className="muted"
              style={{
                margin:
                  "0 0 20px",
                lineHeight: 1.6,
              }}
            >
              Give this category a name.
              You can fill it with
              content after creating it.
            </p>

            <input
              autoFocus
              value={categoryName}
              onChange={(event) =>
                setCategoryName(
                  event.target
                    .value,
                )
              }
              onKeyDown={(event) => {
                if (
                  event.key ===
                  "Enter"
                ) {
                  createCategory();
                }

                if (
                  event.key ===
                  "Escape"
                ) {
                  setShowCreateCategory(
                    false,
                  );
                }
              }}
              placeholder={`Example: ${activeType === "video" ? "Motivation" : activeType === "audio" ? "Energetic" : "Motivational Hooks"}`}
              className="form-input"
              style={{
                width:
                  "100%",
                marginBottom:
                  14,
              }}
            />

            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "flex-end",
                gap: 10,
              }}
            >
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setShowCreateCategory(
                    false,
                  );
                  setCategoryName(
                    "",
                  );
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                className="primary-button"
                onClick={
                  createCategory
                }
                disabled={
                  saving ||
                  !categoryName.trim()
                }
              >
                Create Category
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddMedia &&
        selectedCategory && (
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
              setShowAddMedia(
                false,
              )
            }
          >
            <div
              className="feature-card"
              onMouseDown={(
                event,
              ) =>
                event.stopPropagation()
              }
              style={{
                width: "100%",
                maxWidth: 900,
                maxHeight:
                  "85vh",
                overflow:
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
                  gap: 20,
                  marginBottom:
                    20,
                }}
              >
                <div>
                  <div className="eyebrow">
                    ADD TO CATEGORY
                  </div>

                  <h2
                    style={{
                      margin:
                        "5px 0 7px",
                    }}
                  >
                    {
                      selectedCategory.name
                    }
                  </h2>

                  <p
                    className="muted"
                    style={{
                      margin: 0,
                    }}
                  >
                    Click media to add or
                    remove it from this
                    category.
                  </p>
                </div>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    setShowAddMedia(
                      false,
                    )
                  }
                >
                  Done
                </button>
              </div>

              <div
                style={{
                  display:
                    "grid",
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(170px, 1fr))",
                  gap: 12,
                }}
              >
                {filteredMedia.map(
                  (item) => {
                    const inCategory =
                      selectedMediaIds.has(
                        item.id,
                      );

                    return (
                      <button
                        key={
                          item.id
                        }
                        type="button"
                        onClick={() =>
                          toggleMediaInCategory(
                            item.id,
                          )
                        }
                        style={{
                          position:
                            "relative",
                          padding: 0,
                          border:
                            inCategory
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
                            overflow:
                              "hidden",
                          }}
                        >
                          {item.media_type ===
                          "video" ? (
                            <video
                              src={convertFileSrc(
                                item.path,
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
                          ) : (
                            <div
                              style={{
                                height:
                                  "100%",
                                display:
                                  "flex",
                                alignItems:
                                  "center",
                                justifyContent:
                                  "center",
                                fontSize:
                                  30,
                                color:
                                  "#777780",
                              }}
                            >
                              ♪
                            </div>
                          )}
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
                              item.name
                            }
                          </div>

                          <div
                            style={{
                              marginTop:
                                4,
                              color:
                                inCategory
                                  ? "#ffffff"
                                  : "#66666f",
                              fontSize:
                                10,
                              fontWeight:
                                700,
                              textTransform:
                                "uppercase",
                            }}
                          >
                            {inCategory
                              ? "IN CATEGORY"
                              : "Click to add"}
                          </div>
                        </div>
                      </button>
                    );
                  },
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

export default Library;
