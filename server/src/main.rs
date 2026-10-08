use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{delete, get, post, put},
    Json, Router,
};

use argon2::{
    password_hash::{
        rand_core::OsRng,
        PasswordHash,
        PasswordHasher,
        PasswordVerifier,
        SaltString,
    },
    Argon2,
};

use chrono::{DateTime, Duration, Utc};

use dotenvy::dotenv;

use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};

use serde::{Deserialize, Serialize};

use sqlx::{
    postgres::PgPoolOptions,
    FromRow,
    PgPool,
};

use std::{
    env,
    net::SocketAddr,
    sync::Arc,
};

use tower_http::{
    cors::CorsLayer,
    trace::TraceLayer,
};

use tracing::{error, info};

use uuid::Uuid;


#[derive(Clone)]
struct AppState {
    db: PgPool,
    jwt_secret: Arc<String>,
}


#[derive(Debug, Serialize)]
struct HealthResponse {
    message: String,
}


#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    email: String,
    role: String,
    exp: usize,
    iat: usize,
    jti: String,
}


#[derive(Debug, Serialize, Deserialize)]
struct RegisterRequest {
    email: String,
    password: String,
    display_name: Option<String>,
}


#[derive(Debug, Serialize, Deserialize)]
struct LoginRequest {
    email: String,
    password: String,
}


#[derive(Debug, Serialize)]
struct AuthResponse {
    token: String,
    user: UserResponse,
}


#[derive(Debug, Serialize)]
struct UserResponse {
    id: Uuid,
    email: String,
    display_name: String,
    role: String,
    status: String,
    plan: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    last_active_at: Option<DateTime<Utc>>,
}


#[derive(Debug, FromRow)]
struct UserRow {
    id: Uuid,
    email: String,
    password_hash: String,
    display_name: String,
    role: String,
    status: String,
    plan: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    last_active_at: Option<DateTime<Utc>>,
}


#[derive(Debug, Serialize, FromRow)]
struct UsageResponse {
    user_id: Uuid,
    render_count: i64,
    project_count: i64,
    storage_bytes: i64,
    download_count: i64,
    ai_generation_count: i64,
    updated_at: DateTime<Utc>,
}


#[derive(Debug, Deserialize)]
struct UsageUpdateRequest {
    render_count: Option<i64>,
    project_count: Option<i64>,
    storage_bytes: Option<i64>,
    download_count: Option<i64>,
    ai_generation_count: Option<i64>,
}


#[derive(Debug, Deserialize)]
struct AdminUserUpdateRequest {
    display_name: Option<String>,
    role: Option<String>,
    status: Option<String>,
    plan: Option<String>,
}


#[derive(Debug, Serialize, FromRow)]
struct ActivityResponse {
    id: Uuid,
    user_id: Option<Uuid>,
    event_type: String,
    description: String,
    ip_address: Option<String>,
    user_agent: Option<String>,
    created_at: DateTime<Utc>,
}


#[derive(Debug, Serialize)]
struct AdminUserResponse {
    user: UserResponse,
    usage: UsageResponse,
}


#[derive(Debug)]
struct AuthenticatedUser {
    user_id: Uuid,
    email: String,
    role: String,
}


fn env_or_default(name: &str, default: &str) -> String {
    env::var(name).unwrap_or_else(|_| default.to_string())
}


fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);

    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| error.to_string())
}


fn verify_password(password: &str, password_hash: &str) -> bool {
    let parsed_hash = match PasswordHash::new(password_hash) {
        Ok(hash) => hash,
        Err(_) => return false,
    };

    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}


fn create_token(
    user: &UserRow,
    jwt_secret: &str,
) -> Result<(String, Uuid), String> {
    let now = Utc::now();
    let expiration = now + Duration::days(30);

    let token_id = Uuid::new_v4();

    let claims = Claims {
        sub: user.id.to_string(),
        email: user.email.clone(),
        role: user.role.clone(),
        exp: expiration.timestamp() as usize,
        iat: now.timestamp() as usize,
        jti: token_id.to_string(),
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )
    .map_err(|error| error.to_string())?;

    Ok((token, token_id))
}


