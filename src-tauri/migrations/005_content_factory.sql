CREATE TABLE IF NOT EXISTS content_recipes (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    source_media_id TEXT,
    template_id TEXT,
    audio_media_id TEXT,
    clip_length INTEGER NOT NULL DEFAULT 12,
    original_audio REAL NOT NULL DEFAULT 0.80,
    mute_original_audio INTEGER NOT NULL DEFAULT 0,
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_recipes_updated_at
ON content_recipes(updated_at);

CREATE TABLE IF NOT EXISTS content_batches (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    recipe_id TEXT,
    topic TEXT NOT NULL DEFAULT '',
    style TEXT NOT NULL DEFAULT '',
    variation_count INTEGER NOT NULL DEFAULT 10,
    status TEXT NOT NULL DEFAULT 'draft',
    settings_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_batches_recipe_id
ON content_batches(recipe_id);

CREATE INDEX IF NOT EXISTS idx_content_batches_updated_at
ON content_batches(updated_at);

CREATE INDEX IF NOT EXISTS idx_content_batches_status
ON content_batches(status);

CREATE TABLE IF NOT EXISTS content_variations (
    id TEXT PRIMARY KEY NOT NULL,
    batch_id TEXT NOT NULL,
    variation_number INTEGER NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    project_id TEXT,
    rendered_video_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_variations_batch_id
ON content_variations(batch_id);

CREATE INDEX IF NOT EXISTS idx_content_variations_status
ON content_variations(status);
