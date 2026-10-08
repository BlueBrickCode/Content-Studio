import { useEffect, useMemo, useState } from "react";

import type {
  User,
  UserPlan,
  UserRole,
  UserStatus,
} from "../services/auth";

import {
  deleteAdminUser,
  getAdminActivity,
  getAdminUsers,
  updateAdminUser,
  type Activity,
} from "../services/admin";

interface AdminProps {
  currentUser: User;
}

type AdminTab =
  | "Overview"
  | "Users"
  | "Activity";

function Admin({ currentUser }: AdminProps) {
  const [activeTab, setActiveTab] =
    useState<AdminTab>("Overview");

  const [users, setUsers] = useState<User[]>([]);
  const [activity, setActivity] =
    useState<Activity[]>([]);

  const [selectedUser, setSelectedUser] =
    useState<User | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadData = async () => {
    setLoading(true);
    setError("");

    try {
      const [userList, activityList] =
        await Promise.all([
          getAdminUsers(),
          getAdminActivity(),
        ]);

      setUsers(userList);
      setActivity(activityList);

      if (selectedUser) {
        const refreshed =
          userList.find(
            (user) =>
              user.id === selectedUser.id,
          );

        setSelectedUser(refreshed ?? null);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load admin data.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const activeUsers = useMemo(
    () =>
      users.filter(
        (user) => user.status === "active",
      ).length,
    [users],
  );

  const suspendedUsers = useMemo(
    () =>
      users.filter(
        (user) =>
          user.status === "suspended",
      ).length,
    [users],
  );

  const adminUsers = useMemo(
    () =>
      users.filter(
        (user) => user.role === "admin",
      ).length,
    [users],
  );

  const handleUpdateUser = async (
    userId: string,
    updates: {
      display_name?: string;
      role?: UserRole;
      status?: UserStatus;
      plan?: UserPlan;
    },
  ) => {
    setSaving(true);
    setError("");

    try {
      const updated =
        await updateAdminUser(
          userId,
          updates,
        );

      setUsers((current) =>
        current.map((user) =>
          user.id === updated.id
            ? updated
            : user,
        ),
      );

      setSelectedUser(updated);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to update user.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = async (
    user: User,
  ) => {
    if (user.id === currentUser.id) {
      setError(
        "You cannot delete your own administrator account.",
      );

      return;
    }

    const confirmed = window.confirm(
      `Delete ${user.email}? This permanently removes their account and account data.`,
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      await deleteAdminUser(user.id);

      setUsers((current) =>
        current.filter(
          (item) => item.id !== user.id,
        ),
      );

      setSelectedUser(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to delete user.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (currentUser.role !== "admin") {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <p className="eyebrow">
              ADMINISTRATION
            </p>

            <h1>Access denied</h1>

            <p className="page-description">
              Administrator permissions are required
              to access this area.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="eyebrow">
            ADMINISTRATION
          </p>

          <h1>Admin Dashboard</h1>

          <p className="page-description">
            Manage Content Studio accounts,
            subscriptions, access, and activity.
          </p>
        </div>

        <button
          className="secondary-button"
          onClick={loadData}
          disabled={loading || saving}
        >
          {loading
            ? "Refreshing..."
            : "Refresh"}
        </button>
      </div>

      {error && (
        <div
          className="message error"
          style={{ marginBottom: 18 }}
        >
          {error}
        </div>
      )}

      <div className="toolbar">
        <div className="toolbar-actions">
          {(
            [
              "Overview",
              "Users",
              "Activity",
            ] as AdminTab[]
          ).map((tab) => (
            <button
              key={tab}
              className={
                activeTab === tab
                  ? "primary-button"
                  : "secondary-button"
              }
              onClick={() =>
                setActiveTab(tab)
              }
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "Overview" && (
        <section className="section">
          <div className="stats">
            <div className="stat-card">
              <span>Total Users</span>

              <strong>{users.length}</strong>

              <small>
                Registered Content Studio accounts
              </small>
            </div>

            <div className="stat-card">
              <span>Active Users</span>

              <strong>{activeUsers}</strong>

              <small>
                Accounts currently active
              </small>
            </div>

            <div className="stat-card">
              <span>Suspended</span>

              <strong>
                {suspendedUsers}
              </strong>

              <small>
                Accounts currently restricted
              </small>
            </div>

            <div className="stat-card">
              <span>Administrators</span>

              <strong>{adminUsers}</strong>

              <small>
                Accounts with admin access
              </small>
            </div>
          </div>

          <div
            className="feature-grid"
            style={{ marginTop: 18 }}
          >
            <div className="feature-card">
              <div className="feature-icon">
                01
              </div>

              <h4>Users</h4>

              <p>
                View and manage every Content
                Studio account.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                02
              </div>

              <h4>Access Control</h4>

              <p>
                Change account status, plans,
                and administrator privileges.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                03
              </div>

              <h4>Activity</h4>

              <p>
                Review account events and
                administrative activity.
              </p>
            </div>
          </div>
        </section>
      )}

      {activeTab === "Users" && (
        <section className="section">
          <div className="split-layout">
            <div className="stack">
              <div className="feature-card">
                <h3>Users</h3>

                <p
                  className="muted"
                  style={{ marginBottom: 18 }}
                >
                  Select an account to manage
                  its access and subscription.
                </p>

                {loading ? (
                  <div className="empty-state">
                    Loading users...
                  </div>
                ) : users.length === 0 ? (
                  <div className="empty-state">
                    No users found.
                  </div>
                ) : (
                  <div className="table">
                    {users.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() =>
                          setSelectedUser(
                            user,
                          )
                        }
                        style={{
                          width: "100%",
                          display: "grid",
                          gridTemplateColumns:
                            "minmax(0, 1fr) auto auto",
                          gap: 12,
                          alignItems: "center",
                          padding:
                            "14px 12px",
                          border: 0,
                          borderBottom:
                            "1px solid var(--border)",
                          background:
                            selectedUser?.id ===
                            user.id
                              ? "rgba(255,255,255,0.055)"
                              : "transparent",
                          color: "inherit",
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        <div
                          style={{
                            minWidth: 0,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              overflow:
                                "hidden",
                              textOverflow:
                                "ellipsis",
                              whiteSpace:
                                "nowrap",
                            }}
                          >
                            {user.display_name ||
                              "Unnamed User"}
                          </div>

                          <div
                            style={{
                              marginTop: 4,
                              color:
                                "var(--muted)",
                              fontSize: 11,
                              overflow:
                                "hidden",
                              textOverflow:
                                "ellipsis",
                              whiteSpace:
                                "nowrap",
                            }}
                          >
                            {user.email}
                          </div>
                        </div>

                        <span
                          style={{
                            fontSize: 10,
                            color:
                              user.status ===
                              "active"
                                ? "#b9c8bb"
                                : "#ff9d9d",
                          }}
                        >
                          {user.status}
                        </span>

                        <span
                          style={{
                            fontSize: 10,
                            color:
                              "var(--muted)",
                          }}
                        >
                          {user.plan}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="stack">
              <div className="feature-card sticky">
                {!selectedUser ? (
                  <>
                    <h3>
                      Select a user
                    </h3>

                    <p className="muted">
                      Choose an account from
                      the list to manage it.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="eyebrow">
                      USER MANAGEMENT
                    </p>

                    <h3
                      style={{
                        marginTop: 6,
                      }}
                    >
                      {selectedUser.display_name ||
                        "Unnamed User"}
                    </h3>

                    <p className="muted">
                      {selectedUser.email}
                    </p>

                    <div
                      className="stack"
                      style={{
                        marginTop: 20,
                      }}
                    >
                      <label className="field">
                        <span className="field-label">
                          Role
                        </span>

                        <select
                          className="select-input"
                          value={
                            selectedUser.role
                          }
                          disabled={
                            saving ||
                            selectedUser.id ===
                              currentUser.id
                          }
                          onChange={(event) =>
                            handleUpdateUser(
                              selectedUser.id,
                              {
                                role: event
                                  .target
                                  .value as UserRole,
                              },
                            )
                          }
                        >
                          <option value="user">
                            User
                          </option>

                          <option value="admin">
                            Administrator
                          </option>
                        </select>
                      </label>

                      <label className="field">
                        <span className="field-label">
                          Plan
                        </span>

                        <select
                          className="select-input"
                          value={
                            selectedUser.plan
                          }
                          disabled={saving}
                          onChange={(event) =>
                            handleUpdateUser(
                              selectedUser.id,
                              {
                                plan: event
                                  .target
                                  .value as UserPlan,
                              },
                            )
                          }
                        >
                          <option value="free">
                            Free
                          </option>

                          <option value="pro">
                            Pro
                          </option>

                          <option value="creator">
                            Creator
                          </option>

                          <option value="business">
                            Business
                          </option>

                          <option value="enterprise">
                            Enterprise
                          </option>
                        </select>
                      </label>

                      <label className="field">
                        <span className="field-label">
                          Status
                        </span>

                        <select
                          className="select-input"
                          value={
                            selectedUser.status
                          }
                          disabled={
                            saving ||
                            selectedUser.id ===
                              currentUser.id
                          }
                          onChange={(event) =>
                            handleUpdateUser(
                              selectedUser.id,
                              {
                                status: event
                                  .target
                                  .value as UserStatus,
                              },
                            )
                          }
                        >
                          <option value="active">
                            Active
                          </option>

                          <option value="suspended">
                            Suspended
                          </option>
                        </select>
                      </label>

                      <div className="message">
                        Created{" "}
                        {new Date(
                          selectedUser.created_at,
                        ).toLocaleString()}
                      </div>

                      <div className="message">
                        Last active:{" "}
                        {selectedUser.last_active_at
                          ? new Date(
                              selectedUser.last_active_at,
                            ).toLocaleString()
                          : "Never"}
                      </div>

                      {selectedUser.id !==
                        currentUser.id && (
                        <button
                          className="danger-button"
                          type="button"
                          disabled={saving}
                          onClick={() =>
                            handleDeleteUser(
                              selectedUser,
                            )
                          }
                        >
                          Delete Account
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === "Activity" && (
        <section className="section">
          <div className="feature-card">
            <h3>Recent Activity</h3>

            <p
              className="muted"
              style={{
                marginBottom: 18,
              }}
            >
              Account and system activity
              recorded by the backend.
            </p>

            {loading ? (
              <div className="empty-state">
                Loading activity...
              </div>
            ) : activity.length === 0 ? (
              <div className="empty-state">
                No activity has been recorded yet.
              </div>
            ) : (
              <div className="table">
                {activity.map((event) => (
                  <div
                    key={event.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "150px 140px minmax(0, 1fr)",
                      gap: 12,
                      alignItems: "start",
                      padding: "13px 12px",
                      borderBottom:
                        "1px solid var(--border)",
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        color:
                          "var(--muted)",
                      }}
                    >
                      {new Date(
                        event.created_at,
                      ).toLocaleString()}
                    </span>

                    <span
                      style={{
                        fontWeight: 700,
                      }}
                    >
                      {event.event_type}
                    </span>

                    <span
                      style={{
                        color:
                          "var(--muted)",
                      }}
                    >
                      {event.description}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export default Admin;