fn user_response(user: &UserRow) -> UserResponse {
    UserResponse {
        id: user.id,
        email: user.email.clone(),
        display_name: user.display_name.clone(),
        role: user.role.clone(),
        status: user.status.clone(),
        plan: user.plan.clone(),
        created_at: user.created_at,
        updated_at: user.updated_at,
        last_active_at: user.last_active_at,
    }
}


async fn get_current_user(
    headers: &HeaderMap,
    state: &AppState,
) -> Result<AuthenticatedUser, (StatusCode, Json<serde_json::Value>)> {
    let authorization = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");

    let token = authorization
        .strip_prefix("Bearer ")
        .unwrap_or("");

    if token.is_empty() {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "Missing authentication token.",
        ));
    }

    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| {
        error_response(
            StatusCode::UNAUTHORIZED,
            "Invalid or expired authentication token.",
        )
    })?;

    let user_id = Uuid::parse_str(&token_data.claims.sub).map_err(|_| {
        error_response(
            StatusCode::UNAUTHORIZED,
            "Invalid user identity.",
        )
    })?;

    let user = sqlx::query_as::<_, UserRow>(
        r#"
        SELECT
            id,
            email,
            password_hash,
            display_name,
            role,
            status,
            plan,
            created_at,
            updated_at,
            last_active_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to load authenticated user: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load user.",
        )
    })?;

    let user = match user {
        Some(user) => user,
        None => {
            return Err(error_response(
                StatusCode::UNAUTHORIZED,
                "User no longer exists.",
            ));
        }
    };

    if user.status != "active" {
        return Err(error_response(
            StatusCode::FORBIDDEN,
            "This account is suspended.",
        ));
    }

    Ok(AuthenticatedUser {
        user_id: user.id,
        email: user.email,
        role: user.role,
    })
}


fn error_response(
    status: StatusCode,
    message: &str,
) -> (StatusCode, Json<serde_json::Value>) {
    (
        status,
        Json(serde_json::json!({
            "error": message
        })),
    )
}


async fn require_admin(
    headers: &HeaderMap,
    state: &AppState,
) -> Result<AuthenticatedUser, (StatusCode, Json<serde_json::Value>)> {
    let user = get_current_user(headers, state).await?;

    if user.role != "admin" {
        return Err(error_response(
            StatusCode::FORBIDDEN,
            "Administrator access is required.",
        ));
    }

    Ok(user)
}


async fn record_activity(
    state: &AppState,
    user_id: Option<Uuid>,
    event_type: &str,
    description: &str,
) {
    if let Err(error) = sqlx::query(
        r#"
        INSERT INTO activity (
            user_id,
            event_type,
            description
        )
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(user_id)
    .bind(event_type)
    .bind(description)
    .execute(&state.db)
    .await
    {
        error!(
            "Failed to record activity: {}",
            error
        );
    }
}


async fn ensure_usage_row(
    state: &AppState,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO usage (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING
        "#,
    )
    .bind(user_id)
    .execute(&state.db)
    .await?;

    Ok(())
}


async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        message: "Content Studio server is healthy.".to_string(),
    })
}


async fn register(
    State(state): State<AppState>,
    Json(request): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<AuthResponse>), (StatusCode, Json<serde_json::Value>)> {
    let email = request.email.trim().to_lowercase();
    let password = request.password.trim();

    if email.is_empty() {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "Email is required.",
        ));
    }

    if !email.contains('@') {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "Please enter a valid email address.",
        ));
    }

    if password.len() < 8 {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "Password must be at least 8 characters.",
        ));
    }

    let existing_user = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE email = $1",
    )
    .bind(&email)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to check existing user: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create account.",
        )
    })?;

    if existing_user > 0 {
        return Err(error_response(
            StatusCode::CONFLICT,
            "An account with that email already exists.",
        ));
    }

    let password_hash = hash_password(password)
        .map_err(|_| {
            error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to secure password.",
            )
        })?;

    let display_name = request
        .display_name
        .unwrap_or_default()
        .trim()
        .to_string();

    let user = sqlx::query_as::<_, UserRow>(
        r#"
        INSERT INTO users (
            email,
            password_hash,
            display_name
        )
        VALUES ($1, $2, $3)
        RETURNING
            id,
            email,
            password_hash,
            display_name,
            role,
            status,
            plan,
            created_at,
            updated_at,
            last_active_at
        "#,
    )
    .bind(&email)
    .bind(&password_hash)
    .bind(&display_name)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to insert user: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create account.",
        )
    })?;

    ensure_usage_row(&state, user.id)
        .await
        .map_err(|error| {
            error!(
                "Failed to create usage row: {}",
                error
            );

            error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to initialize account usage.",
            )
        })?;

    let (token, token_id) = create_token(
        &user,
        &state.jwt_secret,
    )
    .map_err(|_| {
        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create login session.",
        )
    })?;

    sqlx::query(
        r#"
        INSERT INTO sessions (
            user_id,
            token_id,
            expires_at
        )
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(user.id)
    .bind(token_id)
    .bind(Utc::now() + Duration::days(30))
    .execute(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to save session: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create login session.",
        )
    })?;

    record_activity(
        &state,
        Some(user.id),
        "account_created",
        "A new Content Studio account was created.",
    )
    .await;

    Ok((
        StatusCode::CREATED,
        Json(AuthResponse {
            token,
            user: user_response(&user),
        }),
    ))
}


