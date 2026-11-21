// One-off: copy the Standup Studio LA contact list from HighLevel into studio.people.
// POST ?dry=1 reports what would happen without writing. POST with no query does the import.
// Returns counts only, never contact details. Secret: STUDIO_HIGHLEVEL_TOKEN (private integration, contacts read).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const LOCATION = "AVRYAZcIfG3kfN5Ny5Pg"; // Standup Studio LA sub-account
const title = (s: string | null | undefined) => (s ?? "").trim().replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, authorization" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const out = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 1), { status, headers: { ...cors, "Content-Type": "application/json" } });
  const token = (Deno.env.get("STUDIO_HIGHLEVEL_TOKEN") ?? "").trim();
  if (!token) return out({ error: "STUDIO_HIGHLEVEL_TOKEN is not set." }, 503);
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  // 1. Pull every contact from HighLevel, 100 at a time.
  // deno-lint-ignore no-explicit-any
  const contacts: any[] = [];
  let searchAfter: unknown[] | undefined; let total = 0;
  for (let page = 0; page < 100; page++) {
    const res = await fetch("https://services.leadconnectorhq.com/contacts/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ locationId: LOCATION, pageLimit: 100, sort: [{ field: "dateAdded", direction: "asc" }], ...(searchAfter ? { searchAfter } : {}) }),
    });
    if (!res.ok) return out({ error: `HighLevel said ${res.status}`, detail: (await res.text()).slice(0, 300), fetchedSoFar: contacts.length }, 502);
    const data = await res.json();
    total = data.total ?? total;
    const batch = data.contacts ?? [];
    contacts.push(...batch);
    if (batch.length < 100) break;
    searchAfter = batch[batch.length - 1].searchAfter;
    if (!searchAfter) break;
  }

  // 2. Turn them into people rows. One row per email address; no email, no row.
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "studio" } });
  const { data: existing, error: exErr } = await db.from("people").select("email");
  if (exErr) return out({ error: exErr.message }, 500);
  const seen = new Set((existing ?? []).map((p) => p.email.toLowerCase()));
  const stats = { highlevelTotal: total, fetched: contacts.length, noEmail: 0, invalidEmail: 0, duplicateInHighLevel: 0, alreadyInDatabase: 0, toImport: 0, subscribed: 0, unsubscribed: 0, bounced: 0 };
  const rows: Record<string, unknown>[] = [];
  const batchSeen = new Set<string>();
  for (const c of contacts) {
    const email = String(c.email ?? "").trim().toLowerCase();
    if (!email) { stats.noEmail++; continue; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { stats.invalidEmail++; continue; }
    if (batchSeen.has(email)) { stats.duplicateInHighLevel++; continue; }
    batchSeen.add(email);
    if (seen.has(email)) { stats.alreadyInDatabase++; continue; }
    // Keep HighLevel's opt-outs: do-not-disturb (overall or for email) stays unsubscribed, bad addresses stay bounced.
    const emailDnd = c.dnd === true || c.dndSettings?.Email?.status === "active" || c.dndSettings?.email?.status === "active";
    const status = emailDnd ? "unsubscribed" : c.validEmail === false ? "bounced" : "subscribed";
    stats[status]++;
    const note = ["Imported from HighLevel", c.source ? `source: ${c.source}` : "", c.tags?.length ? `tags: ${c.tags.join(", ")}` : ""].filter(Boolean).join("; ");
    rows.push({
      email,
      first_name: title(c.firstName ?? c.firstNameLowerCase) || null,
      last_name: title(c.lastName ?? c.lastNameLowerCase) || null,
      phone: c.phone ?? null,
      email_status: status,
      notes: note,
      created_at: c.dateAdded ?? undefined,
    });
  }
  stats.toImport = rows.length;
  if (dry) return out({ dryRun: true, ...stats });

  // 3. Write in chunks.
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("people").insert(rows.slice(i, i + 500));
    if (error) return out({ error: error.message, insertedBeforeError: inserted, ...stats }, 500);
    inserted += Math.min(500, rows.length - i);
  }
  return out({ dryRun: false, inserted, ...stats });
});
