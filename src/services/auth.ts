import { API_BASE_URL } from "../config";

export type UserRole = "admin" | "user";

export type UserStatus = "active" | "suspended";

export type UserPlan =
  | "free"
  | "pro"
  | "creator"
  | "business"
  | "enterprise";

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  status: UserStatus;
  plan: UserPlan;
  created_at: string;
  updated_at: string;
  last_active_at: string | null;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface RegisterResponse {
  token: string;
  user: User;
}

const TOKEN_KEY = "contentstudio_auth_token";
const USER_KEY = "contentstudio_auth_user";

function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function storeSession(token: string, user: User): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearStoredSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as User;
  } catch {
    clearStoredSession();
    return null;
  }
}

export function isLoggedIn(): boolean {
  return Boolean(getStoredToken());
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  authenticated = false,
): Promise<T> {
  const headers = new Headers(options.headers);

  headers.set("Content-Type", "application/json");

  if (authenticated) {
    const token = getStoredToken();

    if (!token) {
      throw new Error("You are not logged in.");
    }

    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const contentType = response.headers.get("content-type") ?? "";

  let body: unknown = null;

  if (contentType.includes("application/json")) {
    body = await response.json();
  } else {
    body = await response.text();
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}.`;

    if (
      body &&
      typeof body === "object" &&
      "message" in body &&
      typeof body.message === "string"
    ) {
      message = body.message;
    } else if (typeof body === "string" && body.trim()) {
      message = body;
    }

    throw new Error(message);
  }

  return body as T;
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const result = await apiRequest<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
    }),
  });

  storeSession(result.token, result.user);

  return result;
}

export async function register(
  email: string,
  password: string,
  displayName: string,
): Promise<RegisterResponse> {
  const result = await apiRequest<RegisterResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      display_name: displayName,
    }),
  });

  storeSession(result.token, result.user);

  return result;
}

export async function getCurrentUser(): Promise<User> {
  const user = await apiRequest<User>("/api/auth/me", {}, true);

  localStorage.setItem(USER_KEY, JSON.stringify(user));

  return user;
}

export async function logout(): Promise<void> {
  try {
    if (getStoredToken()) {
      await apiRequest("/api/auth/logout", {
        method: "POST",
      }, true);
    }
  } finally {
    clearStoredSession();
  }
}

export function getAuthToken(): string | null {
  return getStoredToken();
}

export function clearSession(): void {
  clearStoredSession();
}