async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<serde_json::Value>)> {
    let email = request.email.trim().to_lowercase();

    let user = sqlx::query_as::<_, UserRow>(
        r#"
        SELECT
            id,
            email,
            password_hash,
            display_name,
            role,
            status,
            plan,
            created_at,
            updated_at,
            last_active_at
        FROM users
        WHERE email = $1
        "#,
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to load login user: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Login failed.",
        )
    })?;

    let user = match user {
        Some(user) => user,
        None => {
            return Err(error_response(
                StatusCode::UNAUTHORIZED,
                "Invalid email or password.",
            ));
        }
    };

    if !verify_password(
        &request.password,
        &user.password_hash,
    ) {
        return Err(error_response(
            StatusCode::UNAUTHORIZED,
            "Invalid email or password.",
        ));
    }

    if user.status != "active" {
        return Err(error_response(
            StatusCode::FORBIDDEN,
            "This account is suspended.",
        ));
    }

    let now = Utc::now();

    sqlx::query(
        r#"
        UPDATE users
        SET
            last_active_at = $1,
            updated_at = $1
        WHERE id = $2
        "#,
    )
    .bind(now)
    .bind(user.id)
    .execute(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to update last active time: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Login failed.",
        )
    })?;

    let (token, token_id) = create_token(
        &user,
        &state.jwt_secret,
    )
    .map_err(|_| {
        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create login session.",
        )
    })?;

    sqlx::query(
        r#"
        INSERT INTO sessions (
            user_id,
            token_id,
            expires_at
        )
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(user.id)
    .bind(token_id)
    .bind(now + Duration::days(30))
    .execute(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to save login session: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to create login session.",
        )
    })?;

    record_activity(
        &state,
        Some(user.id),
        "login",
        "User signed in.",
    )
    .await;

    Ok(Json(AuthResponse {
        token,
        user: UserResponse {
            last_active_at: Some(now),
            ..user_response(&user)
        },
    }))
}


async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<UserResponse>, (StatusCode, Json<serde_json::Value>)> {
    let current_user = get_current_user(
        &headers,
        &state,
    )
    .await?;

    let user = sqlx::query_as::<_, UserRow>(
        r#"
        SELECT
            id,
            email,
            password_hash,
            display_name,
            role,
            status,
            plan,
            created_at,
            updated_at,
            last_active_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(current_user.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to load current user: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load account.",
        )
    })?;

    Ok(Json(user_response(&user)))
}


async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let authorization = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");

    let token = authorization
        .strip_prefix("Bearer ")
        .unwrap_or("");

    if token.is_empty() {
        return Ok(Json(serde_json::json!({
            "message": "Already logged out."
        })));
    }

    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| {
        error_response(
            StatusCode::UNAUTHORIZED,
            "Invalid authentication token.",
        )
    })?;

    let token_id = Uuid::parse_str(
        &token_data.claims.jti,
    )
    .map_err(|_| {
        error_response(
            StatusCode::UNAUTHORIZED,
            "Invalid session.",
        )
    })?;

    sqlx::query(
        r#"
        UPDATE sessions
        SET revoked_at = NOW()
        WHERE token_id = $1
        "#,
    )
    .bind(token_id)
    .execute(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to revoke session: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to log out.",
        )
    })?;

    let user_id = Uuid::parse_str(
        &token_data.claims.sub,
    )
    .ok();

    record_activity(
        &state,
        user_id,
        "logout",
        "User signed out.",
    )
    .await;

    Ok(Json(serde_json::json!({
        "message": "Logged out successfully."
    })))
}


