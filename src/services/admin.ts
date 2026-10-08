import { API_BASE_URL } from "../config";
import {
  getAuthToken,
  type User,
  type UserPlan,
  type UserRole,
  type UserStatus,
} from "./auth";

export interface Usage {
  user_id: string;
  render_count: number;
  project_count: number;
  storage_bytes: number;
  download_count: number;
  ai_generation_count: number;
  updated_at: string;
}

export interface Activity {
  id: string;
  user_id: string | null;
  event_type: string;
  description: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AdminUserUpdate {
  display_name?: string;
  role?: UserRole;
  status?: UserStatus;
  plan?: UserPlan;
}

async function adminRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAuthToken();

  if (!token) {
    throw new Error("You are not logged in.");
  }

  const headers = new Headers(options.headers);

  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(
    `${API_BASE_URL}${path}`,
    {
      ...options,
      headers,
    },
  );

  const contentType =
    response.headers.get("content-type") ?? "";

  let body: unknown = null;

  if (contentType.includes("application/json")) {
    body = await response.json();
  } else {
    body = await response.text();
  }

  if (!response.ok) {
    let message =
      `Request failed with status ${response.status}.`;

    if (
      body &&
      typeof body === "object" &&
      "message" in body &&
      typeof body.message === "string"
    ) {
      message = body.message;
    } else if (
      typeof body === "string" &&
      body.trim()
    ) {
      message = body;
    }

    throw new Error(message);
  }

  return body as T;
}

export async function getAdminUsers(): Promise<User[]> {
  return adminRequest<User[]>(
    "/api/admin/users",
  );
}

export async function getAdminUser(
  userId: string,
): Promise<User> {
  return adminRequest<User>(
    `/api/admin/users/${userId}`,
  );
}

export async function updateAdminUser(
  userId: string,
  updates: AdminUserUpdate,
): Promise<User> {
  return adminRequest<User>(
    `/api/admin/users/${userId}`,
    {
      method: "PUT",
      body: JSON.stringify(updates),
    },
  );
}

export async function deleteAdminUser(
  userId: string,
): Promise<void> {
  await adminRequest(
    `/api/admin/users/${userId}`,
    {
      method: "DELETE",
    },
  );
}

export async function getAdminUsage(): Promise<
  Usage[]
> {
  return adminRequest<Usage[]>(
    "/api/admin/usage",
  );
}

export async function getUserUsage(
  userId: string,
): Promise<Usage> {
  return adminRequest<Usage>(
    `/api/usage?user_id=${encodeURIComponent(userId)}`,
  );
}

export async function updateUserUsage(
  userId: string,
  usage: Partial<
    Omit<Usage, "user_id" | "updated_at">
  >,
): Promise<Usage> {
  return adminRequest<Usage>(
    `/api/admin/usage/${userId}`,
    {
      method: "PUT",
      body: JSON.stringify(usage),
    },
  );
}

export async function getAdminActivity(): Promise<
  Activity[]
> {
  return adminRequest<Activity[]>(
    "/api/admin/activity",
  );
}
