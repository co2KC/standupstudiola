// Stand Up Studio LA: record sales that Stripe reports.
// Stripe events: checkout.session.completed, checkout.session.async_payment_succeeded, charge.refunded
// Secrets (Supabase > Edge Functions > Secrets): STUDIO_STRIPE_WEBHOOK_SECRET, and optionally STUDIO_RESEND_API_KEY for emails
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendSaleEmails } from "./email.ts";

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// Stripe signs "<timestamp>.<raw body>" with the endpoint's signing secret.
async function verified(raw: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`)));
  return sigs.some((s) => {
    if (s.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < s.length; i++) diff |= s.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  // Trim in case the secret was pasted with a stray space or line break.
  const secret = (Deno.env.get("STUDIO_STRIPE_WEBHOOK_SECRET") ?? "").trim();
  if (!secret) return new Response("Webhook is not set up yet.", { status: 503 });

  const raw = await req.text();
  const sigHeader = req.headers.get("stripe-signature");
  if (!(await verified(raw, sigHeader, secret))) {
    // Diagnostics only: never log the secret or the signature themselves.
    const t = Number(sigHeader?.match(/t=(\d+)/)?.[1] ?? 0);
    console.error("studio-stripe-webhook bad signature", JSON.stringify({
      hasHeader: !!sigHeader,
      secondsOff: t ? Math.round(Date.now() / 1000 - t) : null,
      secretLooksLikeWhsec: secret.startsWith("whsec_"),
      secretLength: secret.length,
      bodyBytes: raw.length,
    }));
    return new Response("Bad signature", { status: 400 });
  }

  const event = JSON.parse(raw);
  const obj = event.data?.object ?? {};
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "studio" } });

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      // This Stripe account may serve other sites too; only handle our own sessions.
      if (obj.metadata?.site !== "standupstudiola" || obj.payment_status !== "paid") return new Response("ignored", { status: 200 });

      const email = String(obj.customer_details?.email ?? "").trim().toLowerCase();
      if (!email) throw new Error(`Session ${obj.id} has no email`);
      const [first, ...rest] = String(obj.customer_details?.name ?? "").trim().split(/\s+/);
      const customer = typeof obj.customer === "string" ? obj.customer : null;

      // Find or create the buyer. Existing people keep their details.
      let { data: person, error: findErr } = await db.from("people").select("id, stripe_customer_id").ilike("email", email.replace(/[%_\\]/g, "\\$&")).maybeSingle();
      if (findErr) throw findErr;
      if (!person) {
        const { data: made, error: makeErr } = await db.from("people")
          .insert({ email, first_name: first || null, last_name: rest.join(" ") || null, phone: obj.customer_details?.phone ?? null, stripe_customer_id: customer })
          .select("id, stripe_customer_id").single();
        if (makeErr) throw makeErr;
        person = made;
      } else if (!person.stripe_customer_id && customer) {
        await db.from("people").update({ stripe_customer_id: customer }).eq("id", person.id);
      }

      // The unique checkout session id makes a repeated webhook harmless.
      const { data: recorded, error: buyErr } = await db.from("purchases").upsert({
        person_id: person!.id,
        product_id: obj.metadata.product_id,
        status: "paid",
        amount_paid_cents: obj.amount_total,
        stripe_checkout_session_id: obj.id,
        stripe_payment_intent_id: typeof obj.payment_intent === "string" ? obj.payment_intent : null,
      }, { onConflict: "stripe_checkout_session_id", ignoreDuplicates: true }).select("id");
      if (buyErr) throw buyErr;

      // Email only when this call actually recorded the sale, so a repeated webhook sends nothing twice.
      // An email problem must never make Stripe think the sale failed.
      if (recorded?.length) {
        try {
          const { data: product } = await db.from("products")
            .select("kind, name, theme, location, duration_minutes, product_dates(starts_at, ends_at), product_instructors(people(first_name, last_name))")
            .eq("id", obj.metadata.product_id).maybeSingle();
          if (product) {
            await sendSaleEmails({
              buyerEmail: email,
              buyerName: String(obj.customer_details?.name ?? "").trim(),
              buyerPhone: obj.customer_details?.phone ?? null,
              amountCents: obj.amount_total ?? 0,
              product,
              dates: product.product_dates ?? [],
              // deno-lint-ignore no-explicit-any
              instructors: (product.product_instructors ?? []).map((l: any) => l.people ? `${l.people.first_name} ${l.people.last_name}` : "").filter(Boolean),
            });
          }
        } catch (mailErr) {
          console.error("studio-stripe-webhook email failed", mailErr);
        }
      }
    } else if (event.type === "charge.refunded") {
      if (obj.refunded && typeof obj.payment_intent === "string") {
        const { error } = await db.from("purchases").update({ status: "refunded" }).eq("stripe_payment_intent_id", obj.payment_intent);
        if (error) throw error;
      }
    }
  } catch (err) {
    console.error("studio-stripe-webhook failed", event.type, err);
    return new Response("error", { status: 500 }); // Stripe will retry
  }
  return new Response("ok", { status: 200 });
});