async fn list_users(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<AdminUserResponse>>, (StatusCode, Json<serde_json::Value>)> {
    require_admin(
        &headers,
        &state,
    )
    .await?;

    let users = sqlx::query_as::<_, UserRow>(
        r#"
        SELECT
            id,
            email,
            password_hash,
            display_name,
            role,
            status,
            plan,
            created_at,
            updated_at,
            last_active_at
        FROM users
        ORDER BY created_at DESC
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to list users: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load users.",
        )
    })?;

    let mut response = Vec::with_capacity(users.len());

    for user in users {
        ensure_usage_row(
            &state,
            user.id,
        )
        .await
        .map_err(|error| {
            error!(
                "Failed to initialize usage: {}",
                error
            );

            error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load user usage.",
            )
        })?;

        let usage = sqlx::query_as::<_, UsageResponse>(
            r#"
            SELECT
                user_id,
                render_count,
                project_count,
                storage_bytes,
                download_count,
                ai_generation_count,
                updated_at
            FROM usage
            WHERE user_id = $1
            "#,
        )
        .bind(user.id)
        .fetch_one(&state.db)
        .await
        .map_err(|error| {
            error!(
                "Failed to load usage: {}",
                error
            );

            error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load usage.",
            )
        })?;

        response.push(AdminUserResponse {
            user: user_response(&user),
            usage,
        });
    }

    Ok(Json(response))
}


async fn get_admin_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<Json<AdminUserResponse>, (StatusCode, Json<serde_json::Value>)> {
    require_admin(
        &headers,
        &state,
    )
    .await?;

    let user = sqlx::query_as::<_, UserRow>(
        r#"
        SELECT
            id,
            email,
            password_hash,
            display_name,
            role,
            status,
            plan,
            created_at,
            updated_at,
            last_active_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to load admin user: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load user.",
        )
    })?;

    let user = match user {
        Some(user) => user,
        None => {
            return Err(error_response(
                StatusCode::NOT_FOUND,
                "User not found.",
            ));
        }
    };

    ensure_usage_row(
        &state,
        user.id,
    )
    .await
    .map_err(|error| {
        error!(
            "Failed to initialize usage: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load usage.",
        )
    })?;

    let usage = sqlx::query_as::<_, UsageResponse>(
        r#"
        SELECT
            user_id,
            render_count,
            project_count,
            storage_bytes,
            download_count,
            ai_generation_count,
            updated_at
        FROM usage
        WHERE user_id = $1
        "#,
    )
    .bind(user.id)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to load usage: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load usage.",
        )
    })?;

    Ok(Json(AdminUserResponse {
        user: user_response(&user),
        usage,
    }))
}


