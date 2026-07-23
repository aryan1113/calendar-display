import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // Uses the anon key — reads are public, RLS policies allow SELECT to all
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { persistSession: false } },
    );

    const [updatesRes, auditRes, alertsRes] = await Promise.all([
      supabase
        .from("updates")
        .select("*")
        .eq("is_deleted", false)
        .order("created_at", { ascending: false }),
      supabase
        .from("audit_log")
        .select("*")
        .order("action_ts", { ascending: false })
        .limit(200),
      supabase
        .from("class_alerts")
        .select("*")
        .eq("is_deleted", false)
        .order("event_date", { ascending: true }),
    ]);

    return Response.json(
      { updates: updatesRes.data ?? [], auditLog: auditRes.data ?? [], classAlerts: alertsRes.data ?? [] },
      { headers: CORS },
    );
  } catch (_) {
    return Response.json({ error: "Server error" }, { status: 500, headers: CORS });
  }
});


