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
    const { token, action, ...payload } = body;

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

    // ── Clear all ──
    if (action === "clear_all") {
      const { data: active } = await supabase
        .from("updates")
        .select("id")
        .eq("is_deleted", false);

      const count = active?.length ?? 0;
      await supabase.from("updates").update({ is_deleted: true }).eq("is_deleted", false);
      await supabase.from("audit_log").insert({
        admin_id: adminId,
        course_key: "All courses",
        update_type: "cancellation",
        prev_state: `${count} active updates`,
        new_state: "All updates cleared",
        reason: "Admin cleared all updates",
      });
      return Response.json({ ok: true }, { headers: CORS });
    }

    // ── Publish update ──
    const {
      courseKey, updateType, effectiveMode,
      startDate, endDate,
      newVenue, newStartTime, newEndTime,
      reason, prevState, newState,
      eventId, date, classCode
    } = payload;

    if (!updateType) {
      return Response.json({ error: `Missing updateType. Got: ${updateType}` }, { status: 400, headers: CORS });
    }
    if (!["cancellation", "venue_change", "time_change", "bulk_add"].includes(updateType)) {
      return Response.json({ error: "Invalid update type" }, { status: 400, headers: CORS });
    }

    // For bulk_add, date is required instead of startDate/endDate
    if (updateType === "bulk_add") {
      if (!courseKey || !date || !classCode) {
        return Response.json({ error: `bulk_add requires courseKey, date, classCode. Got: courseKey=${courseKey}, date=${date}, classCode=${classCode}` }, { status: 400, headers: CORS });
      }
    } else {
      if (!courseKey || !startDate || !endDate) {
        return Response.json({ error: `Missing required fields. courseKey=${courseKey}, startDate=${startDate}, endDate=${endDate}` }, { status: 400, headers: CORS });
      }
    }
    if (updateType !== "bulk_add" && endDate < startDate) {
      return Response.json({ error: "endDate before startDate" }, { status: 400, headers: CORS });
    }

    const { data: updateRow, error: insertErr } = await supabase
      .from("updates")
      .insert({
        course_key: courseKey,
        update_type: updateType,
        effective_mode: effectiveMode ?? (updateType === "bulk_add" ? "single" : "single"),
        start_date: updateType === "bulk_add" ? date : startDate,
        end_date: updateType === "bulk_add" ? date : endDate,
        new_venue: newVenue ?? null,
        new_start_time: updateType === "bulk_add" ? payload.startTime : (newStartTime ?? null),
        new_end_time: updateType === "bulk_add" ? payload.endTime : (newEndTime ?? null),
        reason: reason ?? null,
        admin_id: adminId,
        event_id: eventId ?? null,
        class_code: classCode ?? null,
      })
      .select()
      .single();

    if (insertErr) {
      return Response.json({ error: "Failed to save update" }, { status: 500, headers: CORS });
    }

    await supabase.from("audit_log").insert({
      admin_id: adminId,
      course_key: courseKey,
      update_type: updateType,
      start_date: updateType === "bulk_add" ? date : startDate,
      end_date: updateType === "bulk_add" ? date : endDate,
      prev_state: prevState ?? "",
      new_state: newState ?? "",
      reason: reason ?? null,
    });

    return Response.json({ ok: true, update: updateRow }, { headers: CORS });
  } catch (_) {
    return Response.json({ error: "Server error" }, { status: 500, headers: CORS });
  }
});


