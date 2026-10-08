import { FormEvent, useState } from "react";

import { login, register } from "../services/auth";

import "./Login.css";

interface LoginProps {
  onAuthenticated: () => void;
}

function Login({ onAuthenticated }: LoginProps) {
  const [mode, setMode] = useState<"login" | "register">("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setError("");
    setLoading(true);

    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await register(
          email.trim(),
          password,
          displayName.trim(),
        );
      }

      onAuthenticated();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to connect to Content Studio.",
      );
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode((current) =>
      current === "login" ? "register" : "login",
    );

    setError("");
  };

  return (
    <div className="login-page">
      <div className="login-shell">
        <div className="login-brand">
          <div className="login-brand-mark">CS</div>

          <div>
            <div className="login-brand-name">
              Content Studio
            </div>

            <div className="login-brand-subtitle">
              Creator Workspace
            </div>
          </div>
        </div>

        <div className="login-card">
          <div className="login-header">
            <p className="login-eyebrow">
              {mode === "login"
                ? "WELCOME BACK"
                : "CREATE YOUR ACCOUNT"}
            </p>

            <h1>
              {mode === "login"
                ? "Sign in to Content Studio"
                : "Create your Content Studio account"}
            </h1>

            <p>
              {mode === "login"
                ? "Sign in to access your creator workspace."
                : "Create an account to start using your creator workspace."}
            </p>
          </div>

          <form
            className="login-form"
            onSubmit={handleSubmit}
          >
            {mode === "register" && (
              <label>
                <span>Display name</span>

                <input
                  type="text"
                  value={displayName}
                  onChange={(event) =>
                    setDisplayName(event.target.value)
                  }
                  placeholder="Your name"
                  autoComplete="name"
                  disabled={loading}
                  required
                />
              </label>
            )}

            <label>
              <span>Email</span>

              <input
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                placeholder="you@example.com"
                autoComplete="email"
                disabled={loading}
                required
              />
            </label>

            <label>
              <span>Password</span>

              <input
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                placeholder="Enter your password"
                autoComplete={
                  mode === "login"
                    ? "current-password"
                    : "new-password"
                }
                disabled={loading}
                required
                minLength={8}
              />
            </label>

            {error && (
              <div className="login-error">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="login-submit"
              disabled={loading}
            >
              {loading
                ? "Please wait..."
                : mode === "login"
                  ? "Sign In"
                  : "Create Account"}
            </button>
          </form>

          <div className="login-switch">
            <span>
              {mode === "login"
                ? "Don't have an account?"
                : "Already have an account?"}
            </span>

            <button
              type="button"
              onClick={switchMode}
              disabled={loading}
            >
              {mode === "login"
                ? "Create one"
                : "Sign in"}
            </button>
          </div>
        </div>

        <div className="login-footer">
          Content Studio • Local Creator Workspace
        </div>
      </div>
    </div>
  );
}

export default Login;
