import { useEffect, useState } from "react";

import "./App.css";

import Admin from "./pages/Admin";
import Create from "./pages/Create";
import Library from "./pages/Library";
import Media from "./pages/Media";
import Projects from "./pages/Projects";
import { Templates } from "./pages/Templates";
import YouTubeAccounts from "./pages/YouTubeAccounts";
import UploadQueue from "./pages/UploadQueue";

import type { User } from "./services/auth";

type Page =
  | "Dashboard"
  | "Create"
  | "Library"
  | "Templates"
  | "Media"
  | "Projects"
  | "Publishing"
  | "YouTubeAccounts"
  | "UploadQueue"
  | "Analytics"
  | "Admin";

function App() {
  const [user] = useState<User>({ id: "local-creator", email: "local@contentstudio.app", display_name: "Creator", role: "user", plan: "free" } as User);

  const [activePage, setActivePage] =
    useState<Page>("Dashboard");

  const [counts, setCounts] = useState({
    projects: 0,
    templates: 0,
    media: 0,
  });

  const refreshCounts = async () => {
    try {
      const Database =
        (await import("@tauri-apps/plugin-sql")).default;

      const db = await Database.load(
        "sqlite:content-studio.db",
      );

      const projects = await db.select<
        { count: number }[]
      >(
        "SELECT COUNT(*) as count FROM projects",
      );

      const templates = await db.select<
        { count: number }[]
      >(
        "SELECT COUNT(*) as count FROM templates",
      );

      const media = await db.select<
        { count: number }[]
      >(
        "SELECT COUNT(*) as count FROM media",
      );

      setCounts({
        projects: Number(projects[0]?.count ?? 0),
        templates: Number(templates[0]?.count ?? 0),
        media: Number(media[0]?.count ?? 0),
      });
    } catch (error) {
      console.error(
        "Unable to refresh dashboard counts:",
        error,
      );
    }
  };

  useEffect(() => {
    if (!user) {
      return;
    }

    void refreshCounts();

    const handleFocus = () => {
      void refreshCounts();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener(
        "focus",
        handleFocus,
      );
    };
  }, [activePage, user]);

  const navigate = (page: Page) => {
    setActivePage(page);
  };

  const navigationItems: {
    label: string;
    page: Page;
  }[] = [
    {
      label: "Dashboard",
      page: "Dashboard",
    },
    {
      label: "Create",
      page: "Create",
    },
    {
      label: "Library",
      page: "Library",
    },
    {
      label: "Templates",
      page: "Templates",
    },
    {
      label: "Media",
      page: "Media",
    },
    {
      label: "Projects",
      page: "Projects",
    },
    {
      label: "Publishing",
      page: "Publishing",
    },
    {
      label: "YouTube Accounts",
      page: "YouTubeAccounts",
    },
    {
      label: "Upload Queue",
      page: "UploadQueue",
    },
    {
      label: "Analytics",
      page: "Analytics",
    },
  ];

  if (user.role === "admin") {
    navigationItems.push({
      label: "Admin",
      page: "Admin",
    });
  }

  const renderPlaceholder = (
    title: string,
    description: string,
  ) => (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">
            COMING LATER
          </p>

          <h1>{title}</h1>

          <p className="page-description">
            {description}
          </p>
        </div>
      </div>

      <section className="feature-card">
        <h3>{title}</h3>

        <p className="muted">
          This area is reserved for a later
          version. Your existing content
          creation, templates, projects,
          media library, and rendering
          workflow remain available.
        </p>
      </section>
    </div>
  );

  const renderPage = () => {
    switch (activePage) {
      case "Create":
        return <Create />;

      case "Library":
        return <Library />;

      case "Templates":
        return <Templates />;

      case "Media":
        return <Media />;

      case "Projects":
        return <Projects />;

      case "YouTubeAccounts":
        return <YouTubeAccounts />;

      case "UploadQueue":
        return <UploadQueue />;

      case "Admin":
        return user.role === "admin"
          ? <Admin currentUser={user} />
          : renderPlaceholder(
              "Access restricted",
              "You do not have permission to access this page.",
            );

      case "Publishing":
        return (
          <div className="page">
            <div className="page-header">
              <div>
                <p className="eyebrow">
                  YOUTUBE PUBLISHING
                </p>

                <h1>Publishing</h1>

                <p className="page-description">
                  Manage your YouTube channels
                  and prepare videos for upload.
                </p>
              </div>
            </div>

            <section className="feature-grid">
              <div className="feature-card">
                <div className="feature-icon">
                  01
                </div>

                <h3>YouTube Accounts</h3>

                <p>
                  Open your account workspace
                  to manage your configured
                  YouTube channels.
                </p>

                <button
                  type="button"
                  className="primary-button"
                  onClick={() =>
                    navigate("YouTubeAccounts")
                  }
                >
                  Manage Accounts
                </button>
              </div>

              <div className="feature-card">
                <div className="feature-icon">
                  02
                </div>

                <h3>Upload Queue</h3>

                <p>
                  Open the upload queue to
                  review your video publishing
                  jobs.
                </p>

                <button
                  type="button"
                  className="primary-button"
                  onClick={() =>
                    navigate("UploadQueue")
                  }
                >
                  Open Upload Queue
                </button>
              </div>
            </section>
          </div>
        );

      case "Analytics":
        return renderPlaceholder(
          "Analytics",
          "Performance analytics can be added after the publishing workflow is established.",
        );

      case "Dashboard":
      default:
        return (
          <div className="page">
            <div className="page-header">
              <div>
                <p className="eyebrow">
                  WORKSPACE
                </p>

                <h1>Dashboard</h1>

                <p className="page-description">
                  Create, organize, render, and
                  manage your short-form
                  content from one local
                  workspace.
                </p>
              </div>

              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  navigate("Create")
                }
              >
                + Create Content
              </button>
            </div>

            <section className="welcome">
              <div>
                <p className="eyebrow">
                  CONTENT STUDIO
                </p>

                <h2>
                  Build your content library
                  once. Create from it again
                  and again.
                </h2>

                <p className="welcome-text">
                  Organize your videos, text,
                  and audio into categories,
                  then use those categories
                  to quickly create batches
                  of short-form content.
                </p>

                <div className="welcome-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() =>
                      navigate("Library")
                    }
                  >
                    Build Content Library
                  </button>

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      navigate("Create")
                    }
                  >
                    Create Content
                  </button>
                </div>
              </div>
            </section>

            <section className="stats">
              <div className="stat-card">
                <span>Projects</span>

                <strong>
                  {counts.projects}
                </strong>

                <small>
                  Saved creation projects
                </small>
              </div>

              <div className="stat-card">
                <span>Templates</span>

                <strong>
                  {counts.templates}
                </strong>

                <small>
                  Reusable visual templates
                </small>
              </div>

              <div className="stat-card">
                <span>Media</span>

                <strong>
                  {counts.media}
                </strong>

                <small>
                  Imported source assets
                </small>
              </div>

              <div className="stat-card">
                <span>Library</span>

                <strong>NEW</strong>

                <small>
                  Categories for your content
                </small>
              </div>
            </section>

            <section className="section">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    CONTENT WORKFLOW
                  </p>

                  <h3>
                    Build once. Reuse
                    everything.
                  </h3>
                </div>
              </div>

              <div className="feature-grid">
                <div className="feature-card">
                  <div className="feature-icon">
                    01
                  </div>

                  <h4>Organize Videos</h4>

                  <p>
                    Create your own video
                    categories and assign
                    imported footage to them.
                  </p>
                </div>

                <div className="feature-card">
                  <div className="feature-icon">
                    02
                  </div>

                  <h4>Build Text Libraries</h4>

                  <p>
                    Save hooks, captions,
                    headlines, calls to action,
                    and other reusable text.
                  </p>
                </div>

                <div className="feature-card">
                  <div className="feature-icon">
                    03
                  </div>

                  <h4>Combine Categories</h4>

                  <p>
                    Choose video, text, audio,
                    and template categories to
                    create batches of content.
                  </p>
                </div>
              </div>
            </section>

            <section className="section">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    YOUTUBE SHORTS
                  </p>

                  <h3>
                    Continue to publishing
                  </h3>
                </div>
              </div>

              <div className="feature-grid">
                <div className="feature-card">
                  <div className="feature-icon">
                    YT
                  </div>

                  <h4>YouTube Accounts</h4>

                  <p>
                    Open the account page to
                    work with your YouTube
                    channel configurations.
                  </p>

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      navigate("YouTubeAccounts")
                    }
                  >
                    Open Accounts
                  </button>
                </div>

                <div className="feature-card">
                  <div className="feature-icon">
                    UP
                  </div>

                  <h4>Upload Queue</h4>

                  <p>
                    Open the queue to review
                    your upload jobs and
                    publishing workflow.
                  </p>

                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      navigate("UploadQueue")
                    }
                  >
                    Open Queue
                  </button>
                </div>
              </div>
            </section>
          </div>
        );
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            CS
          </div>

          <div>
            <div className="brand-name">
              Content Studio
            </div>

            <div className="brand-subtitle">
              Creator Workspace
            </div>
          </div>
        </div>

        <nav className="navigation">
          {navigationItems.map((item) => (
            <button
              key={item.page}
              type="button"
              className={
                activePage === item.page
                  ? "nav-item active"
                  : "nav-item"
              }
              onClick={() =>
                navigate(item.page)
              }
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="user-card">
            <div className="avatar">
              {(user.display_name || user.email)
                .charAt(0)
                .toUpperCase()}
            </div>

            <div style={{ minWidth: 0 }}>
              <div className="user-name">
                {user.display_name || "Creator"}
              </div>

              <div className="user-role">
                {user.role === "admin"
                  ? "Administrator"
                  : `${user.plan.charAt(0).toUpperCase()}${user.plan.slice(1)} Plan`}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        {renderPage()}
      </main>
    </div>
  );
}

export default App;
