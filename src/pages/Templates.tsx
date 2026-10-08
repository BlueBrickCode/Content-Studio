import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import Database from "@tauri-apps/plugin-sql";
import { convertFileSrc } from "@tauri-apps/api/core";

type LayerType = "video" | "text";

type Layer = {
  id: string;
  type: LayerType;

  x: number;
  y: number;
  width: number;
  height: number;

  text?: string;
  fontSize?: number;
  color?: string;
  opacity?: number;
  borderWidth?: number;
  borderColor?: string;
  shadow?: boolean;
};

type TemplateDocument = {
  backgroundColor: string;
  layers: Layer[];
};

type Template = {
  id: string;
  name: string;
  width: number;
  height: number;
  layers_json: string;
  created_at: string;
  updated_at: string;
};

type MediaItem = {
  id: string;
  name: string;
  path: string;
  media_type: string;
};

type ResizeHandle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

type DragState = {
  id: string;
  mode: "move" | "resize";
  handle?: ResizeHandle;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
};

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;

const MIN_VIDEO_WIDTH = 180;
const MIN_VIDEO_HEIGHT = 180;

const clamp = (
  value: number,
  minimum: number,
  maximum: number
) => Math.min(maximum, Math.max(minimum, value));

const createId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

const defaultVideoLayer = (): Layer => ({
  id: createId("video"),
  type: "video",
  x: 0,
  y: 960,
  width: 1080,
  height: 960,
});

const defaultTextLayer = (): Layer => ({
  id: createId("text"),
  type: "text",
  x: 540,
  y: 360,
  width: 900,
  height: 180,
  text: "{{text}}",
  fontSize: 76,
  color: "#111111",
  opacity: 1,
  borderWidth: 0,
  borderColor: "#000000",
  shadow: false,
});

const createDefaultDocument = (): TemplateDocument => ({
  backgroundColor: "#FFFFFF",
  layers: [
    defaultVideoLayer(),
    defaultTextLayer(),
  ],
});

function parseDocument(
  value: string
): TemplateDocument {
  try {
    const parsed = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return {
        backgroundColor: "#FFFFFF",
        layers: parsed.map(
          (layer: Partial<Layer>) => ({
            ...layer,
            width:
              typeof layer.width === "number"
                ? layer.width
                : layer.type === "text"
                  ? 900
                  : 1080,
            height:
              typeof layer.height === "number"
                ? layer.height
                : layer.type === "text"
                  ? 180
                  : 960,
          })
        ) as Layer[],
      };
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray(parsed.layers)
    ) {
      return {
        backgroundColor:
          typeof parsed.backgroundColor ===
          "string"
            ? parsed.backgroundColor
            : "#FFFFFF",
        layers: parsed.layers.map(
          (layer: Partial<Layer>) => ({
            ...layer,
            width:
              typeof layer.width === "number"
                ? layer.width
                : layer.type === "text"
                  ? 900
                  : 1080,
            height:
              typeof layer.height === "number"
                ? layer.height
                : layer.type === "text"
                  ? 180
                  : 960,
          })
        ) as Layer[],
      };
    }

    return createDefaultDocument();
  } catch {
    return createDefaultDocument();
  }
}

function layerLabel(
  layer: Layer,
  index: number
) {
  if (layer.type === "video") {
    return "Video";
  }

  const text = layer.text?.trim();

  if (!text) {
    return `Text ${index + 1}`;
  }

  if (text === "{{text}}") {
    return "Variation Text";
  }

  return text.length > 24
    ? `${text.slice(0, 24)}…`
    : text;
}

