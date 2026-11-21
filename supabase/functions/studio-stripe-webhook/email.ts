// Emails sent after a sale: a confirmation to the buyer and a notice to the studio.
// Uses Resend. If STUDIO_RESEND_API_KEY is not set, nothing is sent.
const FROM = "Standup Studio LA <classes@standupstudiola.com>";
const REPLY_TO = "co2@co2isfunny.com";
const STUDIO_INBOX = "co2@co2isfunny.com";
const TZ = "America/Los_Angeles";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const money = (cents: number) => "$" + (cents / 100).toFixed(cents % 100 ? 2 : 0);

async function send(key: string, to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, html }),
  });
  if (!res.ok) console.error("Resend failed", res.status, (await res.text()).slice(0, 300));
}

const shell = (heading: string, body: string) => `
<div style="background:#EDEEE1;padding:24px 12px;font-family:Helvetica,Arial,sans-serif;color:#231F20;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:3px solid #161512;">
    <div style="background:#C9B341;padding:22px 26px;border-bottom:3px solid #161512;">
      <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">Standup Studio LA</div>
      <div style="font-size:30px;line-height:1.1;font-weight:900;text-transform:uppercase;margin-top:6px;">${heading}</div>
    </div>
    <div style="padding:24px 26px;font-size:16px;line-height:1.55;">${body}</div>
  </div>
</div>`;

export type Sale = {
  buyerEmail: string; buyerName: string; buyerPhone: string | null; amountCents: number;
  product: { kind: string; name: string; theme: string | null; location: string | null; duration_minutes: number | null };
  dates: { starts_at: string; ends_at: string | null }[];
  instructors: string[];
};

export async function sendSaleEmails(sale: Sale) {
  const key = (Deno.env.get("STUDIO_RESEND_API_KEY") ?? "").trim();
  if (!key) return;
  const { product: p } = sale;
  const isClass = p.kind === "class";
  const title = isClass ? `${p.theme ?? "Group class"} (${p.name})` : `Private lesson with ${sale.instructors[0] ?? "your coach"}`;
  const hi = sale.buyerName ? `Hi ${esc(sale.buyerName.split(" ")[0])},` : "Hi,";

  const day = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" });
  const time = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  const sorted = [...sale.dates].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const when = sorted.map((d) => `<li>${day.format(new Date(d.starts_at))}, ${time.format(new Date(d.starts_at))}${d.ends_at ? " to " + time.format(new Date(d.ends_at)) : ""}</li>`).join("");
  const place = (p.location ?? "").replace(/\s*\([^)]*\)\s*$/, "");
  const map = place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}` : "";

  const buyerBody = isClass
    ? `<p>${hi}</p><p>You're in for <strong>${esc(title)}</strong>.</p>
       ${when ? `<p style="margin-bottom:6px;"><strong>When</strong> (Pacific time)</p><ul style="margin-top:0;">${when}</ul>` : ""}
       ${place ? `<p><strong>Where</strong><br>${esc(place)}<br><a href="${map}" style="color:#71743F;">Open in Maps</a></p>` : ""}
       ${sale.instructors.length ? `<p><strong>Your coaches</strong><br>${esc(sale.instructors.join(" & "))}</p>` : ""}
       <p>Questions? Just reply to this email.</p><p>See you there!</p>`
    : `<p>${hi}</p><p>Thanks for booking a <strong>${p.duration_minutes ?? 60}-minute private lesson with ${esc(sale.instructors[0] ?? "your coach")}</strong>.</p>
       <p>${esc((sale.instructors[0] ?? "Your coach").split(" ")[0])} will be in touch shortly to set a time that works for you. If you'd like to get the ball rolling, reply to this email with a few days and times that suit you.</p>`;
  const paid = `<p style="color:#5F5F50;font-size:14px;border-top:1px solid #C9CBB6;padding-top:14px;">Paid: ${money(sale.amountCents)}. Your receipt comes separately from Stripe.</p>`;

  await send(key, sale.buyerEmail, isClass ? `You're in: ${title}` : `Booked: ${title}`, shell("You're in.", buyerBody + paid));
  await send(key, STUDIO_INBOX, `New sale: ${title} (${money(sale.amountCents)})`, shell("New sale.",
    `<p><strong>${esc(title)}</strong></p>
     <p>${esc(sale.buyerName || "(no name given)")}<br><a href="mailto:${esc(sale.buyerEmail)}">${esc(sale.buyerEmail)}</a>${sale.buyerPhone ? "<br>" + esc(sale.buyerPhone) : ""}</p>
     <p>Paid ${money(sale.amountCents)}.</p>${isClass ? "" : "<p><strong>This is a private lesson: reach out to schedule it.</strong></p>"}`));
}
