CREATE EXTENSION IF NOT EXISTS "pgcrypto";


CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    email TEXT NOT NULL UNIQUE,

    password_hash TEXT NOT NULL,

    display_name TEXT NOT NULL DEFAULT '',

    role TEXT NOT NULL DEFAULT 'user'
        CHECK (role IN ('admin', 'user')),

    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended')),

    plan TEXT NOT NULL DEFAULT 'free'
        CHECK (
            plan IN (
                'free',
                'pro',
                'creator',
                'business',
                'enterprise'
            )
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    last_active_at TIMESTAMPTZ
);


CREATE INDEX IF NOT EXISTS idx_users_email
    ON users(email);


CREATE INDEX IF NOT EXISTS idx_users_status
    ON users(status);


CREATE INDEX IF NOT EXISTS idx_users_role
    ON users(role);


CREATE TABLE IF NOT EXISTS usage (
    user_id UUID PRIMARY KEY
        REFERENCES users(id)
        ON DELETE CASCADE,

    render_count BIGINT NOT NULL DEFAULT 0,

    project_count BIGINT NOT NULL DEFAULT 0,

    storage_bytes BIGINT NOT NULL DEFAULT 0,

    download_count BIGINT NOT NULL DEFAULT 0,

    ai_generation_count BIGINT NOT NULL DEFAULT 0,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    event_type TEXT NOT NULL,

    description TEXT NOT NULL DEFAULT '',

    ip_address TEXT,

    user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX IF NOT EXISTS idx_activity_user_id
    ON activity(user_id);


CREATE INDEX IF NOT EXISTS idx_activity_created_at
    ON activity(created_at DESC);


CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    token_id UUID NOT NULL UNIQUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    expires_at TIMESTAMPTZ NOT NULL,

    revoked_at TIMESTAMPTZ,

    device_name TEXT,

    device_type TEXT
);


CREATE INDEX IF NOT EXISTS idx_sessions_user_id
    ON sessions(user_id);


CREATE INDEX IF NOT EXISTS idx_sessions_token_id
    ON sessions(token_id);


CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,

    name TEXT NOT NULL,

    monthly_render_limit BIGINT,

    storage_limit_bytes BIGINT,

    ai_generation_limit BIGINT,

    max_projects BIGINT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


INSERT INTO plans (
    id,
    name,
    monthly_render_limit,
    storage_limit_bytes,
    ai_generation_limit,
    max_projects
)
VALUES
    (
        'free',
        'Free',
        10,
        1073741824,
        5,
        5
    ),
    (
        'pro',
        'Pro',
        100,
        10737418240,
        100,
        50
    ),
    (
        'creator',
        'Creator',
        500,
        53687091200,
        500,
        250
    ),
    (
        'business',
        'Business',
        2500,
        214748364800,
        2500,
        1000
    ),
    (
        'enterprise',
        'Enterprise',
        NULL,
        NULL,
        NULL,
        NULL
    )
ON CONFLICT (id) DO NOTHING;


CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,

    value TEXT NOT NULL,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


INSERT INTO system_settings (
    key,
    value
)
VALUES
    (
        'maintenance_mode',
        'false'
    ),
    (
        'allow_registration',
        'true'
    )
ON CONFLICT (key) DO NOTHING;
