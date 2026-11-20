# standupstudiola

Website for Stand Up Studio LA. Static site, no build step, served from Cloudflare.
Data lives in Supabase (project `comedian-websites-and-shows`, schema `studio`).

## Layout

- `public/index.html` – home page: this month's class, private lessons, friends, newsletter, FAQ
- `public/css/site.css` – styles (cream page, black bar, olive painted headlines, Open Sans body)
- `public/js/site.js` – reads published products and instructor cards from Supabase
- `public/fonts/` – Acrylic Hand Thick (Tom Chalky, licensed), self-hosted
- `public/data/preview.json` – TEMPORARY snapshot shown only when the live read fails
- `wrangler.jsonc` – Cloudflare config (static assets only for now)

## Not done yet

- Expose the `studio` schema in Supabase API settings, then publish products; then delete the preview fallback
- Images still load from the old WordPress site; move them into `public/images/`
- Checkout (Stripe Connect, direct charges), the Connect webhook, and the purchase notification to the instructor
- Newsletter signup is a form with nothing behind it
- Connect this repo to Cloudflare
