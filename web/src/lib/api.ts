const API_BASE = "";

function getToken(): string | null {
  return localStorage.getItem("yb_session");
}

export function setToken(token: string) {
  localStorage.setItem("yb_session", token);
}

export function clearToken() {
  localStorage.removeItem("yb_session");
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }

  return res.json();
}

// User
export interface User {
  id: number;
  email: string;
  username: string;
}

export function getMe(): Promise<User> {
  return request("/api/me");
}

// Pages
export interface Page {
  id: number;
  slug: string;
  title: string;
  html_content?: string;
  created_at: string;
  updated_at: string;
}

export function listPages(): Promise<Page[]> {
  return request("/api/pages");
}

export function getPage(id: number): Promise<Page> {
  return request(`/api/pages/${id}`);
}

export function deletePage(id: number): Promise<void> {
  return request(`/api/pages/${id}`, { method: "DELETE" });
}

// Tokens
export interface Token {
  id: number;
  name: string;
  scopes: string[];
  expires_at: string;
  created_at: string;
}

export interface CreateTokenResponse {
  token: string;
  name: string;
  id: number;
}

export function listTokens(): Promise<Token[]> {
  return request("/api/tokens");
}

export function createToken(
  name: string,
  scopes: string[],
  expiresInDays: number = 90
): Promise<CreateTokenResponse> {
  return request("/api/tokens", {
    method: "POST",
    body: JSON.stringify({ name, scopes, expires_in_days: expiresInDays }),
  });
}

export function deleteToken(id: number): Promise<void> {
  return request(`/api/tokens/${id}`, { method: "DELETE" });
}