export function Templates() {
  const [templates, setTemplates] =
    useState<Template[]>([]);

  const [selected, setSelected] =
    useState<Template | null>(null);

  const [name, setName] =
    useState("New Template");

  const [backgroundColor, setBackgroundColor] =
    useState("#FFFFFF");

  const [layers, setLayers] =
    useState<Layer[]>(() => [
      defaultVideoLayer(),
      defaultTextLayer(),
    ]);

  const [selectedLayerId, setSelectedLayerId] =
    useState<string | null>(null);

  const [previewVideo, setPreviewVideo] =
    useState<MediaItem | null>(null);

  const [media, setMedia] =
    useState<MediaItem[]>([]);

  const [showMediaPicker, setShowMediaPicker] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  const canvasRef =
    useRef<HTMLDivElement | null>(null);

  const dragRef =
    useRef<DragState | null>(null);

  const dbPromise = useMemo(
    () =>
      Database.load(
        "sqlite:content-studio.db"
      ),
    []
  );

  const selectedLayer =
    layers.find(
      (layer) =>
        layer.id === selectedLayerId
    ) ?? null;

  const loadTemplates = async () => {
    try {
      setLoading(true);
      setError("");

      const db = await dbPromise;

      const rows =
        await db.select<Template[]>(
          `
          SELECT
            id,
            name,
            width,
            height,
            layers_json,
            created_at,
            updated_at
          FROM templates
          ORDER BY updated_at DESC
          `
        );

      setTemplates(rows);
    } catch (err) {
      setError(
        `Unable to load templates: ${String(err)}`
      );
    } finally {
      setLoading(false);
    }
  };

  const loadMedia = async () => {
    try {
      const db = await dbPromise;

      const rows =
        await db.select<MediaItem[]>(
          `
          SELECT
            id,
            name,
            path,
            media_type
          FROM media
          WHERE media_type = 'video'
          ORDER BY created_at DESC
          `
        );

      setMedia(rows);
    } catch (err) {
      console.error(
        "Unable to load template preview media:",
        err
      );
    }
  };

  useEffect(() => {
    void loadTemplates();
    void loadMedia();
  }, []);

  const newTemplate = () => {
    const document =
      createDefaultDocument();

    setSelected(null);
    setName("New Template");
    setBackgroundColor(
      document.backgroundColor
    );
    setLayers(document.layers);
    setSelectedLayerId(
      document.layers[1]?.id ?? null
    );
    setMessage("");
    setError("");
  };

  const editTemplate = (
    template: Template
  ) => {
    const document =
      parseDocument(template.layers_json);

    setSelected(template);
    setName(template.name);
    setBackgroundColor(
      document.backgroundColor
    );
    setLayers(document.layers);

    setSelectedLayerId(
      document.layers[
        document.layers.length - 1
      ]?.id ?? null
    );

    setMessage("");
    setError("");
  };

  const updateLayer = (
    id: string,
    changes: Partial<Layer>
  ) => {
    setLayers((current) =>
      current.map((layer) =>
        layer.id === id
          ? { ...layer, ...changes }
          : layer
      )
    );
  };

  const addTextLayer = () => {
    const layer = defaultTextLayer();

    setLayers((current) => [
      ...current,
      {
        ...layer,
        x: 540,
        y: clamp(
          300 + current.length * 100,
          100,
          1700
        ),
      },
    ]);

    setSelectedLayerId(layer.id);
  };

  const addVideoLayer = () => {
    const existingVideo =
      layers.find(
        (layer) => layer.type === "video"
      );

    if (existingVideo) {
      setSelectedLayerId(
        existingVideo.id
      );
      return;
    }

    const layer = defaultVideoLayer();

    setLayers((current) => [
      ...current,
      layer,
    ]);

    setSelectedLayerId(layer.id);
  };

  const removeLayer = (id: string) => {
    setLayers((current) =>
      current.filter(
        (layer) => layer.id !== id
      )
    );

    if (selectedLayerId === id) {
      setSelectedLayerId(null);
    }
  };

  const moveLayerUp = (id: string) => {
    setLayers((current) => {
      const index = current.findIndex(
        (layer) => layer.id === id
      );

      if (
        index === -1 ||
        index === current.length - 1
      ) {
        return current;
      }

      const next = [...current];
      const item = next[index];

      next[index] = next[index + 1];
      next[index + 1] = item;

      return next;
    });
  };

  const moveLayerDown = (id: string) => {
    setLayers((current) => {
      const index = current.findIndex(
        (layer) => layer.id === id
      );

      if (index <= 0) {
        return current;
      }

      const next = [...current];
      const item = next[index];

      next[index] = next[index - 1];
      next[index - 1] = item;

      return next;
    });
  };

  const startLayerInteraction = (
    event: ReactPointerEvent,
    layer: Layer,
    mode: "move" | "resize",
    handle?: ResizeHandle
  ) => {
    event.preventDefault();
    event.stopPropagation();

    setSelectedLayerId(layer.id);

    dragRef.current = {
      id: layer.id,
      mode,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: layer.x,
      startY: layer.y,
      startWidth: layer.width,
      startHeight: layer.height,
    };

    (
      event.currentTarget as HTMLElement
    ).setPointerCapture?.(event.pointerId);
  };

  const handleCanvasPointerMove = (
    event: ReactPointerEvent
  ) => {
    const drag = dragRef.current;

    if (!drag) {
      return;
    }

    const canvas =
      canvasRef.current;

    if (!canvas) {
      return;
    }

    const rect =
      canvas.getBoundingClientRect();

    const scaleX =
      CANVAS_WIDTH / rect.width;

    const scaleY =
      CANVAS_HEIGHT / rect.height;

    const deltaX =
      (event.clientX -
        drag.startClientX) *
      scaleX;

    const deltaY =
      (event.clientY -
        drag.startClientY) *
      scaleY;

    const current =
      layers.find(
        (layer) => layer.id === drag.id
      );

    if (!current) {
      return;
    }

    if (drag.mode === "move") {
      const nextX = clamp(
        drag.startX + deltaX,
        0,
        CANVAS_WIDTH -
          current.width
      );

      const nextY = clamp(
        drag.startY + deltaY,
        0,
        CANVAS_HEIGHT -
          current.height
      );

      updateLayer(drag.id, {
        x: Math.round(nextX),
        y: Math.round(nextY),
      });

      return;
    }

    const handle = drag.handle;

    if (!handle) {
      return;
    }

    let x = drag.startX;
    let y = drag.startY;
    let width = drag.startWidth;
    let height = drag.startHeight;

    if (handle.includes("e")) {
      width =
        drag.startWidth + deltaX;
    }

    if (handle.includes("s")) {
      height =
        drag.startHeight + deltaY;
    }

    if (handle.includes("w")) {
      width =
        drag.startWidth - deltaX;

      x =
        drag.startX + deltaX;
    }

    if (handle.includes("n")) {
      height =
        drag.startHeight - deltaY;

      y =
        drag.startY + deltaY;
    }

    if (current.type === "video") {
      width = Math.max(
        MIN_VIDEO_WIDTH,
        width
      );

      height = Math.max(
        MIN_VIDEO_HEIGHT,
        height
      );
    } else {
      width = Math.max(
        120,
        width
      );

      height = Math.max(
        60,
        height
      );
    }

    if (x < 0) {
      width += x;
      x = 0;
    }

    if (y < 0) {
      height += y;
      y = 0;
    }

    if (
      x + width >
      CANVAS_WIDTH
    ) {
      width =
        CANVAS_WIDTH - x;
    }

    if (
      y + height >
      CANVAS_HEIGHT
    ) {
      height =
        CANVAS_HEIGHT - y;
    }

    updateLayer(drag.id, {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    });
  };

  const finishLayerInteraction = () => {
    dragRef.current = null;
  };

  const saveTemplate = async () => {
    const cleanName =
      name.trim() ||
      "Untitled Template";

    const document: TemplateDocument = {
      backgroundColor,
      layers,
    };

    try {
      setSaving(true);
      setMessage("");
      setError("");

      const db = await dbPromise;
      const now =
        new Date().toISOString();

      const id =
        selected?.id ??
        `template-${Date.now()}`;

      if (selected) {
        await db.execute(
          `
          UPDATE templates
          SET
            name = ?,
            width = ?,
            height = ?,
            layers_json = ?,
            updated_at = ?
          WHERE id = ?
          `,
          [
            cleanName,
            CANVAS_WIDTH,
            CANVAS_HEIGHT,
            JSON.stringify(document),
            now,
            id,
          ]
        );
      } else {
        await db.execute(
          `
          INSERT INTO templates (
            id,
            name,
            width,
            height,
            layers_json,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            id,
            cleanName,
            CANVAS_WIDTH,
            CANVAS_HEIGHT,
            JSON.stringify(document),
            now,
            now,
          ]
        );
      }

      setMessage(
        selected
          ? "Template updated."
          : "Template created."
      );

      await loadTemplates();

      const rows =
        await db.select<Template[]>(
          `
          SELECT
            id,
            name,
            width,
            height,
            layers_json,
            created_at,
            updated_at
          FROM templates
          WHERE id = ?
          LIMIT 1
          `,
          [id]
        );

      if (rows[0]) {
        setSelected(rows[0]);
      }
    } catch (err) {
      setError(
        `Unable to save template: ${String(err)}`
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteTemplate = async (
    template: Template
  ) => {
    const confirmed =
      window.confirm(
        `Delete "${template.name}"?`
      );

    if (!confirmed) {
      return;
    }

    try {
      const db = await dbPromise;

      await db.execute(
        "DELETE FROM templates WHERE id = ?",
        [template.id]
      );

      if (
        selected?.id ===
        template.id
      ) {
        newTemplate();
      }

      setMessage(
        "Template deleted."
      );

      await loadTemplates();
    } catch (err) {
      setError(
        `Unable to delete template: ${String(err)}`
      );
    }
  };

  const renderResizeHandles = (
    layer: Layer
  ) => {
    const handles: ResizeHandle[] = [
      "nw",
      "n",
      "ne",
      "e",
      "se",
      "s",
      "sw",
      "w",
    ];

    return handles.map(
      (handle) => {
        const positions: Record<
          ResizeHandle,
          React.CSSProperties
        > = {
          nw: {
            left: -6,
            top: -6,
            cursor: "nwse-resize",
          },
          n: {
            left: "50%",
            top: -6,
            cursor: "ns-resize",
          },
          ne: {
            right: -6,
            top: -6,
            cursor: "nesw-resize",
          },
          e: {
            right: -6,
            top: "50%",
            cursor: "ew-resize",
          },
          se: {
            right: -6,
            bottom: -6,
            cursor: "nwse-resize",
          },
          s: {
            left: "50%",
            bottom: -6,
            cursor: "ns-resize",
          },
          sw: {
            left: -6,
            bottom: -6,
            cursor: "nesw-resize",
          },
          w: {
            left: -6,
            top: "50%",
            cursor: "ew-resize",
          },
        };

        return (
          <div
            key={handle}
            onPointerDown={(event) =>
              startLayerInteraction(
                event,
                layer,
                "resize",
                handle
              )
            }
            style={{
              position: "absolute",
              width: 12,
              height: 12,
              borderRadius: 3,
              background: "#ffffff",
              border:
                "2px solid #111111",
              transform:
                "translate(-50%, -50%)",
              zIndex: 20,
              ...positions[handle],
            }}
          />
        );
      }
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">
            TEMPLATE STUDIO
          </p>

          <h1>
            Build your layout
          </h1>

          <p className="page-description">
            Design the exact 1080 × 1920
            composition used when your
            variations are rendered.
          </p>
        </div>

        <div className="toolbar-actions">
          <button
            className="secondary-button"
            onClick={newTemplate}
          >
            New Template
          </button>

          <button
            className="primary-button"
            onClick={saveTemplate}
            disabled={saving}
          >
            {saving
              ? "Saving..."
              : "Save Template"}
          </button>
        </div>
      </div>

      {message && (
        <div className="message">
          {message}
        </div>
      )}

      {error && (
        <div className="message error">
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(0, 1fr) 380px",
          gap: 18,
          marginTop: 18,
          alignItems: "start",
        }}
      >
        <section className="feature-card">
          <div
            style={{
              display: "flex",
              justifyContent:
                "space-between",
              alignItems: "center",
              gap: 16,
              marginBottom: 16,
            }}
          >
            <div>
              <p className="eyebrow">
                CANVAS
              </p>

              <h3>
                {selected
                  ? selected.name
                  : "New Template"}
              </h3>
            </div>

            <div
              style={{
                fontSize: 12,
                color:
                  "var(--text-muted, #8b92a3)",
              }}
            >
              1080 × 1920
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent:
                "center",
              background:
                "rgba(0,0,0,.12)",
              borderRadius: 16,
              padding: 24,
            }}
          >
            <div
              ref={canvasRef}
              onPointerMove={
                handleCanvasPointerMove
              }
              onPointerUp={
                finishLayerInteraction
              }
              onPointerCancel={
                finishLayerInteraction
              }
              onPointerDown={() =>
                setSelectedLayerId(
                  null
                )
              }
              style={{
                position: "relative",
                width: "min(100%, 420px)",
                aspectRatio:
                  "1080 / 1920",
                background:
                  backgroundColor,
                overflow: "hidden",
                borderRadius: 12,
                boxShadow:
                  "0 18px 50px rgba(0,0,0,.3)",
                userSelect: "none",
                touchAction: "none",
              }}
            >
              {layers.map(
                (layer) => {
                  const isSelected =
                    layer.id ===
                    selectedLayerId;

                  const left =
                    (layer.x /
                      CANVAS_WIDTH) *
                    100;

                  const top =
                    (layer.y /
                      CANVAS_HEIGHT) *
                    100;

                  const width =
                    (layer.width /
                      CANVAS_WIDTH) *
                    100;

                  const height =
                    (layer.height /
                      CANVAS_HEIGHT) *
                    100;

                  if (
                    layer.type ===
                    "video"
                  ) {
                    return (
                      <div
                        key={layer.id}
                        onPointerDown={(
                          event
                        ) =>
                          startLayerInteraction(
                            event,
                            layer,
                            "move"
                          )
                        }
                        style={{
                          position:
                            "absolute",
                          left: `${left}%`,
                          top: `${top}%`,
                          width: `${width}%`,
                          height: `${height}%`,
                          border: isSelected
                            ? "2px solid #ffffff"
                            : "1px dashed rgba(255,255,255,.55)",
                          boxSizing:
                            "border-box",
                          background:
                            "#0b0d11",
                          overflow:
                            "visible",
                          cursor:
                            "move",
                          zIndex:
                            isSelected
                              ? 50
                              : 10,
                        }}
                      >
                        {previewVideo ? (
                          <video
                            src={convertFileSrc(
                              previewVideo.path
                            )}
                            muted
                            loop
                            autoPlay
                            playsInline
                            style={{
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
                        ) : (
                          <div
                            style={{
                              width:
                                "100%",
                              height:
                                "100%",
                              display:
                                "flex",
                              alignItems:
                                "center",
                              justifyContent:
                                "center",
                              color:
                                "rgba(255,255,255,.7)",
                              fontSize: 13,
                              textAlign:
                                "center",
                              padding: 20,
                              boxSizing:
                                "border-box",
                              background:
                                "linear-gradient(135deg,#171a21,#0d0f13)",
                            }}
                          >
                            Select a preview
                            video
                          </div>
                        )}

                        {isSelected &&
                          renderResizeHandles(
                            layer
                          )}
                      </div>
                    );
                  }

                  const fontSize =
                    ((layer.fontSize ??
                      72) /
                      CANVAS_HEIGHT) *
                    420;

                  return (
                    <div
                      key={layer.id}
                      onPointerDown={(
                        event
                      ) =>
                        startLayerInteraction(
                          event,
                          layer,
                          "move"
                        )
                      }
                      style={{
                        position:
                          "absolute",
                        left: `${left}%`,
                        top: `${top}%`,
                        width: `${width}%`,
                        height: `${height}%`,
                        boxSizing:
                          "border-box",
                        border: isSelected
                          ? "1px solid rgba(255,255,255,.8)"
                          : "1px dashed transparent",
                        cursor:
                          "move",
                        zIndex:
                          isSelected
                            ? 60
                            : 30,
                        display:
                          "flex",
                        alignItems:
                          "center",
                        justifyContent:
                          "center",
                        textAlign:
                          "center",
                        padding: 8,
                      }}
                    >
                      <div
                        style={{
                          width: "100%",
                          color:
                            layer.color ??
                            "#111111",
                          fontSize,
                          lineHeight:
                            1.05,
                          opacity:
                            layer.opacity ??
                            1,
                          fontWeight:
                            700,
                          textShadow:
                            layer.shadow
                              ? "3px 3px 5px rgba(0,0,0,.65)"
                              : undefined,
                          WebkitTextStroke:
                            (layer.borderWidth ??
                              0) > 0
                              ? `${Math.max(
                                  1,
                                  ((layer.borderWidth ??
                                    0) /
                                    CANVAS_HEIGHT) *
                                    420
                                )}px ${
                                  layer.borderColor ??
                                  "#000000"
                                }`
                              : undefined,
                          overflow:
                            "hidden",
                          wordBreak:
                            "break-word",
                        }}
                      >
                        {(
                          layer.text ??
                          ""
                        )
                          .replace(
                            "{{text}}",
                            "Your variation"
                          )
                          .replace(
                            "{{TEXT}}",
                            "Your variation"
                          )}
                      </div>

                      {isSelected &&
                        renderResizeHandles(
                          layer
                        )}
                    </div>
                  );
                }
              )}
            </div>
          </div>

          <p
            className="muted"
            style={{
              marginTop: 14,
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            Drag elements to move them.
            Select the video and drag any
            corner or edge handle to resize
            it. The saved coordinates are
            used by the renderer.
          </p>
        </section>

        <aside
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            position: "sticky",
            top: 18,
          }}
        >
          <section className="feature-card">
            <p className="eyebrow">
              TEMPLATE
            </p>

            <div
              className="form-grid"
              style={{ marginTop: 14 }}
            >
              <label className="field full">
                <span className="field-label">
                  Template name
                </span>

                <input
                  className="text-input"
                  value={name}
                  onChange={(event) =>
                    setName(
                      event.target.value
                    )
                  }
                />
              </label>

              <label className="field full">
                <span className="field-label">
                  Background color
                </span>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "58px 1fr",
                    gap: 10,
                  }}
                >
                  <input
                    type="color"
                    value={
                      backgroundColor
                    }
                    onChange={(event) =>
                      setBackgroundColor(
                        event.target.value
                      )
                    }
                    style={{
                      width: 58,
                      height: 42,
                      padding: 3,
                      borderRadius: 8,
                      border:
                        "1px solid var(--border)",
                      background:
                        "transparent",
                    }}
                  />

                  <input
                    className="text-input"
                    value={
                      backgroundColor
                    }
                    onChange={(event) =>
                      setBackgroundColor(
                        event.target.value
                      )
                    }
                  />
                </div>
              </label>
            </div>
          </section>

          <section className="feature-card">
            <div
              style={{
                display: "flex",
                justifyContent:
                  "space-between",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div>
                <p className="eyebrow">
                  ELEMENTS
                </p>

                <h3>
                  Layers
                </h3>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "1fr 1fr",
                gap: 8,
                marginTop: 14,
              }}
            >
              <button
                className="secondary-button"
                onClick={
                  addVideoLayer
                }
              >
                + Video
              </button>

              <button
                className="secondary-button"
                onClick={
                  addTextLayer
                }
              >
                + Text
              </button>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection:
                  "column",
                gap: 8,
                marginTop: 14,
              }}
            >
              {[...layers]
                .reverse()
                .map(
                  (
                    layer,
                    reverseIndex
                  ) => {
                    const actualIndex =
                      layers.length -
                      1 -
                      reverseIndex;

                    const active =
                      layer.id ===
                      selectedLayerId;

                    return (
                      <button
                        key={
                          layer.id
                        }
                        type="button"
                        onClick={() =>
                          setSelectedLayerId(
                            layer.id
                          )
                        }
                        style={{
                          display:
                            "flex",
                          alignItems:
                            "center",
                          gap: 10,
                          width: "100%",
                          padding:
                            "10px 11px",
                          textAlign:
                            "left",
                          borderRadius: 9,
                          border: active
                            ? "1px solid rgba(255,255,255,.35)"
                            : "1px solid var(--border)",
                          background:
                            active
                              ? "rgba(255,255,255,.08)"
                              : "rgba(255,255,255,.025)",
                          color:
                            "inherit",
                          cursor:
                            "pointer",
                        }}
                      >
                        <span
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 7,
                            display:
                              "flex",
                            alignItems:
                              "center",
                            justifyContent:
                              "center",
                            background:
                              layer.type ===
                              "video"
                                ? "#202632"
                                : "#e8e8e8",
                            color:
                              layer.type ===
                              "video"
                                ? "#ffffff"
                                : "#111111",
                            fontSize: 11,
                            flexShrink: 0,
                          }}
                        >
                          {layer.type ===
                          "video"
                            ? "▶"
                            : "T"}
                        </span>

                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            overflow:
                              "hidden",
                            textOverflow:
                              "ellipsis",
                            whiteSpace:
                              "nowrap",
                            fontSize: 12,
                          }}
                        >
                          {layerLabel(
                            layer,
                            actualIndex
                          )}
                        </span>
                      </button>
                    );
                  }
                )}
            </div>
          </section>

          {selectedLayer && (
            <section className="feature-card">
              <p className="eyebrow">
                SELECTED ELEMENT
              </p>

              <h3
                style={{
                  marginTop: 4,
                }}
              >
                {selectedLayer.type ===
                "video"
                  ? "Video Frame"
                  : "Text Box"}
              </h3>

              {selectedLayer.type ===
              "video" ? (
                <>
                  <div
                    className="form-grid"
                    style={{
                      marginTop: 14,
                    }}
                  >
                    <label className="field">
                      <span className="field-label">
                        X
                      </span>

                      <input
                        className="number-input"
                        type="number"
                        value={
                          selectedLayer.x
                        }
                        onChange={(
                          event
                        ) =>
                          updateLayer(
                            selectedLayer.id,
                            {
                              x: clamp(
                                Number(
                                  event
                                    .target
                                    .value
                                ),
                                0,
                                CANVAS_WIDTH -
                                  selectedLayer.width
                              ),
                            }
                          )
                        }
                      />
                    </label>

                    <label className="field">
                      <span className="field-label">
                        Y
                      </span>

                      <input
                        className="number-input"
                        type="number"
                        value={
                          selectedLayer.y
                        }
                        onChange={(
                          event
                        ) =>
                          updateLayer(
                            selectedLayer.id,
                            {
                              y: clamp(
                                Number(
                                  event
                                    .target
                                    .value
                                ),
                                0,
                                CANVAS_HEIGHT -
                                  selectedLayer.height
                              ),
                            }
                          )
                        }
                      />
                    </label>

                    <label className="field">
                      <span className="field-label">
                        Width
                      </span>

                      <input
                        className="number-input"
                        type="number"
                        min={
                          MIN_VIDEO_WIDTH
                        }
                        value={
                          selectedLayer.width
                        }
                        onChange={(
                          event
                        ) =>
                          updateLayer(
                            selectedLayer.id,
                            {
                              width: clamp(
                                Number(
                                  event
                                    .target
                                    .value
                                ),
                                MIN_VIDEO_WIDTH,
                                CANVAS_WIDTH -
                                  selectedLayer.x
                              ),
                            }
                          )
                        }
                      />
                    </label>

                    <label className="field">
                      <span className="field-label">
                        Height
                      </span>

                      <input
                        className="number-input"
                        type="number"
                        min={
                          MIN_VIDEO_HEIGHT
                        }
                        value={
                          selectedLayer.height
                        }
                        onChange={(
                          event
                        ) =>
                          updateLayer(
                            selectedLayer.id,
                            {
                              height: clamp(
                                Number(
                                  event
                                    .target
                                    .value
                                ),
                                MIN_VIDEO_HEIGHT,
                                CANVAS_HEIGHT -
                                  selectedLayer.y
                              ),
                            }
                          )
                        }
                      />
                    </label>
                  </div>

                  <button
                    className="secondary-button"
                    style={{
                      width: "100%",
                      marginTop: 12,
                    }}
                    onClick={() =>
                      setShowMediaPicker(
                        true
                      )
                    }
                  >
                    {previewVideo
                      ? "Change Preview Video"
                      : "Choose Preview Video"}
                  </button>

                  {previewVideo && (
                    <p
                      className="muted"
                      style={{
                        marginTop: 8,
                        fontSize: 11,
                      }}
                    >
                      Previewing:{" "}
                      {previewVideo.name}
                      <br />
                      This does not become part
                      of the saved template.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div
                    className="form-grid"
                    style={{
                      marginTop: 14,
                    }}
                  >
                    <label
                      className="field full"
                    >
                      <span className="field-label">
                        Text
                      </span>

                      <textarea
                        className="text-input"
                        rows={3}
                        value={
                          selectedLayer.text ??
                          ""
                        }
                        onChange={(
                          event
                        ) =>
                          updateLayer(
                            selectedLayer.id,
                            {
                              text:
                                event
                                  .target
                                  .value,
                            }
                          )
                        }
                        style={{
                          resize:
                            "vertical",
                          minHeight: 80,
                        }}
                      />

                      <span
                        style={{
                          color:
                            "var(--muted)",
                          fontSize: 11,
                          lineHeight:
                            1.5,
                        }}
                      >
                        Type normal text, or use{" "}
                        <strong>
                          {"{{text}}"}
                        </strong>{" "}
                        for the variation text.
                      </span>
                    </label>

                    <label className="field">
                      <span className="field-label">
                        X
                      </span>

                      <input
                        className="number-input"
                        type="number"
                        value={
                          selectedLayer.x
                        }
                        onChange={(
                          event
                        ) =>
                          updateLayer(
                            selectedLayer.id,
                            {
                              x: Number(
                                event
                                  .target
                                  .value
                              ),
                            }
                          )
                        }
                      />
                    </label>

                    <label className="field">
                      <span className="field-label">
                        Y
                      </span>

                      <input
                        className="number-input"
                        type="number"
                        value={
                          selectedLayer.y
                        }
                        onChange={(
                          event
                        ) =>
                          updateLayer(
                            selectedLayer.id,
                            {
                              y: Number(
                                event
                                  .target
                                  .value
                              ),
                            }
                          )
                        }
                      />
                    </label>

                    <label className="field">
                      <span className="field-label">
                        Width
                      </span>

                      <input
                        className="number-input"
                        type="number"
                        min={120}
                        value={
                          selectedLayer.width
                        }
                        onChange={(
                          event
                        ) =>
                          updateLayer(
                            selectedLayer.id,
                            {
                              width: Math.max(
                                120,
                                Number(
                                  event
                                    .target
                                    .value
                                )
                              ),
                            }
                          )
                        }
                      />
                    </label>

                    <label className="field">
                      <span className="field-label">
                        Height
                      </span>

                      <input
                        className="number-input"
                        type="number"
                        min={60}
                        value={
                          selectedLayer.height
                        }
                        onChange={(
                          event
                        ) =>
                          updateLayer(
                            selectedLayer.id,
                            {
                              height: Math.max(
                                60,
                                Number(
                                  event
                                    .target
                                    .value
                                )
                              ),
                            }
                          )
                        }
                      />
                    </label>

                    <label className="field">
                      <span className="field-label">
                        Font size
                      </span>

                      <input
                        className="number-input"
                        type="number"
                        min={8}
                        value={
                          selectedLayer.fontSize ??
                          72
                        }
                        onChange={(
                          event
                        ) =>
                          updateLayer(
                            selectedLayer.id,
                            {
                              fontSize:
                                Math.max(
                                  8,
                                  Number(
                                    event
                                      .target
                                      .value
                                  )
                                ),
                            }
                          )
                        }
                      />
                    </label>

                    <label className="field">
                      <span className="field-label">
                        Text color
                      </span>

                      <input
                        type="color"
                        value={
                          selectedLayer.color ??
                          "#111111"
                        }
                        onChange={(
                          event
                        ) =>
                          updateLayer(
                            selectedLayer.id,
                            {
                              color:
                                event
                                  .target
                                  .value,
                            }
                          )
                        }
                        style={{
                          width: "100%",
                          height: 42,
                        }}
                      />
                    </label>

                    <label className="field">
                      <span className="field-label">
                        Opacity
                      </span>

                      <input
                        className="range"
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={
                          selectedLayer.opacity ??
                          1
                        }
                        onChange={(
                          event
                        ) =>
                          updateLayer(
                            selectedLayer.id,
                            {
                              opacity:
                                Number(
                                  event
                                    .target
                                    .value
                                ),
                            }
                          )
                        }
                      />
                    </label>

                    <label className="field">
                      <span className="field-label">
                        Outline
                      </span>

                      <input
                        className="number-input"
                        type="number"
                        min={0}
                        max={20}
                        value={
                          selectedLayer.borderWidth ??
                          0
                        }
                        onChange={(
                          event
                        ) =>
                          updateLayer(
                            selectedLayer.id,
                            {
                              borderWidth:
                                Number(
                                  event
                                    .target
                                    .value
                                ),
                            }
                          )
                        }
                      />
                    </label>

                    <label
                      className="field"
                      style={{
                        flexDirection:
                          "row",
                        alignItems:
                          "center",
                        gap: 9,
                        paddingTop: 22,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={
                          selectedLayer.shadow ??
                          false
                        }
                        onChange={(
                          event
                        ) =>
                          updateLayer(
                            selectedLayer.id,
                            {
                              shadow:
                                event
                                  .target
                                  .checked,
                            }
                          )
                        }
                      />

                      <span className="field-label">
                        Shadow
                      </span>
                    </label>
                  </div>
                </>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "1fr 1fr",
                  gap: 8,
                  marginTop: 14,
                }}
              >
                <button
                  className="secondary-button"
                  onClick={() =>
                    moveLayerDown(
                      selectedLayer.id
                    )
                  }
                >
                  Send Back
                </button>

                <button
                  className="secondary-button"
                  onClick={() =>
                    moveLayerUp(
                      selectedLayer.id
                    )
                  }
                >
                  Bring Forward
                </button>
              </div>

              <button
                className="danger-button"
                style={{
                  width: "100%",
                  marginTop: 8,
                }}
                onClick={() =>
                  removeLayer(
                    selectedLayer.id
                  )
                }
              >
                Remove Element
              </button>
            </section>
          )}

          <section className="feature-card">
            <p className="eyebrow">
              SAVED TEMPLATES
            </p>

            <div
              className="stack"
              style={{ marginTop: 14 }}
            >
              {loading ? (
                <p className="muted">
                  Loading...
                </p>
              ) : templates.length ===
                0 ? (
                <p className="muted">
                  No templates yet.
                </p>
              ) : (
                templates.map(
                  (template) => (
                    <div
                      key={template.id}
                      style={{
                        display:
                          "flex",
                        justifyContent:
                          "space-between",
                        alignItems:
                          "center",
                        gap: 10,
                        paddingBottom:
                          10,
                        borderBottom:
                          "1px solid var(--border)",
                      }}
                    >
                      <button
                        className="nav-item"
                        style={{
                          padding: 0,
                          minWidth: 0,
                          overflow:
                            "hidden",
                          textOverflow:
                            "ellipsis",
                          whiteSpace:
                            "nowrap",
                        }}
                        onClick={() =>
                          editTemplate(
                            template
                          )
                        }
                      >
                        {template.name}
                      </button>

                      <button
                        className="danger-button"
                        onClick={() =>
                          deleteTemplate(
                            template
                          )
                        }
                      >
                        Delete
                      </button>
                    </div>
                  )
                )
              )}
            </div>
          </section>
        </aside>
      </div>

      {showMediaPicker && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background:
              "rgba(0,0,0,.68)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent:
              "center",
            padding: 24,
          }}
          onClick={() =>
            setShowMediaPicker(false)
          }
        >
          <div
            className="feature-card"
            style={{
              width:
                "min(900px, 100%)",
              maxHeight:
                "80vh",
              overflow:
                "auto",
            }}
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "space-between",
                alignItems:
                  "center",
              }}
            >
              <div>
                <p className="eyebrow">
                  PREVIEW MEDIA
                </p>

                <h3>
                  Choose a video
                </h3>
              </div>

              <button
                className="secondary-button"
                onClick={() =>
                  setShowMediaPicker(
                    false
                  )
                }
              >
                Close
              </button>
            </div>

            {media.length === 0 ? (
              <p
                className="muted"
                style={{
                  marginTop: 20,
                }}
              >
                No videos are in your
                Media Library yet.
              </p>
            ) : (
              <div
                style={{
                  display:
                    "grid",
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(190px, 1fr))",
                  gap: 12,
                  marginTop: 18,
                }}
              >
                {media.map(
                  (video) => (
                    <button
                      key={video.id}
                      type="button"
                      onClick={() => {
                        setPreviewVideo(
                          video
                        );
                        setShowMediaPicker(
                          false
                        );
                      }}
                      style={{
                        padding: 0,
                        overflow:
                          "hidden",
                        borderRadius:
                          12,
                        border:
                          "1px solid var(--border)",
                        background:
                          "rgba(255,255,255,.025)",
                        color:
                          "inherit",
                        textAlign:
                          "left",
                        cursor:
                          "pointer",
                      }}
                    >
                      <div
                        style={{
                          aspectRatio:
                            "16 / 9",
                          background:
                            "#0b0d11",
                          overflow:
                            "hidden",
                        }}
                      >
                        <video
                          src={convertFileSrc(
                            video.path
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
                            display:
                              "block",
                          }}
                        />
                      </div>

                      <div
                        style={{
                          padding:
                            "10px 12px",
                          fontSize: 12,
                        }}
                      >
                        {video.name}
                      </div>
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Templates;
