#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

const CANVAS_WIDTH: f64 = 1080.0;
const CANVAS_HEIGHT: f64 = 1920.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TemplateLayer {
    id: String,

    #[serde(rename = "type")]
    layer_type: String,

    #[serde(default)]
    text: Option<String>,

    #[serde(default)]
    x: f64,

    #[serde(default)]
    y: f64,

    #[serde(default)]
    width: f64,

    #[serde(default)]
    height: f64,

    #[serde(default, rename = "fontSize")]
    font_size: f64,

    #[serde(default)]
    color: String,

    #[serde(default)]
    opacity: f64,

    #[serde(default, rename = "borderWidth")]
    border_width: f64,

    #[serde(default, rename = "borderColor")]
    border_color: String,

    #[serde(default)]
    shadow: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TemplateDocument {
    #[serde(
        default = "default_background_color",
        rename = "backgroundColor"
    )]
    background_color: String,

    #[serde(default)]
    layers: Vec<TemplateLayer>,
}

fn default_background_color() -> String {
    "#FFFFFF".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RenderJob {
    project_id: String,
    variation_id: i64,
    variation_text: String,

    source_path: String,

    template_layers_json: String,

    output_width: i64,
    output_height: i64,

    fps: i64,
    bitrate: String,

    output_path: String,

    #[serde(default)]
    clip_length: f64,

    #[serde(default)]
    original_audio: f64,

    #[serde(default)]
    mute_original_audio: bool,

    #[serde(default)]
    added_audio_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RenderedVideo {
    id: String,

    project_id: String,
    variation_id: i64,

    variation_text: String,

    output_path: String,

    created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RenderedVideoMedia {
    id: String,
    name: String,
    path: String,
    size: u64,

    #[serde(rename = "modifiedAt")]
    modified_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MediaFile {
    id: String,
    name: String,
    path: String,
    media_type: String,
    size: u64,

    #[serde(rename = "modifiedAt")]
    modified_at: String,
}

fn app_data_dir(
    app: &AppHandle,
) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| {
            format!(
                "Unable to determine app data directory: {error}"
            )
        })
}

fn media_dir(
    app: &AppHandle,
) -> Result<PathBuf, String> {
    let directory = app_data_dir(app)?.join("media");

    fs::create_dir_all(&directory)
        .map_err(|error| {
            format!(
                "Unable to create media directory: {error}"
            )
        })?;

    Ok(directory)
}

fn media_thumbnail_dir(
    app: &AppHandle,
) -> Result<PathBuf, String> {
    let directory =
        media_dir(app)?.join("thumbnails");

    fs::create_dir_all(&directory)
        .map_err(|error| {
            format!(
                "Unable to create media thumbnail directory: {error}"
            )
        })?;

    Ok(directory)
}

fn renders_dir(
    app: &AppHandle,
) -> Result<PathBuf, String> {
    let directory = app_data_dir(app)?.join("renders");

    fs::create_dir_all(&directory)
        .map_err(|error| {
            format!(
                "Unable to create renders directory: {error}"
            )
        })?;

    Ok(directory)
}

fn extension_for_path(
    path: &str,
) -> String {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_lowercase()
}

fn media_type_for_extension(
    extension: &str,
) -> Option<&'static str> {
    match extension.to_lowercase().as_str() {
        // Video
        "mp4"
        | "mov"
        | "m4v"
        | "avi"
        | "mkv"
        | "webm"
        | "wmv"
        | "mpeg"
        | "mpg"
        | "3gp" => Some("video"),

        // Audio
        "mp3"
        | "wav"
        | "m4a"
        | "aac"
        | "flac"
        | "ogg"
        | "oga" => Some("audio"),

        // Images
        "jpg"
        | "jpeg"
        | "png"
        | "gif"
        | "webp"
        | "bmp"
        | "svg" => Some("image"),

        _ => None,
    }
}

fn now_string() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();

    format!(
        "{}.{:03}Z",
        duration.as_secs(),
        duration.subsec_millis()
    )
}

fn unique_timestamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn unique_id(
    prefix: &str,
) -> String {
    format!(
        "{}_{}_{}",
        prefix,
        unique_timestamp(),
        std::process::id()
    )
}

fn ffmpeg_binary() -> &'static str {
    "ffmpeg"
}

fn ffprobe_binary() -> &'static str {
    "ffprobe"
}

fn sanitize_render_filename(
    text: &str,
) -> String {
    let mut result = String::new();
    let mut last_was_space = false;

    for character in text.trim().chars() {
        if character.is_control() {
            if !last_was_space {
                result.push(' ');
                last_was_space = true;
            }

            continue;
        }

        match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => {
                if !last_was_space {
                    result.push(' ');
                    last_was_space = true;
                }
            }

            '\n' | '\r' | '\t' => {
                if !last_was_space {
                    result.push(' ');
                    last_was_space = true;
                }
            }

            ' ' => {
                if !last_was_space {
                    result.push(' ');
                    last_was_space = true;
                }
            }

            _ => {
                result.push(character);
                last_was_space = false;
            }
        }
    }

    let mut cleaned = result.trim().to_string();

    while cleaned.ends_with('.') {
        cleaned.pop();
    }

    while cleaned.ends_with(' ') {
        cleaned.pop();
    }

    if cleaned.is_empty() {
        cleaned = "Untitled Render".to_string();
    }

    let max_chars = 120;

    if cleaned.chars().count() > max_chars {
        cleaned = cleaned
            .chars()
            .take(max_chars)
            .collect::<String>()
            .trim()
            .to_string();
    }

    if cleaned.is_empty() {
        "Untitled Render".to_string()
    } else {
        cleaned
    }
}

