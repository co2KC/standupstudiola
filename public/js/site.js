/* Standup Studio LA home page.
   Reads published products from Supabase (schema "studio") and renders
   this month's class and the private-lesson instructor cards. */

const SUPABASE_URL = "https://ycmijcfeqpuqmapmklfi.supabase.co";
// Publishable key: safe in the browser. Row-level security decides what it can read.
const SUPABASE_KEY = "sb_publishable_z8-rMJft2I9xKOv8rKAbtQ_1hzTy0_r";

// Coach photos live in Supabase Storage (bucket "studio-site"), named by the coach's name.
const PHOTO_BASE = `${SUPABASE_URL}/storage/v1/object/public/studio-site/coaches/`;
const photoFor = (person) => `${PHOTO_BASE}${slugName(person)}.jpg`;

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
    api("products?select=id,slug,name,kind,theme,description,duration_minutes,price_cents,capacity,image_url,location,product_dates(starts_at,ends_at),product_instructors(person_id)&status=eq.published"),
    api("public_instructors?select=id,first_name,last_name,bio,website_url,public_email"),
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
        ${p.location ? `<p class="facts where"><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.location)}" target="_blank" rel="noopener">${esc(p.location)}</a></p>` : ""}
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
    const photo = photoFor(person);
    const { facts, paras } = splitBio(person.bio);
    return `
      <article class="coach">
        <img src="${photo}" alt="${esc(fullName(person))}" width="600" height="600" loading="lazy" onerror="this.remove()">
        <div class="coach-body">
          <h3>${esc(fullName(person))}</h3>
          <dl>
            ${facts.focus ? `<dt>Focus</dt><dd>${esc(facts.focus)}</dd>` : ""}
            ${facts["skill level"] ? `<dt>Best for</dt><dd>${esc(facts["skill level"])}</dd>` : ""}
          </dl>
          ${paras.length ? `<details><summary>About ${esc(person.first_name)}</summary>${paras.map((t) => `<p>${esc(t)}</p>`).join("")}</details>` : ""}
          <div class="buy">
            <span class="price"><b>${money(p.price_cents)}</b> <span>/ ${p.duration_minutes} min</span></span>
            ${person.public_email
              ? `<a class="btn" href="mailto:${esc(person.public_email)}?subject=${encodeURIComponent("Private lesson via Standup Studio LA")}">Email ${esc(person.first_name)}</a>`
              : `${buyButton(p)}<p class="buy-note" role="status"></p>`}
          </div>
        </div>
      </article>`;
  }).join("");
}

// Buy buttons hand off to Stripe Checkout through the studio-checkout function.
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-buy]");
  if (!btn || btn.disabled) return;
  const note = btn.closest("article").querySelector(".buy-note");
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "One sec…"; note.textContent = "";
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/studio-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ slug: btn.dataset.buy }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error || "Could not start checkout. Please try again.");
    location.href = data.url;
  } catch (err) {
    note.textContent = err.message;
    btn.disabled = false; btn.textContent = label;
  }
});

// Newsletter signup: adds the person to the studio's list.
$("signup").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget, note = $("signup-note"), btn = form.querySelector("button");
  const data = Object.fromEntries(new FormData(form));
  btn.disabled = true; note.textContent = "";
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/studio-signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify(data),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || "Something went wrong. Please try again.");
    form.reset();
    note.textContent = "You're on the list. We'll be in touch.";
  } catch (err) {
    note.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
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
