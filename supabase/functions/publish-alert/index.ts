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
    const body = await req.json();
    const { token, action } = body;

    if (!token || typeof token !== "string") {
      return Response.json({ error: "Missing token" }, { status: 401, headers: CORS });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const tokenHash = await hashToken(token);
    const { data: session, error: sessErr } = await supabase
      .from("admin_sessions")
      .select("admin_id, expires_at")
      .eq("token_hash", tokenHash)
      .single();

    if (sessErr || !session) {
      return Response.json({ error: "Invalid or expired session" }, { status: 401, headers: CORS });
    }
    if (new Date(session.expires_at) < new Date()) {
      return Response.json({ error: "Session expired" }, { status: 401, headers: CORS });
    }

    const adminId: string = session.admin_id;

    // ── Delete alert ──
    if (action === "delete") {
      const { id } = body;
      if (!id) {
        return Response.json({ error: "Missing id" }, { status: 400, headers: CORS });
      }
      const { error: deleteErr } = await supabase
        .from("class_alerts")
        .update({ is_deleted: true })
        .eq("id", id);

      if (deleteErr) {
        return Response.json({ error: "Failed to delete alert" }, { status: 500, headers: CORS });
      }
      return Response.json({ ok: true }, { headers: CORS });
    }

    // ── Publish alert ──
    const { title, alertType, courseKey, eventDate, eventTime, notes } = body;

    if (!title || !alertType || !eventDate) {
      return Response.json({ error: "title, alertType and eventDate are required" }, { status: 400, headers: CORS });
    }
    if (!["quiz", "simulation", "submission", "deadline", "other"].includes(alertType)) {
      return Response.json({ error: "Invalid alertType" }, { status: 400, headers: CORS });
    }

    const { data: alertRow, error: insertErr } = await supabase
      .from("class_alerts")
      .insert({
        title,
        alert_type: alertType,
        course_key: courseKey || null,
        event_date: eventDate,
        event_time: eventTime || null,
        notes: notes || null,
        admin_id: adminId,
      })
      .select()
      .single();

    if (insertErr) {
      return Response.json({ error: "Failed to save alert" }, { status: 500, headers: CORS });
    }

    return Response.json({ ok: true, alert: alertRow }, { headers: CORS });
  } catch (_) {
    return Response.json({ error: "Server error" }, { status: 500, headers: CORS });
  }
});
