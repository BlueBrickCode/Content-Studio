// src/pages/YouTubeAccounts.tsx

import { useCallback, useEffect, useState } from "react";
import Database from "@tauri-apps/plugin-sql";

type YouTubeAccount = {
  id: string;
  channel_name: string;
  channel_id: string;
  notes: string;
  enabled: number;
  created_at: string;
};

const DB_NAME = "sqlite:content-studio.db";

const pageStyle: React.CSSProperties = {
  padding: 28,
  color: "#f3f4f6",
  maxWidth: 1100,
};

const panelStyle: React.CSSProperties = {
  background: "#151922",
  border: "1px solid #2b3240",
  borderRadius: 12,
  padding: 20,
  marginBottom: 20,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "#0d1118",
  color: "#f3f4f6",
  border: "1px solid #384152",
  borderRadius: 8,
  padding: "11px 12px",
  fontSize: 14,
};

const buttonStyle: React.CSSProperties = {
  border: 0,
  borderRadius: 8,
  padding: "10px 14px",
  background: "#3977f6",
  color: "white",
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "#303847",
};

function newId() {
  return `yt_account_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

export default function YouTubeAccounts() {
  const [accounts, setAccounts] = useState<YouTubeAccount[]>([]);
  const [channelName, setChannelName] = useState("");
  const [channelId, setChannelId] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const db = await Database.load(DB_NAME);

      await db.execute(`
        CREATE TABLE IF NOT EXISTS youtube_accounts (
          id TEXT PRIMARY KEY NOT NULL,
          channel_name TEXT NOT NULL,
          channel_id TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      const rows = await db.select<YouTubeAccount[]>(
        `SELECT id, channel_name, channel_id, notes, enabled, created_at
         FROM youtube_accounts
         ORDER BY created_at DESC`
      );

      setAccounts(rows);
    } catch (e) {
      setError(
        `Could not load YouTube accounts. ${String(e)}`
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  async function addAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const name = channelName.trim();
    const id = channelId.trim();

    if (!name) {
      setError("Enter a channel name so you can identify this account.");
      return;
    }

    setSaving(true);

    try {
      const db = await Database.load(DB_NAME);
      const now = new Date().toISOString();

      await db.execute(
        `INSERT INTO youtube_accounts
          (id, channel_name, channel_id, notes, enabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, $5, $5)`,
        [newId(), name, id, notes.trim(), now]
      );

      setChannelName("");
      setChannelId("");
      setNotes("");
      setMessage(
        "Channel entry saved. This records the channel in Content Studio; it does not sign in or switch Chrome accounts."
      );

      await loadAccounts();
    } catch (e) {
      setError(`Could not save this channel. ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function toggleAccount(account: YouTubeAccount) {
    setError("");
    setMessage("");

    try {
      const db = await Database.load(DB_NAME);

      await db.execute(
        `UPDATE youtube_accounts
         SET enabled = $1, updated_at = $2
         WHERE id = $3`,
        [account.enabled ? 0 : 1, new Date().toISOString(), account.id]
      );

      await loadAccounts();
    } catch (e) {
      setError(`Could not update this channel. ${String(e)}`);
    }
  }

  async function deleteAccount(account: YouTubeAccount) {
    const confirmed = window.confirm(
      `Remove "${account.channel_name}" from Content Studio? Existing queue entries will remain, but this channel will no longer be available for new assignments.`
    );

    if (!confirmed) return;

    setError("");
    setMessage("");

    try {
      const db = await Database.load(DB_NAME);

      await db.execute(
        "DELETE FROM youtube_accounts WHERE id = $1",
        [account.id]
      );

      setMessage("Channel entry removed.");
      await loadAccounts();
    } catch (e) {
      setError(`Could not remove this channel. ${String(e)}`);
    }
  }

  return (
    <div style={pageStyle}>
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            color: "#8dafff",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 2,
            marginBottom: 8,
          }}
        >
          PUBLISHING
        </div>
        <h1 style={{ fontSize: 30, margin: "0 0 8px" }}>
          YouTube Accounts
        </h1>
        <p style={{ color: "#a8b0bf", margin: 0, lineHeight: 1.6 }}>
          Keep track of the YouTube channels you want to publish Shorts to.
        </p>
      </div>

      <div
        style={{
          ...panelStyle,
          borderColor: "#66552a",
          background: "#201c13",
        }}
      >
        <strong style={{ color: "#f8d88a" }}>
          Chrome session reminder
        </strong>
        <p style={{ color: "#d7c9a8", lineHeight: 1.6, marginBottom: 0 }}>
          Adding a channel here does not sign in to Google or switch the
          active YouTube Studio channel. Browser automation must use the
          channel currently signed in to your existing Chrome session, and
          the selected channel must be verified before an upload is scheduled.
        </p>
      </div>

      <section style={panelStyle}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Add a channel</h2>

        <form onSubmit={addAccount}>
          <label
            style={{
              display: "block",
              fontSize: 13,
              marginBottom: 6,
              color: "#cbd2df",
            }}
          >
            Channel name *
          </label>
          <input
            style={{ ...inputStyle, marginBottom: 14 }}
            value={channelName}
            onChange={(e) => setChannelName(e.target.value)}
            placeholder="e.g. GenZoomOfficial"
            required
          />

          <label
            style={{
              display: "block",
              fontSize: 13,
              marginBottom: 6,
              color: "#cbd2df",
            }}
          >
            YouTube channel ID (optional)
          </label>
          <input
            style={{ ...inputStyle, marginBottom: 14 }}
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            placeholder="e.g. UC..."
          />

          <label
            style={{
              display: "block",
              fontSize: 13,
              marginBottom: 6,
              color: "#cbd2df",
            }}
          >
            Notes (optional)
          </label>
          <input
            style={{ ...inputStyle, marginBottom: 16 }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="A reminder to identify this channel"
          />

          <button style={buttonStyle} disabled={saving} type="submit">
            {saving ? "Saving..." : "＋ Add Channel"}
          </button>
        </form>
      </section>

      {error && (
        <div
          role="alert"
          style={{
            ...panelStyle,
            color: "#ffb4b4",
            borderColor: "#773a43",
          }}
        >
          {error}
        </div>
      )}

      {message && (
        <div
          role="status"
          style={{
            ...panelStyle,
            color: "#b8f3d0",
            borderColor: "#285b43",
          }}
        >
          {message}
        </div>
      )}

      <section style={panelStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18 }}>
            Saved channels ({accounts.length})
          </h2>
          <button
            style={secondaryButtonStyle}
            onClick={() => void loadAccounts()}
            type="button"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <p style={{ color: "#a8b0bf" }}>Loading channels...</p>
        ) : accounts.length === 0 ? (
          <p style={{ color: "#a8b0bf", lineHeight: 1.6 }}>
            No channels saved yet. Add the channel you are currently signed
            in to first.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {accounts.map((account) => (
              <div
                key={account.id}
                style={{
                  border: "1px solid #303847",
                  borderRadius: 10,
                  padding: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  flexWrap: "wrap",
                  opacity: account.enabled ? 1 : 0.65,
                }}
              >
                <div style={{ minWidth: 220, flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <strong>{account.channel_name}</strong>
                    <span
                      style={{
                        fontSize: 11,
                        borderRadius: 99,
                        padding: "4px 8px",
                        background: account.enabled
                          ? "#183b2b"
                          : "#353b46",
                        color: account.enabled ? "#a9f1c7" : "#c4cad4",
                      }}
                    >
                      {account.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <div
                    style={{
                      color: "#9da7b8",
                      fontSize: 12,
                      marginTop: 7,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {account.channel_id || "No channel ID saved"}
                  </div>
                  {account.notes && (
                    <div
                      style={{
                        color: "#c0c7d3",
                        fontSize: 13,
                        marginTop: 7,
                      }}
                    >
                      {account.notes}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    style={secondaryButtonStyle}
                    type="button"
                    onClick={() => void toggleAccount(account)}
                  >
                    {account.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    style={{
                      ...secondaryButtonStyle,
                      color: "#ffb4b4",
                    }}
                    type="button"
                    onClick={() => void deleteAccount(account)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
