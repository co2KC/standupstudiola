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
  const [products, instructors] = await Promise.all([
    api("products?select=id,slug,name,kind,theme,description,duration_minutes,price_cents,capacity,image_url,product_dates(starts_at,ends_at),product_instructors(person_id)&status=eq.published"),
    api("public_instructors?select=id,first_name,last_name,bio,website_url"),
  ]);
  return { products, instructors };
}

function classDates(dates) {
  const sorted = [...dates].sort((x, y) => x.starts_at.localeCompare(y.starts_at));
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" });
  const day = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" });
  const time = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  const clock = (iso) => time.format(new Date(iso)).replace(":00", "").replace("12 PM", "Noon");
  const first = sorted[0];
  return {
    chips: sorted.map((d) => `<li><small>${wd.format(new Date(d.starts_at))}</small><b>${day.format(new Date(d.starts_at))}</b></li>`).join(""),
    when: first.ends_at ? `${clock(first.starts_at)} to ${clock(first.ends_at)} Pacific` : `${clock(first.starts_at)} Pacific`,
    count: sorted.length,
  };
}

const buyButton = (product, cls = "") => `<button class="btn ${cls}" type="button" data-buy="${esc(product.slug)}">Sign me up</button>`;

function renderClasses(products, people) {
  const now = Date.now();
  // Every published class whose last meeting is still ahead, soonest first.
  const classes = products
    .filter((p) => p.kind === "class" && p.product_dates?.length)
    .map((p) => ({ p, first: Math.min(...p.product_dates.map((d) => Date.parse(d.starts_at))), last: Math.max(...p.product_dates.map((d) => Date.parse(d.starts_at))) }))
    .filter((c) => c.last >= now)
    .sort((x, y) => x.first - y.first);
  const slot = $("class-slot");
  if (!classes.length) {
    slot.innerHTML = `<p class="empty">The next class will be posted here soon. Join the list below to hear first.</p>`;
    return [];
  }
  slot.innerHTML = classes.map(({ p }) => {
    const d = classDates(p.product_dates);
    const teachers = (p.product_instructors || []).map((l) => people.get(l.person_id)).filter(Boolean).map(fullName);
    return `
    <article class="feature${p.image_url ? " has-art" : " mustard"}">
      ${p.image_url ? `<img class="feature-art" src="${esc(p.image_url)}" alt="${esc(p.theme || p.name)} promo" width="1080" height="1080" loading="lazy">` : ""}
      <div class="feature-main">
        <span class="tag">${esc(p.name)}</span>
        <h3>${esc(p.theme || p.name)}</h3>
        <ol class="dates">${d.chips}</ol>
        <p class="facts"><strong>${esc(d.when)}</strong>${teachers.length ? ` &middot; taught by <strong>${esc(teachers.join(" & "))}</strong>` : ""}${p.capacity ? ` &middot; only ${p.capacity} spots` : ""}</p>
        ${p.description ? `<p>${esc(p.description)}</p>` : ""}
      </div>
      <div class="feature-buy">
        <div><span class="bigprice">${money(p.price_cents)}</span><span class="per">for all ${d.count} sessions</span></div>
        <div>${buyButton(p, "btn-mustard")}<p class="buy-note" role="status"></p></div>
      </div>
    </article>`;
  }).join("");
  // Coaches teaching the soonest class are listed first in private lessons.
  return (classes[0].p.product_instructors || []).map((l) => l.person_id);
}

// Bios end with optional "Focus: ..." and "Skill Level: ..." lines; pull those out as card facts.
function splitBio(bio) {
  const facts = {}; const paras = [];
  for (const line of (bio || "").split(/\n+/)) {
    const m = line.match(/^(Focus|Skill Level):\s*(.+)$/i);
    if (m) facts[m[1].toLowerCase()] = m[2].replace(/[,\s]+$/, ""); else if (line.trim()) paras.push(line.trim());
  }
  return { facts, paras };
}

function renderLessons(products, people, firstIds) {
  const slot = $("lessons-slot");
  const cards = products.filter((p) => p.kind === "private_lesson").map((p) => {
    const person = (p.product_instructors || []).map((l) => people.get(l.person_id)).find(Boolean);
    return person ? { p, person } : null;
  }).filter(Boolean);
  if (!cards.length) {
    slot.innerHTML = `<p class="empty">Private lessons will be posted here soon.</p>`;
    return;
  }
  // This month's class teachers first, then everyone else by name.
  const rank = (c) => (firstIds.includes(c.person.id) ? 0 : 1);
  cards.sort((x, y) => rank(x) - rank(y) || fullName(x.person).localeCompare(fullName(y.person)));
  slot.innerHTML = cards.map(({ p, person }) => {
    const photo = PHOTOS[slugName(person)];
    const { facts, paras } = splitBio(person.bio);
    return `
      <article class="coach">
        ${photo ? `<img src="${photo}" alt="${esc(fullName(person))}" width="600" height="600" loading="lazy">` : ""}
        <div class="coach-body">
          <h3>${esc(fullName(person))}</h3>
          <dl>
            ${facts.focus ? `<dt>Focus</dt><dd>${esc(facts.focus)}</dd>` : ""}
            ${facts["skill level"] ? `<dt>Best for</dt><dd>${esc(facts["skill level"])}</dd>` : ""}
          </dl>
          ${paras.length ? `<details><summary>About ${esc(person.first_name)}</summary>${paras.map((t) => `<p>${esc(t)}</p>`).join("")}</details>` : ""}
          <div class="buy">
            <span class="price"><b>${money(p.price_cents)}</b> <span>/ ${p.duration_minutes} min</span></span>
            ${buyButton(p)}
            <p class="buy-note" role="status"></p>
          </div>
        </div>
      </article>`;
  }).join("");
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
  const teacherIds = renderClasses(products, people);
  renderLessons(products, people, teacherIds);
}).catch((err) => {
  console.error(err);
  $("class-slot").innerHTML = $("lessons-slot").innerHTML = `<p class="empty">We couldn't load this right now. Please refresh in a moment.</p>`;
});
