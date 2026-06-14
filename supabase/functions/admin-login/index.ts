import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { passcode } = await req.json();
    if (!passcode || typeof passcode !== "string") {
      return Response.json({ error: "Passcode required" }, { status: 400, headers: CORS });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // verify_admin is a SQL function (see README for setup SQL)
    const { data, error } = await supabase.rpc("verify_admin", { input_passcode: passcode });
    if (error || !data || data.length === 0) {
      return Response.json({ error: "Invalid passcode" }, { status: 401, headers: CORS });
    }

    const adminId: string = data[0].admin_id;
    const rawToken = crypto.randomUUID() + "-" + crypto.randomUUID();
    const tokenHash = await hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

    const { error: sessErr } = await supabase
      .from("admin_sessions")
      .insert({ token_hash: tokenHash, admin_id: adminId, expires_at: expiresAt });

    if (sessErr) {
      return Response.json({ error: "Session creation failed" }, { status: 500, headers: CORS });
    }

    return Response.json({ adminId, token: rawToken }, { headers: CORS });
  } catch (_) {
    return Response.json({ error: "Server error" }, { status: 500, headers: CORS });
  }
});


