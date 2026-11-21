// Stand Up Studio LA: newsletter signup. Adds the person to studio.people as subscribed.
// POST { "email": "...", "first_name": "..." }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SITES = [
  "https://standupstudiola.chris-oconnor.workers.dev",
  "https://standupstudiola.com",
  "https://www.standupstudiola.com",
];
const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && SITES.includes(origin) ? origin : SITES[0],
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* handled below */ }
  // "website" is a hidden field real people never fill in; bots do. Pretend it worked.
  if (body.website) return json({ ok: true }, 200, origin);

  const email = String(body.email ?? "").trim().toLowerCase();
  const first = String(body.first_name ?? "").trim().slice(0, 80);
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "Please enter a valid email address." }, 400, origin);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "studio" } });
  const { data: existing, error: findErr } = await db.from("people").select("id").ilike("email", email.replace(/[%_\\]/g, "\\$&")).maybeSingle();
  if (findErr) { console.error(findErr); return json({ error: "Something went wrong. Please try again." }, 500, origin); }

  // Already on the list: say yes without changing their record or their unsubscribe choice.
  if (!existing) {
    const { error } = await db.from("people").insert({ email, first_name: first || null, notes: "Signed up on the website" });
    if (error) { console.error(error); return json({ error: "Something went wrong. Please try again." }, 500, origin); }
  }
  return json({ ok: true }, 200, origin);
});