fn unique_render_output_path(
    directory: &Path,
    variation_text: &str,
) -> PathBuf {
    let base_name =
        sanitize_render_filename(
            variation_text,
        );

    let first =
        directory.join(
            format!("{base_name}.mp4"),
        );

    if !first.exists() {
        return first;
    }

    let mut counter = 2u32;

    loop {
        let candidate =
            directory.join(
                format!(
                    "{base_name} ({counter}).mp4"
                ),
            );

        if !candidate.exists() {
            return candidate;
        }

        counter += 1;
    }
}

fn escape_drawtext(
    value: &str,
) -> String {
    value
        .replace('\\', r"\\")
        .replace(':', r"\:")
        .replace('\'', r"\'")
        .replace('[', r"\[")
        .replace(']', r"\]")
        .replace(',', r"\,")
        .replace(';', r"\;")
        .replace('%', r"\%")
        .replace('#', r"\#")
        .replace('\r', "")
        .replace('\n', r"\n")
}

fn ffmpeg_color(
    value: &str,
    fallback: &str,
) -> String {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return fallback.to_string();
    }

    if let Some(hex) =
        trimmed.strip_prefix('#')
    {
        if hex.len() == 6
            && hex.chars().all(|character| {
                character.is_ascii_hexdigit()
            })
        {
            return format!("0x{hex}");
        }

        if hex.len() == 8
            && hex.chars().all(|character| {
                character.is_ascii_hexdigit()
            })
        {
            return format!("0x{hex}");
        }
    }

    trimmed.to_string()
}

fn parse_template_document(
    value: &str,
) -> TemplateDocument {
    if let Ok(document) =
        serde_json::from_str::<TemplateDocument>(value)
    {
        return document;
    }

    if let Ok(layers) =
        serde_json::from_str::<Vec<TemplateLayer>>(value)
    {
        return TemplateDocument {
            background_color:
                default_background_color(),
            layers,
        };
    }

    TemplateDocument {
        background_color:
            default_background_color(),
        layers: Vec::new(),
    }
}

fn character_width_factor(
    character: char,
) -> f64 {
    match character {
        ' ' => 0.28,

        'i'
        | 'I'
        | 'l'
        | 'L'
        | '!'
        | '|'
        | '.'
        | ','
        | ':'
        | ';'
        | '\''
        | '"' => 0.30,

        't'
        | 'f'
        | 'r'
        | 'j'
        | 'J'
        | 'm'
        | 'w'
        | 'M'
        | 'W' => 0.62,

        '0'..='9' => 0.56,

        'A'..='Z' => 0.66,

        _ => 0.56,
    }
}

fn estimated_text_width(
    text: &str,
    font_size: f64,
) -> f64 {
    text.chars()
        .map(|character| {
            character_width_factor(
                character,
            ) * font_size
        })
        .sum()
}

fn break_long_word(
    word: &str,
    max_width: f64,
    font_size: f64,
) -> Vec<String> {
    if word.is_empty() {
        return vec![String::new()];
    }

    let mut parts = Vec::new();
    let mut current = String::new();

    for character in word.chars() {
        let candidate =
            format!(
                "{current}{character}"
            );

        if !current.is_empty()
            && estimated_text_width(
                &candidate,
                font_size,
            ) > max_width
        {
            parts.push(current);

            current =
                character.to_string();
        } else {
            current.push(character);
        }
    }

    if !current.is_empty() {
        parts.push(current);
    }

    parts
}

fn wrap_text_for_box(
    text: &str,
    box_width: f64,
    font_size: f64,
) -> Vec<String> {
    let safe_width =
        box_width.max(1.0);

    let normalized = text
        .replace("\r\n", "\n")
        .replace('\r', "\n");

    let mut output_lines:
        Vec<String> = Vec::new();

    for original_line in
        normalized.split('\n')
    {
        let words: Vec<&str> =
            original_line
                .split_whitespace()
                .collect();

        if words.is_empty() {
            output_lines.push(
                String::new(),
            );

            continue;
        }

        let mut current_line =
            String::new();

        for word in words {
            let word_width =
                estimated_text_width(
                    word,
                    font_size,
                );

            if word_width > safe_width {
                if !current_line.is_empty() {
                    output_lines.push(
                        current_line,
                    );

                    current_line =
                        String::new();
                }

                let chunks =
                    break_long_word(
                        word,
                        safe_width,
                        font_size,
                    );

                if chunks.len() > 1 {
                    for chunk in chunks
                        .iter()
                        .take(
                            chunks.len() - 1,
                        )
                    {
                        output_lines
                            .push(
                                chunk.clone(),
                            );
                    }

                    current_line =
                        chunks
                            .last()
                            .cloned()
                            .unwrap_or_default();
                } else {
                    current_line =
                        chunks
                            .first()
                            .cloned()
                            .unwrap_or_default();
                }

                continue;
            }

            let candidate =
                if current_line.is_empty()
                {
                    word.to_string()
                } else {
                    format!(
                        "{current_line} {word}"
                    )
                };

            if estimated_text_width(
                &candidate,
                font_size,
            ) <= safe_width
            {
                current_line =
                    candidate;
            } else {
                if !current_line.is_empty() {
                    output_lines.push(
                        current_line,
                    );
                }

                current_line =
                    word.to_string();
            }
        }

        if !current_line.is_empty() {
            output_lines.push(
                current_line,
            );
        }
    }

    if output_lines.is_empty() {
        output_lines.push(
            String::new(),
        );
    }

    output_lines
}

