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
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const {
    data: { session },
  } = await supabase().auth.getSession();
  const response = await fetch(`/api${path}`, {
    headers: {
      Authorization: `Bearer ${session?.access_token || ""}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.location.assign("/login");
    throw new Error(result.error || "Request failed.");
  }
  return result;
}
