import { useEffect, useState } from "react";

import "./App.css";

import Admin from "./pages/Admin";
import Create from "./pages/Create";
import Library from "./pages/Library";
import Login from "./pages/Login";
import Media from "./pages/Media";
import Projects from "./pages/Projects";
import { Templates } from "./pages/Templates";

import {
  getCurrentUser,
  getStoredUser,
  isLoggedIn,
  logout,
  type User,
} from "./services/auth";

type Page =
  | "Dashboard"
  | "Create"
  | "Library"
  | "Templates"
  | "Media"
  | "Projects"
  | "Publishing"
  | "Analytics"
  | "Admin";

function App() {
  const [user, setUser] = useState<User | null>(
    getStoredUser(),
  );

  const [checkingSession, setCheckingSession] =
    useState(true);

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
      >("SELECT COUNT(*) as count FROM projects");

      const templates = await db.select<
        { count: number }[]
      >("SELECT COUNT(*) as count FROM templates");

      const media = await db.select<
        { count: number }[]
      >("SELECT COUNT(*) as count FROM media");

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
    const verifySession = async () => {
      if (!isLoggedIn()) {
        setCheckingSession(false);
        return;
      }

      try {
        const currentUser = await getCurrentUser();

        setUser(currentUser);
      } catch (error) {
        console.error(
          "Unable to verify Content Studio session:",
          error,
        );

        setUser(null);
      } finally {
        setCheckingSession(false);
      }
    };

    verifySession();
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    refreshCounts();

    const handleFocus = () => {
      refreshCounts();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener(
        "focus",
        handleFocus,
      );
    };
  }, [activePage, user]);

  const handleAuthenticated = async () => {
    try {
      const currentUser = await getCurrentUser();

      setUser(currentUser);
      setActivePage("Dashboard");
    } catch (error) {
      console.error(
        "Unable to load authenticated user:",
        error,
      );
    }
  };

  const handleLogout = async () => {
    await logout();

    setUser(null);
    setActivePage("Dashboard");
  };

  const navigate = (page: Page) => {
    setActivePage(page);
  };

  if (checkingSession) {
    return (
      <div className="app">
        <main className="main">
          <div className="page">
            <div className="page-header">
              <div>
                <p className="eyebrow">
                  CONTENT STUDIO
                </p>

                <h1>Loading workspace...</h1>

                <p className="page-description">
                  Verifying your account.
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!user) {
    return (
      <Login
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  const Sidebar = () => (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">CS</div>

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
        {[
          "Dashboard",
          "Create",
          "Library",
          "Templates",
          "Media",
          "Projects",
          "Publishing",
          "Analytics",
          ...(user.role === "admin"
            ? ["Admin"]
            : []),
        ].map((item) => (
          <button
            key={item}
            className={
              activePage === item
                ? "nav-item active"
                : "nav-item"
            }
            onClick={() =>
              navigate(item as Page)
            }
          >
            {item}
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

          <button
            type="button"
            onClick={handleLogout}
            title="Sign out"
            style={{
              marginLeft: "auto",
              border: 0,
              background: "transparent",
              color: "#777780",
              cursor: "pointer",
              fontSize: 12,
              padding: "6px",
              flexShrink: 0,
            }}
          >
            ↪
          </button>
        </div>
      </div>
    </aside>
  );

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
          This area is intentionally reserved
          for a later version. The core V1
          creation, templates, projects,
          media library, and rendering
          workflow are available now.
        </p>
      </section>
    </div>
  );

  const renderPage = () => {
    if (activePage === "Create") {
      return <Create />;
    }

    if (activePage === "Library") {
      return <Library />;
    }

    if (activePage === "Templates") {
      return <Templates />;
    }

    if (activePage === "Media") {
      return <Media />;
    }

    if (activePage === "Projects") {
      return <Projects />;
    }

    if (activePage === "Admin") {
      return <Admin currentUser={user} />;
    }

    if (activePage === "Publishing") {
      return renderPlaceholder(
        "Publishing",
        "Direct social publishing will be added after the local content-generation workflow is proven.",
      );
    }

    if (activePage === "Analytics") {
      return renderPlaceholder(
        "Analytics",
        "Performance analytics will be added after publishing integrations exist.",
      );
    }

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
              manage your short-form content
              from one local workspace.
            </p>
          </div>

          <button
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
              Organize your videos, text, and
              audio into categories, then use
              those categories to quickly
              create batches of short-form
              content.
            </p>

            <div className="welcome-actions">
              <button
                className="primary-button"
                onClick={() =>
                  navigate("Library")
                }
              >
                Build Content Library
              </button>

              <button
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
                NEW WORKFLOW
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
                Choose your video, text,
                audio, and template
                categories and create batches.
              </p>
            </div>
          </div>
        </section>
      </div>
    );
  };

  return (
    <div className="app">
      <Sidebar />

      <main className="main">
        {renderPage()}
      </main>
    </div>
  );
}

export default App;
