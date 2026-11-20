# standupstudiola

Website for Stand Up Studio LA. Static site, no build step, served from Cloudflare.
Data lives in Supabase (project `comedian-websites-and-shows`, schema `studio`).

## Layout

- `public/index.html` – home page: this month's class, private lessons, friends, newsletter, FAQ
- `public/css/site.css` – styles (cream page, black bar, olive painted headlines, Open Sans body)
- `public/js/site.js` – reads published products and instructor cards from Supabase
- `public/fonts/` – Acrylic Hand Thick (Tom Chalky, licensed), self-hosted
- `public/thanks.html` – page buyers land on after paying
- `supabase/functions/studio-checkout` – starts a Stripe Checkout (deployed to Supabase as an Edge Function)
- `supabase/functions/studio-stripe-webhook` – records paid and refunded sales from Stripe
- `wrangler.jsonc` – Cloudflare config (static assets only)

## Payments

Sales go to the studio's own Stripe account through Stripe Checkout (promotion codes enabled).
Coaches with a `public_email` are booked by email instead and have no buy button.
Secrets live in Supabase > Edge Functions > Secrets: `STUDIO_STRIPE_SECRET_KEY`, `STUDIO_STRIPE_WEBHOOK_SECRET`.
Stripe webhook endpoint: `https://ycmijcfeqpuqmapmklfi.supabase.co/functions/v1/studio-stripe-webhook`
(events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`).

## Not done yet

- Instructor and friend photos still load from the old WordPress site; move them into `public/images/`
- Email to the studio when something sells (Stripe's own notifications cover this for now)
- Stripe Connect for the other instructors
- Newsletter signup is a form with nothing behind it
- Admin section, weekly reminders, bulk email
