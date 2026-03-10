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
  public: boolean;
  updated_at: string;
}


// Page Analytics
export interface PageAnalytics {
  slug: string;
  total_views: number;
  unique_visitors_30d: number;
  last_viewed_at?: string;
  top_referrers?: { source: string; count: number }[];
}

export function getPageAnalytics(): Promise<PageAnalytics[]> {
  return request("/api/page-analytics");
}

export interface PageDetailedAnalytics {
  slug: string;
  total_views: number;
  unique_visitors_30d: number;
  last_viewed_at?: string;
  daily_views: { date: string; views: number; unique_views: number }[];
  top_referrers: { source: string; count: number }[];
}

export function getPageDetailedAnalytics(slug: string): Promise<PageDetailedAnalytics> {
  return request(`/api/page-analytics/${encodeURIComponent(slug)}`);
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
  expiresInDays: number = 3650
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
  id: string;
  name: string;
  paired_at: string;
  is_online: boolean;
  x25519_public?: string; // base64url-encoded X25519 public key
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

export function deleteAgent(id: string): Promise<void> {
  return request(`/api/agents/${id}`, { method: "DELETE" });
}


export async function logout(): Promise<void> {
  await request("/api/logout", { method: "POST" });
  setLoggedIn(false);
}

// Custom Domains
export interface CustomDomain {
  id: number;
  domain: string;
  verified: boolean;
  verification_token: string;
  tls_provisioned: boolean;
  default_slug: string;
  created_at: string;
  verified_at?: string;
}

export interface AddDomainResponse {
  domain: CustomDomain;
  instructions: {
    cname: string;
    txt: string;
    detail: string;
  };
}

export function listCustomDomains(): Promise<CustomDomain[]> {
  return request("/api/custom-domains");
}

export function addCustomDomain(domain: string): Promise<AddDomainResponse> {
  return request("/api/custom-domains", {
    method: "POST",
    body: JSON.stringify({ domain }),
  });
}

export function verifyCustomDomain(id: number): Promise<{ status: string; error?: string; expected?: string }> {
  return request(`/api/custom-domains/${id}/verify`, { method: "POST" });
}

export function updateCustomDomain(id: number, defaultSlug: string): Promise<void> {
  return request(`/api/custom-domains/${id}`, {
    method: "PUT",
    body: JSON.stringify({ default_slug: defaultSlug }),
  });
}

export function deleteCustomDomain(id: number): Promise<void> {
  return request(`/api/custom-domains/${id}`, { method: "DELETE" });
}