fn fit_text_to_box(
    text: &str,
    box_width: f64,
    box_height: f64,
    starting_font_size: f64,
) -> (f64, Vec<String>) {
    let mut font_size =
        starting_font_size.max(8.0);

    let minimum_font_size =
        8.0;

    loop {
        let lines =
            wrap_text_for_box(
                text,
                box_width,
                font_size,
            );

        let line_height =
            (font_size * 1.20) + 8.0;

        let total_height =
            if lines.is_empty() {
                0.0
            } else {
                (lines.len() as f64
                    * line_height)
                    - 8.0
            };

        if total_height <= box_height
            || font_size
                <= minimum_font_size
        {
            return (
                font_size,
                lines,
            );
        }

        font_size =
            (font_size * 0.90)
                .max(
                    minimum_font_size,
                );
    }
}

fn build_video_filter(
    document: &TemplateDocument,
    variation_text: &str,
    output_width: i64,
    output_height: i64,
) -> Result<(String, String), String> {
    let scale_x =
        output_width as f64
            / CANVAS_WIDTH;

    let scale_y =
        output_height as f64
            / CANVAS_HEIGHT;

    let background =
        ffmpeg_color(
            &document.background_color,
            "0xFFFFFF",
        );

    let mut parts:
        Vec<String> = Vec::new();

    parts.push(format!(
        "color=c={background}:s={}x{}:d=86400[bg]",
        output_width,
        output_height
    ));

    parts.push(format!(
        "[0:v]scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[scaledvideo]",
        output_width,
        output_height,
        output_width,
        output_height
    ));

    let mut current_label =
        String::from("[bg]");

    let mut layer_number =
        0usize;

    for layer in
        &document.layers
    {
        if layer.layer_type ==
            "video"
        {
            let x =
                (layer.x * scale_x)
                    .round() as i64;

            let y =
                (layer.y * scale_y)
                    .round() as i64;

            let width =
                (layer.width
                    * scale_x)
                    .max(1.0)
                    .round() as i64;

            let height =
                (layer.height
                    * scale_y)
                    .max(1.0)
                    .round() as i64;

            let video_label =
                format!(
                    "[video{layer_number}]"
                );

            parts.push(format!(
                "[scaledvideo]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setpts=PTS-STARTPTS{video_label}"
            ));

            let output_label =
                format!(
                    "[layer{layer_number}]"
                );

            parts.push(format!(
                "{current_label}{video_label}overlay={x}:{y}:eof_action=pass:shortest=0{output_label}"
            ));

            current_label =
                output_label;

            layer_number += 1;

            continue;
        }

        if layer.layer_type ==
            "text"
        {
            let x =
                layer.x * scale_x;

            let y =
                layer.y * scale_y;

            let box_width =
                (layer.width
                    * scale_x)
                    .max(1.0);

            let box_height =
                (layer.height
                    * scale_y)
                    .max(1.0);

            let requested_font_size =
                if layer.font_size
                    > 0.0
                {
                    layer.font_size
                        * scale_x
                } else {
                    64.0 * scale_x
                };

            let resolved_text =
                layer
                    .text
                    .clone()
                    .unwrap_or_default()
                    .replace(
                        "{{text}}",
                        variation_text,
                    )
                    .replace(
                        "{{TEXT}}",
                        variation_text,
                    )
                    .replace(
                        "{{variation}}",
                        variation_text,
                    )
                    .replace(
                        "{{VARIATION}}",
                        variation_text,
                    );

            let (
                actual_font_size,
                lines,
            ) = fit_text_to_box(
                &resolved_text,
                box_width,
                box_height,
                requested_font_size,
            );

            let color =
                ffmpeg_color(
                    &layer.color,
                    "white",
                );

            let border_color =
                ffmpeg_color(
                    &layer.border_color,
                    "black",
                );

            let opacity =
                layer.opacity
                    .clamp(
                        0.0,
                        1.0,
                    );

            let border_width =
                (layer.border_width
                    * scale_x)
                    .max(0.0);

            let shadow =
                if layer.shadow {
                    ":shadowcolor=black@0.65:shadowx=4:shadowy=4"
                        .to_string()
                } else {
                    String::new()
                };

            let line_height =
                (actual_font_size
                    * 1.20)
                    + 8.0;

            let total_text_height =
                if lines.is_empty() {
                    0.0
                } else {
                    (lines.len()
                        as f64
                        * line_height)
                        - 8.0
                };

            let vertical_start =
                y
                    + ((box_height
                        - total_text_height)
                        / 2.0)
                        .max(0.0);

            for (
                line_index,
                line,
            ) in lines
                .iter()
                .enumerate()
            {
                let escaped_line =
                    escape_drawtext(
                        line,
                    );

                let centered_x =
                    format!(
                        "{x:.2}+({box_width:.2}-text_w)/2"
                    );

                let line_y =
                    vertical_start
                        + line_index
                            as f64
                            * line_height;

                let output_label =
                    format!(
                        "[layer{layer_number}]"
                    );

                parts.push(format!(
                    "{current_label}drawtext=font='Arial':text='{escaped_line}':x={centered_x}:y={line_y:.2}:fontsize={actual_font_size:.2}:fontcolor={color}@{opacity}:borderw={border_width:.2}:bordercolor={border_color}@{opacity}{shadow}{output_label}"
                ));

                current_label =
                    output_label;

                layer_number += 1;
            }

            if lines.is_empty() {
                let output_label =
                    format!(
                        "[layer{layer_number}]"
                    );

                parts.push(format!(
                    "{current_label}null{output_label}"
                ));

                current_label =
                    output_label;

                layer_number += 1;
            }
        }
    }

    if layer_number == 0 {
        return Err(
            "The selected template has no usable video or text layers."
                .to_string(),
        );
    }

    parts.push(format!(
        "{current_label}format=yuv420p[outv]"
    ));

    Ok((
        parts.join(";"),
        "[outv]".to_string(),
    ))
}

