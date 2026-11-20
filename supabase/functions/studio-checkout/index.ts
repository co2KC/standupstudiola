// Stand Up Studio LA: start a Stripe Checkout for one product.
// POST { "slug": "december-2026" }  ->  { "url": "https://checkout.stripe.com/..." }
// Secrets (Supabase > Edge Functions > Secrets): STUDIO_STRIPE_SECRET_KEY
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

  const stripeKey = Deno.env.get("STUDIO_STRIPE_SECRET_KEY");
  if (!stripeKey) return json({ error: "Checkout is not set up yet." }, 503, origin);

  let slug = "";
  try { slug = String((await req.json()).slug ?? ""); } catch { /* handled below */ }
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return json({ error: "Unknown product." }, 400, origin);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "studio" } });
  const { data: product, error } = await db
    .from("products")
    .select("id, slug, name, kind, theme, price_cents, status, duration_minutes, payee:people!payee_person_id(first_name, last_name, public_email)")
    .eq("slug", slug)
    .maybeSingle();
  if (error) { console.error(error); return json({ error: "Could not look up that product." }, 500, origin); }
  if (!product || product.status !== "published" || !product.price_cents) return json({ error: "That isn't available right now." }, 404, origin);

  // Only products paid to the studio's own Stripe account are sold here.
  // Coaches with a public email are booked by email instead.
  const payee = product.payee as { first_name?: string; last_name?: string; public_email?: string | null } | null;
  if (!payee || payee.public_email) return json({ error: "Please email this coach to book." }, 400, origin);

  const title = product.kind === "class"
    ? `${product.theme ?? "Group class"} (${product.name})`
    : `Private lesson with ${payee.first_name} ${payee.last_name}, ${product.duration_minutes} minutes`;
  const site = origin && SITES.includes(origin) ? origin : SITES[0];

  const form = new URLSearchParams({
    "mode": "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(product.price_cents),
    "line_items[0][price_data][product_data][name]": `Standup Studio LA: ${title}`,
    "allow_promotion_codes": "true",
    "customer_creation": "always",
    "phone_number_collection[enabled]": "true",
    "metadata[site]": "standupstudiola",
    "metadata[product_id]": product.id,
    "metadata[product_slug]": product.slug,
    "payment_intent_data[metadata][site]": "standupstudiola",
    "payment_intent_data[metadata][product_slug]": product.slug,
    "success_url": `${site}/thanks.html?session_id={CHECKOUT_SESSION_ID}`,
    "cancel_url": `${site}/#${product.kind === "class" ? "class" : "lessons"}`,
  });

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const session = await res.json();
  if (!res.ok) { console.error("Stripe error", session?.error?.message); return json({ error: "Could not start checkout. Please try again." }, 502, origin); }
  return json({ url: session.url }, 200, origin);
});
