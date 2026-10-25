import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function jsonResponse(body: Record<string, string>, status: number) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  let credentials: unknown;
  try {
    credentials = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid username or password." }, 400);
  }

  if (!credentials || typeof credentials !== "object") {
    return jsonResponse({ error: "Invalid username or password." }, 400);
  }
  const input = credentials as { username?: unknown; password?: unknown };
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!username || username.length > 32 || !password || password.length > 1024) {
    return jsonResponse({ error: "Invalid username or password." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Username login is missing Supabase function environment variables.");
    return jsonResponse({ error: "Username sign-in is temporarily unavailable." }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: email, error: lookupError } = await admin.rpc(
    "rv_lookup_auth_email_for_username",
    { p_username: username },
  );
  if (lookupError) {
    console.error("Username lookup failed.", lookupError);
    return jsonResponse({ error: "Username sign-in is temporarily unavailable." }, 500);
  }
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await authClient.auth.signInWithPassword({
    email: email ?? "unknown-username@invalid.local",
    password,
  });
  if (error || !data.session) {
    return jsonResponse({ error: "Invalid username or password." }, 401);
  }

  return jsonResponse({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  }, 200);
});