fn run_ffmpeg(
    args: &[String],
) -> Result<(), String> {
    let output =
        Command::new(ffmpeg_binary())
            .args(args)
            .output()
            .map_err(|error| {
                format!(
                    "Unable to start FFmpeg: {error}"
                )
            })?;

    if output.status.success() {
        return Ok(());
    }

    let stderr =
        String::from_utf8_lossy(
            &output.stderr,
        );

    let stdout =
        String::from_utf8_lossy(
            &output.stdout,
        );

    let filter_debug =
        args.windows(2)
            .find(|pair| {
                pair[0]
                    == "-filter_complex"
            })
            .map(|pair| pair[1].clone())
            .unwrap_or_default();

    Err(format!(
        "FFmpeg failed with status {}.\n\nSTDERR:\n{}\n\nSTDOUT:\n{}\n\nGenerated filter graph:\n{}",
        output.status,
        stderr,
        stdout,
        filter_debug
    ))
}

fn get_video_duration(
    path: &str,
) -> Result<f64, String> {
    let output =
        Command::new(ffprobe_binary())
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                path,
            ])
            .output()
            .map_err(|error| {
                format!(
                    "Unable to start ffprobe: {error}"
                )
            })?;

    if !output.status.success() {
        return Err(format!(
            "ffprobe failed:\n{}",
            String::from_utf8_lossy(
                &output.stderr
            )
        ));
    }

    let duration =
        String::from_utf8_lossy(
            &output.stdout,
        )
        .trim()
        .parse::<f64>()
        .map_err(|error| {
            format!(
                "Unable to parse video duration: {error}"
            )
        })?;

    if !duration.is_finite()
        || duration <= 0.0
    {
        return Err(
            "The source video has an invalid duration."
                .to_string(),
        );
    }

    Ok(duration)
}

fn source_has_audio(
    path: &str,
) -> Result<bool, String> {
    let output =
        Command::new(ffprobe_binary())
            .args([
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=index",
                "-of",
                "csv=p=0",
                path,
            ])
            .output()
            .map_err(|error| {
                format!(
                    "Unable to start ffprobe while checking source audio: {error}"
                )
            })?;

    if !output.status.success() {
        return Err(format!(
            "Unable to inspect source audio:\n{}",
            String::from_utf8_lossy(
                &output.stderr
            )
        ));
    }

    Ok(
        !String::from_utf8_lossy(
            &output.stdout,
        )
        .trim()
        .is_empty(),
    )
}

fn safe_clip_length(
    requested: f64,
    source_duration: f64,
) -> f64 {
    if !requested.is_finite()
        || requested <= 0.0
    {
        return source_duration;
    }

    requested.min(source_duration)
}

fn ensure_path_is_inside(
    target: &Path,
    directory: &Path,
) -> bool {
    let target =
        match fs::canonicalize(target) {
            Ok(value) => value,
            Err(_) => return false,
        };

    let directory =
        match fs::canonicalize(directory) {
            Ok(value) => value,
            Err(_) => return false,
        };

    target.starts_with(
        &directory,
    )
}

fn media_thumbnail_path(
    app: &AppHandle,
    media_path: &Path,
) -> Result<PathBuf, String> {
    let thumbnail_directory =
        media_thumbnail_dir(app)?;

    let file_stem =
        media_path
            .file_stem()
            .and_then(|value| {
                value.to_str()
            })
            .unwrap_or("media");

    Ok(
        thumbnail_directory.join(
            format!("{file_stem}.jpg"),
        )
    )
}

