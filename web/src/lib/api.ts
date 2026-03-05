export const API_BASE = import.meta.env.VITE_API_URL || "";

// Login state: httpOnly cookie holds the session, localStorage flag is for UI only
export function setLoggedIn(loggedIn: boolean) {
  if (loggedIn) {
    localStorage.setItem("yb_logged_in", "1");
  } else {
    localStorage.removeItem("yb_logged_in");
  }
}

export function isLoggedIn(): boolean {
  return localStorage.getItem("yb_logged_in") === "1";
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }

  if (res.status === 204) {
    return undefined as T;
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

// Pages (stored on agent, fetched via relay)
export interface Page {
  slug: string;
  title: string;
  updated_at: string;
}

/** Fetch page list from agent via relay. Returns empty array if agent is offline. */
export async function listPagesViaRelay(agentId: number): Promise<Page[]> {
  try {
    const res = await fetch(`${API_BASE}/api/relay/${agentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        id: crypto.randomUUID(),
        method: "GET",
        path: "/api/pages",
      }),
    });
    if (!res.ok) return [];
    const envelope = await res.json();
    if (envelope.status === 200 && envelope.body) {
      return JSON.parse(envelope.body) as Page[];
    }
    return [];
  } catch {
    return [];
  }
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

// Agents
export interface Agent {
  id: number;
  name: string;
  paired_at: string;
  is_online: boolean;
}

export function listAgents(): Promise<Agent[]> {
  return request("/api/agents");
}

export function registerAgent(name: string): Promise<Agent> {
  return request("/api/agents", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function deleteAgent(id: number): Promise<void> {
  return request(`/api/agents/${id}`, { method: "DELETE" });
}


export async function logout(): Promise<void> {
  await request("/api/logout", { method: "POST" });
  setLoggedIn(false);
}