async fn update_admin_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
    Json(request): Json<AdminUserUpdateRequest>,
) -> Result<Json<UserResponse>, (StatusCode, Json<serde_json::Value>)> {
    let admin = require_admin(
        &headers,
        &state,
    )
    .await?;

    if let Some(role) = &request.role {
        if role != "admin" && role != "user" {
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                "Invalid role.",
            ));
        }
    }

    if let Some(status) = &request.status {
        if status != "active" && status != "suspended" {
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                "Invalid account status.",
            ));
        }
    }

    if let Some(plan) = &request.plan {
        let valid_plan = matches!(
            plan.as_str(),
            "free"
                | "pro"
                | "creator"
                | "business"
                | "enterprise"
        );

        if !valid_plan {
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                "Invalid subscription plan.",
            ));
        }
    }

    let existing = sqlx::query_as::<_, UserRow>(
        r#"
        SELECT
            id,
            email,
            password_hash,
            display_name,
            role,
            status,
            plan,
            created_at,
            updated_at,
            last_active_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to load user for update: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update user.",
        )
    })?;

    let existing = match existing {
        Some(user) => user,
        None => {
            return Err(error_response(
                StatusCode::NOT_FOUND,
                "User not found.",
            ));
        }
    };

    if existing.id == admin.user_id {
        if let Some(status) = &request.status {
            if status == "suspended" {
                return Err(error_response(
                    StatusCode::BAD_REQUEST,
                    "You cannot suspend your own administrator account.",
                ));
            }
        }

        if let Some(role) = &request.role {
            if role != "admin" {
                return Err(error_response(
                    StatusCode::BAD_REQUEST,
                    "You cannot remove your own administrator role.",
                ));
            }
        }
    }

    let display_name = request
        .display_name
        .unwrap_or(existing.display_name);

    let role = request
        .role
        .unwrap_or(existing.role);

    let status = request
        .status
        .unwrap_or(existing.status);

    let plan = request
        .plan
        .unwrap_or(existing.plan);

    let now = Utc::now();

    let updated = sqlx::query_as::<_, UserRow>(
        r#"
        UPDATE users
        SET
            display_name = $1,
            role = $2,
            status = $3,
            plan = $4,
            updated_at = $5
        WHERE id = $6
        RETURNING
            id,
            email,
            password_hash,
            display_name,
            role,
            status,
            plan,
            created_at,
            updated_at,
            last_active_at
        "#,
    )
    .bind(display_name)
    .bind(role)
    .bind(status)
    .bind(plan)
    .bind(now)
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to update user: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update user.",
        )
    })?;

    record_activity(
        &state,
        Some(admin.user_id),
        "admin_user_updated",
        &format!(
            "Administrator updated user {}.",
            user_id
        ),
    )
    .await;

    Ok(Json(user_response(&updated)))
}


async fn delete_admin_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let admin = require_admin(
        &headers,
        &state,
    )
    .await?;

    if admin.user_id == user_id {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "You cannot delete your own administrator account.",
        ));
    }

    let result = sqlx::query(
        "DELETE FROM users WHERE id = $1",
    )
    .bind(user_id)
    .execute(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to delete user: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to delete user.",
        )
    })?;

    if result.rows_affected() == 0 {
        return Err(error_response(
            StatusCode::NOT_FOUND,
            "User not found.",
        ));
    }

    record_activity(
        &state,
        Some(admin.user_id),
        "admin_user_deleted",
        &format!(
            "Administrator deleted user {}.",
            user_id
        ),
    )
    .await;

    Ok(Json(serde_json::json!({
        "message": "User deleted successfully."
    })))
}


async fn get_usage(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<UsageResponse>, (StatusCode, Json<serde_json::Value>)> {
    let current_user = get_current_user(
        &headers,
        &state,
    )
    .await?;

    ensure_usage_row(
        &state,
        current_user.user_id,
    )
    .await
    .map_err(|error| {
        error!(
            "Failed to initialize usage: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load usage.",
        )
    })?;

    let usage = sqlx::query_as::<_, UsageResponse>(
        r#"
        SELECT
            user_id,
            render_count,
            project_count,
            storage_bytes,
            download_count,
            ai_generation_count,
            updated_at
        FROM usage
        WHERE user_id = $1
        "#,
    )
    .bind(current_user.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to load usage: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load usage.",
        )
    })?;

    Ok(Json(usage))
}


async fn update_usage(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<UsageUpdateRequest>,
) -> Result<Json<UsageResponse>, (StatusCode, Json<serde_json::Value>)> {
    let current_user = get_current_user(
        &headers,
        &state,
    )
    .await?;

    ensure_usage_row(
        &state,
        current_user.user_id,
    )
    .await
    .map_err(|error| {
        error!(
            "Failed to initialize usage: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update usage.",
        )
    })?;

    let current = sqlx::query_as::<_, UsageResponse>(
        r#"
        SELECT
            user_id,
            render_count,
            project_count,
            storage_bytes,
            download_count,
            ai_generation_count,
            updated_at
        FROM usage
        WHERE user_id = $1
        "#,
    )
    .bind(current_user.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to load usage: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update usage.",
        )
    })?;

    let updated = sqlx::query_as::<_, UsageResponse>(
        r#"
        UPDATE usage
        SET
            render_count = $1,
            project_count = $2,
            storage_bytes = $3,
            download_count = $4,
            ai_generation_count = $5,
            updated_at = NOW()
        WHERE user_id = $6
        RETURNING
            user_id,
            render_count,
            project_count,
            storage_bytes,
            download_count,
            ai_generation_count,
            updated_at
        "#,
    )
    .bind(request.render_count.unwrap_or(current.render_count))
    .bind(request.project_count.unwrap_or(current.project_count))
    .bind(request.storage_bytes.unwrap_or(current.storage_bytes))
    .bind(request.download_count.unwrap_or(current.download_count))
    .bind(
        request
            .ai_generation_count
            .unwrap_or(current.ai_generation_count),
    )
    .bind(current_user.user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to update usage: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update usage.",
        )
    })?;

    Ok(Json(updated))
}