#[tauri::command]
async fn generate_media_thumbnail(
    app: AppHandle,
    path: String,
) -> Result<String, String> {
    let source =
        PathBuf::from(&path);

    if !source.exists() {
        return Err(format!(
            "Media file does not exist: {path}"
        ));
    }

    if !source.is_file() {
        return Err(
            "The selected media path is not a file."
                .to_string(),
        );
    }

    let media_directory =
        media_dir(&app)?;

    if !ensure_path_is_inside(
        &source,
        &media_directory,
    ) {
        return Err(
            "For safety, thumbnails can only be generated for Content Studio imported media."
                .to_string(),
        );
    }

    let thumbnail =
        media_thumbnail_path(
            &app,
            &source,
        )?;

    if thumbnail.exists()
        && thumbnail.is_file()
    {
        return Ok(
            thumbnail
                .to_string_lossy()
                .to_string(),
        );
    }

    if let Some(parent) =
        thumbnail.parent()
    {
        fs::create_dir_all(parent)
            .map_err(|error| {
                format!(
                    "Unable to create thumbnail directory: {error}"
                )
            })?;
    }

    let args = vec![
        "-y".to_string(),

        "-ss".to_string(),
        "0.5".to_string(),

        "-i".to_string(),
        path.clone(),

        "-frames:v".to_string(),
        "1".to_string(),

        "-vf".to_string(),
        "scale=480:-2:force_original_aspect_ratio=decrease".to_string(),

        "-q:v".to_string(),
        "3".to_string(),

        thumbnail
            .to_string_lossy()
            .to_string(),
    ];

    run_ffmpeg(&args)?;

    if !thumbnail.exists() {
        return Err(
            "FFmpeg completed but did not create the thumbnail."
                .to_string(),
        );
    }

    let metadata =
        fs::metadata(&thumbnail)
            .map_err(|error| {
                format!(
                    "Unable to read generated thumbnail: {error}"
                )
            })?;

    if metadata.len() == 0 {
        return Err(
            "The generated thumbnail is empty."
                .to_string(),
        );
    }

    Ok(
        thumbnail
            .to_string_lossy()
            .to_string(),
    )
}

#[tauri::command]
async fn import_media(
    app: AppHandle,
    source_path: String,
) -> Result<String, String> {
    let source =
        PathBuf::from(&source_path);

    if !source.exists() {
        return Err(format!(
            "Source file does not exist: {source_path}"
        ));
    }

    if !source.is_file() {
        return Err(format!(
            "Source path is not a file: {source_path}"
        ));
    }

    let extension =
        source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("mp4")
            .to_lowercase();

    let destination_dir =
        media_dir(&app)?;

    let filename =
        format!(
            "media_{}.{}",
            unique_timestamp(),
            extension
        );

    let destination =
        destination_dir.join(filename);

    fs::copy(
        &source,
        &destination,
    )
    .map_err(|error| {
        format!(
            "Unable to copy media: {error}"
        )
    })?;

    Ok(
        destination
            .to_string_lossy()
            .to_string(),
    )
}

#[tauri::command]
async fn sync_media_library(
    app: AppHandle,
) -> Result<Vec<MediaFile>, String> {
    let directory =
        media_dir(&app)?;

    let mut files:
        Vec<MediaFile> = Vec::new();

    for entry in
        fs::read_dir(&directory)
            .map_err(|error| {
                format!(
                    "Unable to read media directory: {error}"
                )
            })?
    {
        let entry =
            entry.map_err(|error| {
                format!(
                    "Unable to read media entry: {error}"
                )
            })?;

        let path =
            entry.path();

        // Ignore directories such as /thumbnails.
        if !path.is_file() {
            continue;
        }

        let path_string =
            path.to_string_lossy().to_string();

        let extension =
            extension_for_path(
                &path_string,
            );

        let media_type =
            match media_type_for_extension(
                &extension,
            ) {
                Some(value) => value,
                None => continue,
            };

        let metadata =
            entry.metadata()
                .map_err(|error| {
                    format!(
                        "Unable to read media metadata: {error}"
                    )
                })?;

        let size =
            metadata.len();

        let name =
            path.file_name()
                .and_then(|value| {
                    value.to_str()
                })
                .unwrap_or("media")
                .to_string();

        let modified_at =
            metadata
                .modified()
                .ok()
                .and_then(|time| {
                    time.duration_since(
                        UNIX_EPOCH,
                    )
                    .ok()
                })
                .map(|duration| {
                    format!(
                        "{}.{:03}Z",
                        duration.as_secs(),
                        duration.subsec_millis()
                    )
                })
                .unwrap_or_else(
                    now_string,
                );

        files.push(
            MediaFile {
                id: unique_id(
                    "media",
                ),
                name,
                path: path_string,
                media_type:
                    media_type.to_string(),
                size,
                modified_at,
            },
        );
    }

    files.sort_by(
        |a, b| {
            b.modified_at
                .cmp(&a.modified_at)
        },
    );

    Ok(files)
}

#[tauri::command]
async fn delete_media(
    app: AppHandle,
    path: String,
) -> Result<(), String> {
    let target =
        PathBuf::from(&path);

    if !target.exists() {
        return Ok(());
    }

    if !target.is_file() {
        return Err(
            "The selected media is not a file."
                .to_string(),
        );
    }

    let directory =
        media_dir(&app)?;

    if !ensure_path_is_inside(
        &target,
        &directory,
    ) {
        return Err(
            "For safety, Content Studio can only delete files from its imported-media directory."
                .to_string(),
        );
    }

    if let Ok(thumbnail) =
        media_thumbnail_path(
            &app,
            &target,
        )
    {
        if thumbnail.exists()
            && thumbnail.is_file()
        {
            let _ =
                fs::remove_file(
                    thumbnail,
                );
        }
    }

    fs::remove_file(&target)
        .map_err(|error| {
            format!(
                "Unable to delete imported media: {error}"
            )
        })?;

    Ok(())
}

