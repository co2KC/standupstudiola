/* Standup Studio LA home page.
   Reads published products from Supabase (schema "studio") and renders
   this month's class and the private-lesson instructor cards. */

const SUPABASE_URL = "https://ycmijcfeqpuqmapmklfi.supabase.co";
// Publishable key: safe in the browser. Row-level security decides what it can read.
const SUPABASE_KEY = "sb_publishable_z8-rMJft2I9xKOv8rKAbtQ_1hzTy0_r";

// TEMPORARY: images still load from the old WordPress site. Move the files into
// /public/images and change this to "/images/" before the old site is shut down.
const IMG = "https://standupstudiola.com/wp-content/uploads/";
const PHOTOS = {
  "chris-oconnor": IMG + "2026/04/PRIVATE-LESSONS-CO2ISFUNNY-2-800PX.jpg",
  "sommer-austin": IMG + "2026/04/PRIVATE-LESSONS-SOMMER-2-800PX.jpg",
  "mike-muratore": IMG + "2026/04/PRIVATE-LESSONS-MIKE-M-2-800PX.jpg",
  "jim-mccaffree": IMG + "2026/04/JIM-MCCAFFREE-2.jpg",
  "alice-cutler": IMG + "2026/05/ALICE-CUTLER-PROFILE.jpg",
};
const CLASS_PHOTO = IMG + "2026/04/GROUPS-GENERAL-PROMO-2.jpg";

const TZ = "America/Los_Angeles";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (cents) => "$" + (cents / 100).toFixed(cents % 100 ? 2 : 0);
const slugName = (p) => `${p.first_name} ${p.last_name}`.toLowerCase().replace(/[^a-z ]/g, "").trim().replace(/\s+/g, "-");
const fullName = (p) => `${p.first_name} ${p.last_name}`;

async function api(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, "Accept-Profile": "studio" },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function loadCatalog() {
  try {
    const [products, instructors] = await Promise.all([
      api("products?select=id,slug,name,kind,theme,description,duration_minutes,price_cents,capacity,product_dates(starts_at,ends_at),product_instructors(person_id)&status=eq.published"),
      api("public_instructors?select=id,first_name,last_name,bio,website_url"),
    ]);
    return { products, instructors, preview: false };
  } catch (err) {
    // TEMPORARY: until the studio schema is exposed in Supabase's API settings,
    // show a snapshot so the page can be reviewed. Delete this fallback
    // (and /data/preview.json) once the live read works.
    console.warn("Live catalog unavailable, showing preview snapshot.", err);
    const snap = await fetch("/data/preview.json").then((r) => r.json());
    return { ...snap, preview: true };
  }
}

function dateLine(dates) {
  const sorted = [...dates].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  if (!sorted.length) return "";
  const day = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" });
  const time = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  const clock = (iso) => time.format(new Date(iso)).replace(":00", "").replace("12 PM", "Noon");
  const first = sorted[0];
  const when = first.ends_at ? `${clock(first.starts_at)} to ${clock(first.ends_at)} Pacific` : `${clock(first.starts_at)} Pacific`;
  return { days: sorted.map((d) => day.format(new Date(d.starts_at))).join(", "), when, count: sorted.length };
}

function buyButton(product) {
  return `<button class="btn" type="button" data-buy="${esc(product.slug)}">Sign me up</button>`;
}

function renderClass(products, people) {
  const now = Date.now();
  // The class to feature: the published class whose last date is still ahead, soonest first.
  const classes = products
    .filter((p) => p.kind === "class" && p.product_dates?.length)
    .map((p) => ({ p, first: Math.min(...p.product_dates.map((d) => Date.parse(d.starts_at))), last: Math.max(...p.product_dates.map((d) => Date.parse(d.starts_at))) }))
    .filter((c) => c.last >= now)
    .sort((a, b) => a.first - b.first);
  const slot = $("class-slot");
  if (!classes.length) {
    slot.innerHTML = `<p class="empty">The next class will be posted here soon. Join the newsletter below to hear first.</p>`;
    return;
  }
  const p = classes[0].p;
  const d = dateLine(p.product_dates);
  const teachers = (p.product_instructors || []).map((l) => people.get(l.person_id)).filter(Boolean).map(fullName);
  slot.innerHTML = `
    <article class="class-card">
      <img src="${CLASS_PHOTO}" alt="Standup Studio LA group classes" width="800" height="800" loading="lazy">
      <div>
        ${p.theme ? `<span class="tag">This month: ${esc(p.theme)}</span>` : ""}
        <h3>${esc(p.name)} group class</h3>
        ${p.description ? `<p>${esc(p.description)}</p>` : ""}
        <ul>
          <li>${d.count} Saturdays: ${esc(d.days)}</li>
          <li>${esc(d.when)}</li>
          ${teachers.length ? `<li>Taught by ${esc(teachers.join(" & "))}</li>` : ""}
          ${p.capacity ? `<li>Only ${p.capacity} spots</li>` : ""}
        </ul>
        <div class="buy"><span class="price">${money(p.price_cents)}</span> &nbsp; ${buyButton(p)}</div>
        <p class="buy-note" role="status"></p>
      </div>
    </article>`;
}

function renderLessons(products, people) {
  const lessons = products.filter((p) => p.kind === "private_lesson");
  const slot = $("lessons-slot");
  if (!lessons.length) {
    slot.innerHTML = `<p class="empty">Private lessons will be posted here soon.</p>`;
    return;
  }
  const cards = lessons.map((p) => {
    const person = (p.product_instructors || []).map((l) => people.get(l.person_id)).find(Boolean);
    if (!person) return "";
    const photo = PHOTOS[slugName(person)];
    const bio = (person.bio || "").split(/\n+/).map((line) => `<p>${esc(line)}</p>`).join("");
    return { name: fullName(person), html: `
      <article class="lesson">
        ${photo ? `<img src="${photo}" alt="${esc(fullName(person))}" width="400" height="400" loading="lazy">` : "<div></div>"}
        <div>
          <h3>Private coaching with ${esc(fullName(person))}</h3>
          <div class="bio">${bio}</div>
          <div class="buy">
            <span class="price">${money(p.price_cents)} for ${p.duration_minutes} minutes</span>
            ${buyButton(p)}
          </div>
          <p class="buy-note" role="status"></p>
        </div>
      </article>` };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  slot.innerHTML = cards.map((c) => c.html).join("");
}

// Checkout is not built yet. This is where the button will hand off to Stripe.
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-buy]");
  if (!btn) return;
  const note = btn.closest("article").querySelector(".buy-note");
  note.textContent = "Online checkout is being set up. Please check back soon.";
});

// Newsletter signup is not connected yet.
$("signup").addEventListener("submit", (e) => {
  e.preventDefault();
  $("signup-note").textContent = "Signup is being set up. Please check back soon.";
});

$("year").textContent = new Date().getFullYear();

loadCatalog().then(({ products, instructors }) => {
  const people = new Map(instructors.map((i) => [i.id, i]));
  renderClass(products, people);
  renderLessons(products, people);
}).catch((err) => {
  console.error(err);
  $("class-slot").innerHTML = $("lessons-slot").innerHTML = `<p class="empty">We couldn't load this right now. Please refresh in a moment.</p>`;
});
