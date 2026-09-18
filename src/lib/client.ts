"use client";
import { createClient } from "@supabase/supabase-js";
let client: ReturnType<typeof createClient> | undefined;
export function supabase() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
      key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key)
      throw new Error(
        "Supabase is not configured. Set the public variables in .env.local.",
      );
    client = createClient(url, key);
  }
  return client;
}
export function demoToken() {
  return typeof window === "undefined"
    ? null
    : sessionStorage.getItem("fop-demo-token");
}
export async function hasSession() {
  return !!demoToken() || !!(await supabase().auth.getSession()).data.session;
}
export async function signIn(email: string, password: string) {
  if (email.trim().toLowerCase() === "demo@fop.local") {
    const response = await fetch("/api/demo/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Demo sign-in failed.");
    sessionStorage.setItem("fop-demo-token", result.token);
    return;
  }
  const { error } = await supabase().auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  sessionStorage.removeItem("fop-demo-token");
}
export async function signOut() {
  const token = demoToken();
  if (token) {
    try {
      await fetch("/api/demo/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } finally {
      sessionStorage.removeItem("fop-demo-token");
    }
  } else await supabase().auth.signOut();
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const token =
    demoToken() ||
    (await supabase().auth.getSession()).data.session?.access_token;
  const response = await fetch(`/api${path}`, {
    headers: {
      Authorization: `Bearer ${token || ""}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      sessionStorage.removeItem("fop-demo-token");
      window.location.assign("/login");
    }
    throw new Error(result.error || "Request failed.");
  }
  return result;
}