#[tauri::command]
async fn check_ffmpeg()
    -> Result<String, String>
{
    let output =
        Command::new(ffmpeg_binary())
            .arg("-version")
            .output()
            .map_err(|error| {
                format!(
                    "Unable to start FFmpeg: {error}"
                )
            })?;

    if !output.status.success() {
        return Err(format!(
            "FFmpeg returned status {}",
            output.status
        ));
    }

    Ok(
        String::from_utf8_lossy(
            &output.stdout,
        )
        .to_string(),
    )
}

#[tauri::command]
async fn render_batch(
    app: AppHandle,
    jobs: Vec<RenderJob>,
) -> Result<Vec<RenderedVideo>, String> {
    if jobs.is_empty() {
        return Ok(Vec::new());
    }

    let renders =
        renders_dir(&app)?;

    let mut results =
        Vec::new();

    for job in jobs {
        let source =
            PathBuf::from(
                &job.source_path,
            );

        if !source.exists()
            || !source.is_file()
        {
            return Err(format!(
                "Source video does not exist: {}",
                job.source_path
            ));
        }

        let source_duration =
            get_video_duration(
                &job.source_path,
            )?;

        let source_audio_exists =
            source_has_audio(
                &job.source_path,
            )?;

        let clip_length =
            safe_clip_length(
                job.clip_length,
                source_duration,
            );

        let document =
            parse_template_document(
                &job.template_layers_json,
            );

        let output_width =
            if job.output_width > 0 {
                job.output_width
            } else {
                1080
            };

        let output_height =
            if job.output_height > 0 {
                job.output_height
            } else {
                1920
            };

        let (
            video_filter,
            final_label,
        ) = build_video_filter(
            &document,
            &job.variation_text,
            output_width,
            output_height,
        )?;

        let output_path =
            unique_render_output_path(
                &renders,
                &job.variation_text,
            );

        if let Some(parent) =
            output_path.parent()
        {
            fs::create_dir_all(parent)
                .map_err(|error| {
                    format!(
                        "Unable to create render directory: {error}"
                    )
                })?;
        }

        let fps =
            if job.fps > 0 {
                job.fps
            } else {
                30
            };

        let bitrate =
            if job.bitrate.trim().is_empty()
            {
                "8M"
            } else {
                job.bitrate.trim()
            };

        let original_volume =
            (job.original_audio / 100.0)
                .clamp(0.0, 1.0);

        let added_audio_path =
            job.added_audio_path
                .clone()
                .filter(|path| {
                    !path.trim().is_empty()
                });

        if let Some(audio_path) =
            &added_audio_path
        {
            let audio_file =
                PathBuf::from(audio_path);

            if !audio_file.exists()
                || !audio_file.is_file()
            {
                return Err(format!(
                    "Added audio file does not exist: {}",
                    audio_path
                ));
            }
        }

        let original_audio_enabled =
            !job.mute_original_audio
                && original_volume > 0.0
                && source_audio_exists;

        let added_audio_enabled =
            added_audio_path.is_some();

        let mut args:
            Vec<String> = vec![
                "-y".to_string(),

                "-ss".to_string(),
                "0".to_string(),

                "-i".to_string(),
                job.source_path.clone(),
            ];

        if let Some(audio_path) =
            &added_audio_path
        {
            args.push(
                "-stream_loop".to_string(),
            );

            args.push("-1".to_string());

            args.push("-i".to_string());

            args.push(
                audio_path.clone(),
            );
        }

        let mut filter_parts:
            Vec<String> = Vec::new();

        filter_parts.push(
            video_filter,
        );

        let audio_output_label =
            if original_audio_enabled
                && added_audio_enabled
            {
                filter_parts.push(format!(
                    "[0:a]volume={original_volume:.4},atrim=duration={clip_length:.3},asetpts=PTS-STARTPTS[orig_audio]"
                ));

                filter_parts.push(format!(
                    "[1:a]volume=1.0,atrim=duration={clip_length:.3},asetpts=PTS-STARTPTS[added_audio]"
                ));

                filter_parts.push(
                    "[orig_audio][added_audio]amix=inputs=2:duration=first:dropout_transition=0,aresample=async=1:first_pts=0[audio_mix]"
                        .to_string(),
                );

                filter_parts.push(format!(
                    "[audio_mix]atrim=duration={clip_length:.3},asetpts=PTS-STARTPTS[audio_final]"
                ));

                Some(
                    "[audio_final]".to_string()
                )
            } else if original_audio_enabled {
                filter_parts.push(format!(
                    "[0:a]volume={original_volume:.4},atrim=duration={clip_length:.3},asetpts=PTS-STARTPTS[audio_final]"
                ));

                Some(
                    "[audio_final]".to_string()
                )
            } else if added_audio_enabled {
                filter_parts.push(format!(
                    "[1:a]volume=1.0,atrim=duration={clip_length:.3},asetpts=PTS-STARTPTS[audio_final]"
                ));

                Some(
                    "[audio_final]".to_string()
                )
            } else {
                None
            };

        let final_filter =
            filter_parts
                .into_iter()
                .filter(|part| {
                    !part.trim().is_empty()
                })
                .collect::<Vec<String>>()
                .join(";");

        args.push(
            "-filter_complex".to_string(),
        );

        args.push(
            final_filter,
        );

        args.push(
            "-map".to_string(),
        );

        args.push(
            final_label,
        );

        if let Some(audio_label) =
            &audio_output_label
        {
            args.push(
                "-map".to_string(),
            );

            args.push(
                audio_label.clone(),
            );
        }

        args.push(
            "-t".to_string(),
        );

        args.push(
            format!(
                "{clip_length:.3}"
            ),
        );

        args.push(
            "-r".to_string(),
        );

        args.push(
            fps.to_string(),
        );

        args.push(
            "-c:v".to_string(),
        );

        args.push(
            "libx264".to_string(),
        );

        args.push(
            "-preset".to_string(),
        );

        args.push(
            "medium".to_string(),
        );

        args.push(
            "-b:v".to_string(),
        );

        args.push(
            bitrate.to_string(),
        );

        args.push(
            "-pix_fmt".to_string(),
        );

        args.push(
            "yuv420p".to_string(),
        );

        if audio_output_label.is_some() {
            args.push(
                "-c:a".to_string(),
            );

            args.push(
                "aac".to_string(),
            );

            args.push(
                "-b:a".to_string(),
            );

            args.push(
                "192k".to_string(),
            );

            args.push(
                "-ar".to_string(),
            );

            args.push(
                "48000".to_string(),
            );

            args.push(
                "-ac".to_string(),
            );

            args.push(
                "2".to_string(),
            );
        } else {
            args.push(
                "-an".to_string(),
            );
        }

        args.push(
            "-movflags".to_string(),
        );

        args.push(
            "+faststart".to_string(),
        );

        args.push(
            "-avoid_negative_ts"
                .to_string(),
        );

        args.push(
            "make_zero".to_string(),
        );

        args.push(
            output_path
                .to_string_lossy()
                .to_string(),
        );

        run_ffmpeg(&args)?;

        if !output_path.exists() {
            return Err(format!(
                "FFmpeg reported success, but the rendered file does not exist: {}",
                output_path.display()
            ));
        }

        let metadata =
            fs::metadata(
                &output_path,
            )
            .map_err(|error| {
                format!(
                    "Rendered video was created but could not be read: {error}"
                )
            })?;

        if metadata.len() == 0 {
            return Err(
                "FFmpeg created an empty rendered video."
                    .to_string(),
            );
        }

        let created_at =
            metadata
                .modified()
                .ok()
                .and_then(|time| {
                    time.duration_since(
                        UNIX_EPOCH,
                    )
                    .ok()
                })
                .map(|duration| {
                    format!(
                        "{}.{:03}Z",
                        duration.as_secs(),
                        duration.subsec_millis()
                    )
                })
                .unwrap_or_else(
                    now_string,
                );

        let path_string =
            output_path
                .to_string_lossy()
                .to_string();

        results.push(
            RenderedVideo {
                id: unique_id(
                    "render",
                ),
                project_id:
                    job.project_id,
                variation_id:
                    job.variation_id,
                variation_text:
                    job.variation_text,
                output_path:
                    path_string,
                created_at,
            },
        );
    }

    Ok(results)
}