async fn admin_usage(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<UsageResponse>>, (StatusCode, Json<serde_json::Value>)> {
    require_admin(
        &headers,
        &state,
    )
    .await?;

    let usage = sqlx::query_as::<_, UsageResponse>(
        r#"
        SELECT
            user_id,
            render_count,
            project_count,
            storage_bytes,
            download_count,
            ai_generation_count,
            updated_at
        FROM usage
        ORDER BY updated_at DESC
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to load admin usage: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load usage.",
        )
    })?;

    Ok(Json(usage))
}


async fn admin_update_usage(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
    Json(request): Json<UsageUpdateRequest>,
) -> Result<Json<UsageResponse>, (StatusCode, Json<serde_json::Value>)> {
    let admin = require_admin(
        &headers,
        &state,
    )
    .await?;

    ensure_usage_row(
        &state,
        user_id,
    )
    .await
    .map_err(|error| {
        error!(
            "Failed to initialize usage: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update usage.",
        )
    })?;

    let current = sqlx::query_as::<_, UsageResponse>(
        r#"
        SELECT
            user_id,
            render_count,
            project_count,
            storage_bytes,
            download_count,
            ai_generation_count,
            updated_at
        FROM usage
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to load usage: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update usage.",
        )
    })?;

    let updated = sqlx::query_as::<_, UsageResponse>(
        r#"
        UPDATE usage
        SET
            render_count = $1,
            project_count = $2,
            storage_bytes = $3,
            download_count = $4,
            ai_generation_count = $5,
            updated_at = NOW()
        WHERE user_id = $6
        RETURNING
            user_id,
            render_count,
            project_count,
            storage_bytes,
            download_count,
            ai_generation_count,
            updated_at
        "#,
    )
    .bind(request.render_count.unwrap_or(current.render_count))
    .bind(request.project_count.unwrap_or(current.project_count))
    .bind(request.storage_bytes.unwrap_or(current.storage_bytes))
    .bind(request.download_count.unwrap_or(current.download_count))
    .bind(
        request
            .ai_generation_count
            .unwrap_or(current.ai_generation_count),
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to update admin usage: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update usage.",
        )
    })?;

    record_activity(
        &state,
        Some(admin.user_id),
        "admin_usage_updated",
        &format!(
            "Administrator updated usage for user {}.",
            user_id
        ),
    )
    .await;

    Ok(Json(updated))
}


async fn admin_activity(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<ActivityResponse>>, (StatusCode, Json<serde_json::Value>)> {
    require_admin(
        &headers,
        &state,
    )
    .await?;

    let activity = sqlx::query_as::<_, ActivityResponse>(
        r#"
        SELECT
            id,
            user_id,
            event_type,
            description,
            ip_address,
            user_agent,
            created_at
        FROM activity
        ORDER BY created_at DESC
        LIMIT 500
        "#,
    )
    .fetch_all(&state.db)
    .await
    .map_err(|error| {
        error!(
            "Failed to load activity: {}",
            error
        );

        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to load activity.",
        )
    })?;

    Ok(Json(activity))
}


