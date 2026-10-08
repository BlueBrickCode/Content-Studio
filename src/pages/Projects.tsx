import { useEffect, useState } from "react";
import Database from "@tauri-apps/plugin-sql";

type Project = {
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

export default function Projects() {
  const [projects, setProjects] =
    useState<Project[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const loadProjects = async () => {
    try {
      setLoading(true);
      setError("");

      const db =
        await Database.load(
          "sqlite:content-studio.db"
        );

      const rows =
        await db.select<Project[]>(
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
          ORDER BY updated_at DESC
          `
        );

      setProjects(rows);
    } catch (err) {
      setError(
        `Unable to load projects: ${String(
          err
        )}`
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const openProject = (
    project: Project
  ) => {
    sessionStorage.setItem(
      "contentStudioOpenProjectId",
      project.id
    );

    window.dispatchEvent(
      new CustomEvent(
        "content-studio-open-create"
      )
    );
  };

  const deleteProject = async (
    project: Project
  ) => {
    const confirmed = window.confirm(
      `Delete "${project.name}"?`
    );

    if (!confirmed) {
      return;
    }

    try {
      const db =
        await Database.load(
          "sqlite:content-studio.db"
        );

      await db.execute(
        "DELETE FROM projects WHERE id = ?",
        [project.id]
      );

      await loadProjects();
    } catch (err) {
      setError(
        `Unable to delete project: ${String(
          err
        )}`
      );
    }
  };

  const createProject = () => {
    sessionStorage.removeItem(
      "contentStudioOpenProjectId"
    );

    window.dispatchEvent(
      new CustomEvent(
        "content-studio-new-create"
      )
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">
            PROJECT WORKSPACE
          </p>

          <h1>Projects</h1>

          <p className="page-description">
            Reopen saved creation projects and
            continue where you left off.
          </p>
        </div>

        <button
          className="primary-button"
          onClick={createProject}
        >
          + New Project
        </button>
      </div>

      {error && (
        <div className="message error">
          {error}
        </div>
      )}

      <section
        className="feature-card"
        style={{ marginTop: 18 }}
      >
        {loading ? (
          <div className="empty-state">
            Loading projects...
          </div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <strong>
              No projects yet.
            </strong>

            <p
              style={{
                marginTop: 8,
              }}
            >
              Create a project to save your
              source, template, settings, and
              variations.
            </p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>

            <tbody>
              {projects.map(
                (project) => (
                  <tr key={project.id}>
                    <td>
                      <strong>
                        {project.name}
                      </strong>
                    </td>

                    <td>
                      {project.status}
                    </td>

                    <td>
                      {new Date(
                        project.updated_at
                      ).toLocaleString()}
                    </td>

                    <td>
                      <div
                        style={{
                          display: "flex",
                          justifyContent:
                            "flex-end",
                          gap: 8,
                        }}
                      >
                        <button
                          className="secondary-button"
                          onClick={() =>
                            openProject(
                              project
                            )
                          }
                        >
                          Open
                        </button>

                        <button
                          className="danger-button"
                          onClick={() =>
                            deleteProject(
                              project
                            )
                          }
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