#[tauri::command]
async fn list_rendered_videos(
    app: AppHandle,
) -> Result<
    Vec<RenderedVideoMedia>,
    String,
> {
    let directory =
        renders_dir(&app)?;

    let mut files =
        Vec::new();

    for entry in
        fs::read_dir(&directory)
            .map_err(|error| {
                format!(
                    "Unable to read renders directory: {error}"
                )
            })?
    {
        let entry =
            entry.map_err(|error| {
                format!(
                    "Unable to read render entry: {error}"
                )
            })?;

        let path =
            entry.path();

        if extension_for_path(
            &path.to_string_lossy(),
        ) != "mp4"
        {
            continue;
        }

        let metadata =
            entry.metadata()
                .map_err(|error| {
                    format!(
                        "Unable to read render metadata: {error}"
                    )
                })?;

        if !metadata.is_file() {
            continue;
        }

        let modified_at =
            metadata
                .modified()
                .ok()
                .and_then(|time| {
                    time.duration_since(
                        UNIX_EPOCH,
                    )
                    .ok()
                })
                .map(|duration| {
                    format!(
                        "{}.{:03}Z",
                        duration.as_secs(),
                        duration.subsec_millis()
                    )
                })
                .unwrap_or_else(
                    now_string,
                );

        let path_string =
            path.to_string_lossy()
                .to_string();

        let name =
            path.file_name()
                .and_then(|value| {
                    value.to_str()
                })
                .unwrap_or(
                    "render.mp4",
                )
                .to_string();

        let id =
            format!(
                "render_{}",
                name
            );

        files.push(
            RenderedVideoMedia {
                id,
                name,
                path: path_string,
                size: metadata.len(),
                modified_at,
            },
        );
    }

    files.sort_by(
        |a, b| {
            b.modified_at
                .cmp(&a.modified_at)
        },
    );

    Ok(files)
}