async fn bootstrap_admin(
    state: &AppState,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let email = match env::var("BOOTSTRAP_ADMIN_EMAIL") {
        Ok(value) => value.trim().to_lowercase(),
        Err(_) => {
            info!(
                "BOOTSTRAP_ADMIN_EMAIL is not configured. Skipping admin bootstrap."
            );
            return Ok(());
        }
    };

    let password = match env::var("BOOTSTRAP_ADMIN_PASSWORD") {
        Ok(value) => value,
        Err(_) => {
            info!(
                "BOOTSTRAP_ADMIN_PASSWORD is not configured. Skipping admin bootstrap."
            );
            return Ok(());
        }
    };

    if email.is_empty() || password.is_empty() {
        return Ok(());
    }

    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users WHERE email = $1",
    )
    .bind(&email)
    .fetch_one(&state.db)
    .await?;

    if existing > 0 {
        info!(
            "Bootstrap administrator already exists: {}",
            email
        );
        return Ok(());
    }

    let password_hash = hash_password(&password)
        .map_err(|error| {
            std::io::Error::new(
                std::io::ErrorKind::Other,
                error,
            )
        })?;

    let user = sqlx::query_as::<_, UserRow>(
        r#"
        INSERT INTO users (
            email,
            password_hash,
            display_name,
            role,
            status,
            plan
        )
        VALUES (
            $1,
            $2,
            'Administrator',
            'admin',
            'active',
            'enterprise'
        )
        RETURNING
            id,
            email,
            password_hash,
            display_name,
            role,
            status,
            plan,
            created_at,
            updated_at,
            last_active_at
        "#,
    )
    .bind(&email)
    .bind(password_hash)
    .fetch_one(&state.db)
    .await?;

    ensure_usage_row(
        state,
        user.id,
    )
    .await?;

    record_activity(
        state,
        Some(user.id),
        "admin_bootstrap",
        "Initial administrator account created.",
    )
    .await;

    info!(
        "Created bootstrap administrator: {}",
        email
    );

    Ok(())
}


async fn run_migrations(
    db: &PgPool,
) -> Result<(), sqlx::Error> {
    let migration_sql = include_str!("../migrations/001_initial.sql");

    sqlx::raw_sql(migration_sql)
        .execute(db)
        .await?;

    Ok(())
}


async fn auth_middleware(
    State(state): State<AppState>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let path = request.uri().path();

    if path == "/health"
        || path == "/api/auth/register"
        || path == "/api/auth/login"
    {
        return next.run(request).await;
    }

    next.run(request).await
}


#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            env_or_default(
                "RUST_LOG",
                "info",
            ),
        )
        .init();

    let database_url = env::var("DATABASE_URL")
        .expect("DATABASE_URL must be configured.");

    let jwt_secret = env::var("JWT_SECRET")
        .expect("JWT_SECRET must be configured.");

    if jwt_secret.len() < 32 {
        panic!(
            "JWT_SECRET must be at least 32 characters long."
        );
    }

    info!("Connecting to PostgreSQL...");

    let db = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;

    info!("Connected to PostgreSQL.");

    run_migrations(&db).await?;

    info!("Database migration completed.");

    let state = AppState {
        db,
        jwt_secret: Arc::new(jwt_secret),
    };

    bootstrap_admin(&state).await?;

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/auth/register", post(register))
        .route("/api/auth/login", post(login))
        .route("/api/auth/me", get(me))
        .route("/api/auth/logout", post(logout))
        .route("/api/admin/users", get(list_users))
        .route(
            "/api/admin/users/{user_id}",
            get(get_admin_user)
                .put(update_admin_user)
                .delete(delete_admin_user),
        )
        .route("/api/usage", get(get_usage).put(update_usage))
        .route(
            "/api/admin/usage",
            get(admin_usage),
        )
        .route(
            "/api/admin/usage/{user_id}",
            put(admin_update_usage),
        )
        .route(
            "/api/admin/activity",
            get(admin_activity),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .layer(
            CorsLayer::permissive(),
        )
        .layer(
            TraceLayer::new_for_http(),
        )
        .with_state(state);

    let host = env_or_default(
        "SERVER_HOST",
        "127.0.0.1",
    );

    let port = env_or_default(
        "SERVER_PORT",
        "8787",
    )
    .parse::<u16>()
    .expect("SERVER_PORT must be a valid port number.");

    let address = format!(
        "{}:{}",
        host,
        port
    );

    let listener = tokio::net::TcpListener::bind(&address)
        .await?;

    info!(
        "Content Studio server listening on {}",
        address
    );

    axum::serve(
        listener,
        app,
    )
    .await?;

    Ok(())
}
