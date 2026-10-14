import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";

type RenderedVideo = {
  id: string | number;
  name?: string;
  path?: string;
  output_path?: string;
  variation_text?: string;
  size?: number;
  modifiedAt?: string;
};

type UploadJob = {
  id: string;
  videoPath: string;
  title: string;
  description?: string;
  madeForKids: boolean;
  scheduledAt: string;
  status: string;
  message?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
};

const RUNNER = "http://127.0.0.1:8788";

function defaultScheduleValue(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

const styles: Record<string, CSSProperties> = {
  page: {
    padding: 28,
    color: "#f3f4f6",
    background: "#0d1014",
    minHeight: "100%",
    fontFamily: "Inter, system-ui, sans-serif",
    boxSizing: "border-box"
  },
  heading: { fontSize: 28, fontWeight: 750, margin: "0 0 8px" },
  muted: { color: "#9ca3af", lineHeight: 1.5 },
  panel: {
    background: "#151a21",
    border: "1px solid #29313b",
    borderRadius: 12,
    padding: 20,
    marginTop: 20,
    minWidth: 0,
    boxSizing: "border-box"
  },
  label: {
    display: "block",
    color: "#d1d5db",
    fontSize: 13,
    marginBottom: 7
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    color: "#f9fafb",
    background: "#0d1014",
    border: "1px solid #374151",
    borderRadius: 7,
    padding: "11px 12px",
    fontSize: 14
  },
  button: {
    background: "#2563eb",
    color: "#fff",
    border: 0,
    borderRadius: 8,
    padding: "11px 16px",
    fontWeight: 700,
    cursor: "pointer"
  },
  secondaryButton: {
    background: "#252d38",
    color: "#f9fafb",
    border: "1px solid #374151",
    borderRadius: 8,
    padding: "10px 14px",
    cursor: "pointer"
  },
  dangerButton: {
    background: "#451a1a",
    color: "#fecaca",
    border: "1px solid #7f1d1d",
    borderRadius: 8,
    padding: "10px 14px",
    cursor: "pointer"
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
    gap: 20,
    alignItems: "start"
  },
  job: {
    padding: "13px 0",
    borderBottom: "1px solid #29313b",
    overflowWrap: "anywhere"
  }
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function getVideoPath(video: RenderedVideo): string {
  return video.path?.trim() || video.output_path?.trim() || "";
}

function getVideoLabel(video: RenderedVideo): string {
  return (
    video.variation_text?.trim() ||
    video.name?.trim() ||
    fileName(getVideoPath(video))
  );
}

export default function UploadQueue() {
  const [videos, setVideos] = useState<RenderedVideo[]>([]);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [schedule, setSchedule] = useState(defaultScheduleValue);
  const [madeForKids, setMadeForKids] = useState(false);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [videosLoading, setVideosLoading] = useState(true);
  const [runnerOnline, setRunnerOnline] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshVideos = useCallback(async () => {
    setVideosLoading(true);

    try {
      const result = await invoke<RenderedVideo[]>("list_rendered_videos");

      if (!Array.isArray(result)) {
        throw new Error("The rendered-video command did not return a list.");
      }

      const list = result.filter((item) => {
        const filePath = item ? getVideoPath(item) : "";
        return Boolean(filePath) && /\.mp4$/i.test(filePath);
      });

      setVideos(list);

      setSelectedPath((current) =>
        current && list.some((video) => getVideoPath(video) === current)
          ? current
          : list.length
            ? getVideoPath(list[0])
            : ""
      );

      setError((current) =>
        current.startsWith("Could not load rendered videos:") ? "" : current
      );
    } catch (err) {
      setError(`Could not load rendered videos: ${errorMessage(err)}`);
    } finally {
      setVideosLoading(false);
    }
  }, []);

  const refreshRunner = useCallback(async () => {
    try {
      const response = await fetch(`${RUNNER}/health`, {
        cache: "no-store"
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const health = await response.json();
      if (!health?.ok) throw new Error("Runner health check failed.");

      setRunnerOnline(true);
    } catch {
      setRunnerOnline(false);
    }
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const response = await fetch(`${RUNNER}/jobs`, {
        cache: "no-store"
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();

      setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
      setRunnerOnline(true);
    } catch {
      setRunnerOnline(false);
    }
  }, []);

  useEffect(() => {
    void refreshVideos();
    void refreshRunner();
    void refreshJobs();

    const interval = window.setInterval(() => {
      void refreshRunner();
      void refreshJobs();
    }, 3000);

    return () => window.clearInterval(interval);
  }, [refreshVideos, refreshRunner, refreshJobs]);

  function handleVideoChange(filePath: string) {
    setSelectedPath(filePath);

    const video = videos.find((item) => getVideoPath(item) === filePath);

    setTitle(video ? getVideoLabel(video) : "");
    setError("");
    setNotice("");
  }

  async function scheduleUpload() {
    setError("");
    setNotice("");

    if (!runnerOnline) {
      setError(
        "The runner is offline. Start it in Terminal and leave that window open."
      );
      return;
    }

    if (!selectedPath) {
      setError("Select a rendered MP4 first.");
      return;
    }

    if (!title.trim()) {
      setError("Enter a YouTube title.");
      return;
    }

    if (title.trim().length > 100) {
      setError("YouTube titles cannot exceed 100 characters.");
      return;
    }

    const scheduledDate = new Date(schedule);

    if (
      !schedule ||
      Number.isNaN(scheduledDate.getTime()) ||
      scheduledDate.getTime() <= Date.now()
    ) {
      setError("Choose a valid future date and time.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${RUNNER}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoPath: selectedPath,
          title: title.trim(),
          description: description.trim(),
          madeForKids,
          scheduledAt: scheduledDate.toISOString()
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Runner returned HTTP ${response.status}`
        );
      }

      setNotice(
        `Submitted "${title.trim()}" to the runner. Check its status in the queue below.`
      );

      await refreshJobs();
    } catch (err) {
      setError(`Could not submit the upload: ${errorMessage(err)}`);
      await refreshRunner();
    } finally {
      setLoading(false);
    }
  }

  async function clearQueue() {
    const confirmed = window.confirm(
      "Clear the upload queue? This removes queue entries only. Rendered video files will not be deleted. An upload already in progress will be left untouched."
    );

    if (!confirmed) return;

    setClearing(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`${RUNNER}/jobs/clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Runner returned HTTP ${response.status}`
        );
      }

      setJobs(Array.isArray(data.jobs) ? data.jobs : []);

      setNotice(
        data.message ||
          "Queue cleared. Your rendered video files have not been deleted."
      );

      await refreshJobs();
    } catch (err) {
      setError(`Could not clear the queue: ${errorMessage(err)}`);
      await refreshRunner();
    } finally {
      setClearing(false);
    }
  }

  const selectedVideo = videos.find(
    (video) => getVideoPath(video) === selectedPath
  );

  return (
    <div style={styles.page}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap"
        }}
      >
        <div>
          <div
            style={{
              color: "#60a5fa",
              fontSize: 11,
              letterSpacing: 2,
              fontWeight: 800,
              marginBottom: 8
            }}
          >
            YOUTUBE SHORTS
          </div>

          <h1 style={styles.heading}>Upload &amp; Schedule</h1>

          <div style={styles.muted}>
            Send a rendered Short from Content Studio to your signed-in
            YouTube Studio session.
          </div>
        </div>

        <div
          role="status"
          style={{
            border: "1px solid #374151",
            borderRadius: 999,
            padding: "8px 12px",
            fontSize: 12,
            color: runnerOnline ? "#86efac" : "#fca5a5"
          }}
        >
          {runnerOnline ? "● Runner online" : "● Runner offline"}
        </div>
      </header>

      {error && (
        <div
          role="alert"
          style={{
            ...styles.panel,
            borderColor: "#7f1d1d",
            color: "#fecaca",
            overflowWrap: "anywhere"
          }}
        >
          <strong>Something needs attention</strong>
          <div style={{ marginTop: 6 }}>{error}</div>
        </div>
      )}

      {notice && (
        <div
          role="status"
          style={{
            ...styles.panel,
            borderColor: "#166534",
            color: "#bbf7d0"
          }}
        >
          {notice}
        </div>
      )}

      <div style={styles.grid}>
        <section style={styles.panel}>
          <h2 style={{ fontSize: 18, marginTop: 0 }}>
            New scheduled upload
          </h2>

          <div style={{ marginBottom: 16 }}>
            <label style={styles.label} htmlFor="upload-video">
              Rendered video
            </label>

            <select
              id="upload-video"
              style={styles.input}
              value={selectedPath}
              onChange={(event) => handleVideoChange(event.target.value)}
            >
              <option value="">
                {videosLoading
                  ? "Loading rendered videos..."
                  : videos.length
                    ? "Select a rendered video..."
                    : "No rendered videos found"}
              </option>

              {videos.map((video, index) => (
                <option
                  key={`${video.id}-${getVideoPath(video)}-${index}`}
                  value={getVideoPath(video)}
                >
                  {getVideoLabel(video)}
                </option>
              ))}
            </select>

            {selectedVideo && (
              <div
                style={{
                  ...styles.muted,
                  fontSize: 11,
                  overflowWrap: "anywhere",
                  marginTop: 8
                }}
              >
                {getVideoPath(selectedVideo)}
              </div>
            )}

            <button
              type="button"
              style={{ ...styles.secondaryButton, marginTop: 10 }}
              onClick={() => void refreshVideos()}
              disabled={videosLoading}
            >
              {videosLoading ? "Refreshing..." : "Refresh rendered videos"}
            </button>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={styles.label} htmlFor="upload-title">
              YouTube title
            </label>

            <input
              id="upload-title"
              style={styles.input}
              value={title}
              maxLength={100}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Enter your Short's title"
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={styles.label} htmlFor="upload-description">
              Description
            </label>

            <textarea
              id="upload-description"
              style={{
                ...styles.input,
                minHeight: 100,
                resize: "vertical"
              }}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional description"
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={styles.label} htmlFor="upload-schedule">
              Schedule date and time
            </label>

            <input
              id="upload-schedule"
              style={styles.input}
              type="datetime-local"
              value={schedule}
              onChange={(event) => setSchedule(event.target.value)}
            />

            <div
              style={{
                ...styles.muted,
                fontSize: 12,
                marginTop: 6
              }}
            >
              Uses your computer's local time.
            </div>
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              marginBottom: 20,
              lineHeight: 1.5,
              color: "#d1d5db",
              fontSize: 13
            }}
          >
            <input
              type="checkbox"
              checked={madeForKids}
              onChange={(event) => setMadeForKids(event.target.checked)}
              style={{ marginTop: 3 }}
            />
            This video is made for kids
          </label>

          <button
            type="button"
            style={{
              ...styles.button,
              width: "100%",
              opacity: loading ? 0.65 : 1
            }}
            disabled={loading}
            onClick={() => void scheduleUpload()}
          >
            {loading ? "Adding to queue..." : "Upload & Schedule"}
          </button>

          <button
            type="button"
            style={{
              ...styles.secondaryButton,
              width: "100%",
              marginTop: 10
            }}
            onClick={() => {
              void refreshRunner();
              void refreshJobs();
            }}
          >
            Refresh runner status
          </button>

          <p
            style={{
              ...styles.muted,
              fontSize: 12,
              marginBottom: 0
            }}
          >
            Keep the runner Terminal window open and Chrome signed in to
            YouTube Studio. A queued job does not mean YouTube has confirmed
            the upload or schedule.
          </p>
        </section>

        <section style={styles.panel}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap"
            }}
          >
            <h2 style={{ fontSize: 18, margin: 0 }}>Upload queue</h2>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                style={styles.secondaryButton}
                onClick={() => {
                  void refreshJobs();
                  void refreshRunner();
                }}
              >
                Refresh queue
              </button>

              <button
                type="button"
                style={{
                  ...styles.dangerButton,
                  opacity: clearing ? 0.65 : 1
                }}
                disabled={clearing}
                onClick={() => void clearQueue()}
              >
                {clearing ? "Clearing..." : "Clear Queue"}
              </button>
            </div>
          </div>

          {jobs.length === 0 ? (
            <p style={styles.muted}>No upload jobs yet.</p>
          ) : (
            jobs.map((job, index) => (
              <div
                key={job.id || `${job.videoPath}-${index}`}
                style={styles.job}
              >
                <div
                  style={{
                    fontWeight: 700,
                    overflowWrap: "anywhere",
                    marginBottom: 7
                  }}
                >
                  {job.title ||
                    fileName(job.videoPath || "Untitled upload")}
                </div>

                <div style={{ fontSize: 12, marginBottom: 7 }}>
                  Status:{" "}
                  <strong
                    style={{
                      color:
                        job.status === "scheduled"
                          ? "#86efac"
                          : job.status === "failed"
                            ? "#fca5a5"
                            : "#93c5fd"
                    }}
                  >
                    {job.status || "unknown"}
                  </strong>
                </div>

                <div style={{ ...styles.muted, fontSize: 12 }}>
                  Scheduled for:{" "}
                  {job.scheduledAt &&
                  !Number.isNaN(new Date(job.scheduledAt).getTime())
                    ? new Date(job.scheduledAt).toLocaleString()
                    : "Not set"}
                </div>

                {job.message && (
                  <div
                    style={{
                      ...styles.muted,
                      fontSize: 12,
                      marginTop: 6,
                      overflowWrap: "anywhere"
                    }}
                  >
                    {job.message}
                  </div>
                )}
              </div>
            ))
          )}

          <p
            style={{
              ...styles.muted,
              fontSize: 12,
              marginBottom: 0,
              marginTop: 16
            }}
          >
            Clear Queue removes queue records only. It does not delete
            rendered videos from your computer. An active upload is left
            untouched.
          </p>
        </section>
      </div>
    </div>
  );
}