#[tauri::command]
async fn delete_rendered_video(
    app: AppHandle,
    path: String,
) -> Result<(), String> {
    let target =
        PathBuf::from(&path);

    if !target.exists() {
        return Ok(());
    }

    if !target.is_file() {
        return Err(
            "The selected render is not a file."
                .to_string(),
        );
    }

    let directory =
        renders_dir(&app)?;

    if !ensure_path_is_inside(
        &target,
        &directory,
    ) {
        return Err(
            "For safety, Content Studio can only delete files from its rendered-output directory."
                .to_string(),
        );
    }

    fs::remove_file(&target)
        .map_err(|error| {
            format!(
                "Unable to delete rendered video: {error}"
            )
        })?;

    Ok(())
}

#[tauri::command]
async fn reveal_rendered_video(
    app: AppHandle,
    path: String,
) -> Result<(), String> {
    let target =
        PathBuf::from(&path);

    if !target.exists() {
        return Err(format!(
            "File does not exist: {path}"
        ));
    }

    if !target.is_file() {
        return Err(
            "The selected render is not a file."
                .to_string(),
        );
    }

    let directory =
        renders_dir(&app)?;

    if !ensure_path_is_inside(
        &target,
        &directory,
    ) {
        return Err(
            "For safety, Content Studio can only reveal files from its rendered-output directory."
                .to_string(),
        );
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args([
                "-R",
                &path,
            ])
            .spawn()
            .map_err(|error| {
                format!(
                    "Unable to reveal file: {error}"
                )
            })?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args([
                "/select,",
                &path,
            ])
            .spawn()
            .map_err(|error| {
                format!(
                    "Unable to reveal file: {error}"
                )
            })?;
    }

    #[cfg(target_os = "linux")]
    {
        let parent =
            target
                .parent()
                .unwrap_or_else(
                    || Path::new("."),
                );

        Command::new("xdg-open")
            .arg(
                parent
                    .to_string_lossy()
                    .to_string(),
            )
            .spawn()
            .map_err(|error| {
                format!(
                    "Unable to reveal file: {error}"
                )
            })?;
    }

    Ok(())
}

pub fn run() {
    let migrations =
        vec![
            Migration {
                version: 1,

                description:
                    "create initial tables",

                sql: r#"
                    CREATE TABLE IF NOT EXISTS projects (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        source_media_id TEXT,
                        template_id TEXT,
                        width INTEGER NOT NULL DEFAULT 1080,
                        height INTEGER NOT NULL DEFAULT 1920,
                        status TEXT NOT NULL DEFAULT 'draft',
                        settings_json TEXT NOT NULL DEFAULT '{}',
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS media (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        path TEXT NOT NULL,
                        media_type TEXT NOT NULL,
                        size INTEGER NOT NULL DEFAULT 0,
                        duration REAL,
                        width INTEGER,
                        height INTEGER,
                        created_at TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS templates (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        layers_json TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS variations (
                        id TEXT PRIMARY KEY,
                        project_id TEXT NOT NULL,
                        text TEXT NOT NULL,
                        sort_order INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS rendered_videos (
                        id TEXT PRIMARY KEY,
                        project_id TEXT NOT NULL,
                        variation_id INTEGER NOT NULL,
                        variation_text TEXT NOT NULL,
                        output_path TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    );
                "#,

                kind:
                    MigrationKind::Up,
            },

            Migration {
                version: 2,

                description:
                    "add project metadata",

                sql: r#"
                    ALTER TABLE projects
                    ADD COLUMN description TEXT;
                "#,

                kind:
                    MigrationKind::Up,
            },

            Migration {
                version: 3,

                description:
                    "add output settings",

                sql: r#"
                    ALTER TABLE projects
                    ADD COLUMN output_format TEXT
                    NOT NULL DEFAULT 'mp4';
                "#,

                kind:
                    MigrationKind::Up,
            },

            Migration {
                version: 4,

                description:
                    "add template dimensions",

                sql: r#"
                    ALTER TABLE templates
                    ADD COLUMN width INTEGER
                    NOT NULL DEFAULT 1080;

                    ALTER TABLE templates
                    ADD COLUMN height INTEGER
                    NOT NULL DEFAULT 1920;
                "#,

                kind:
                    MigrationKind::Up,
            },

            Migration {
                version: 5,

                description:
                    "add content factory",

                sql: r#"
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
                "#,

                kind:
                    MigrationKind::Up,
            },
        ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:content-studio.db",
                    migrations,
                )
                .build(),
        )
        .plugin(
            tauri_plugin_dialog::init(),
        )
        .invoke_handler(
            tauri::generate_handler![
                import_media,
                delete_media,
                generate_media_thumbnail,
                sync_media_library,
                check_ffmpeg,
                render_batch,
                list_rendered_videos,
                delete_rendered_video,
                reveal_rendered_video,
            ],
        )
        .run(
            tauri::generate_context!(),
        )
        .expect(
            "error while running tauri application",
        );
}

fn main() {
    run();
}
