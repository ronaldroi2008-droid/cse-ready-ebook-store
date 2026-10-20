# CSE Ready PayMongo backend starter

Upload this folder as `backend/` at the root of the existing `cse-ready-ebook-store` repository, alongside `index.html`.

## Endpoints
- `GET /health` — health check.
- `POST /api/create-checkout-session` — creates a PayMongo Checkout Session for the CSE Ready Workbook Bundle (₱149) using QR Ph.
- `POST /webhooks/paymongo` — verifies PayMongo test-mode webhook signatures.

## Render deployment
Create a **Web Service** connected to the same GitHub repository:
- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`

Set these Environment Variables in Render:
- `PAYMONGO_SECRET_KEY` = full Test Mode secret key
- `PAYMONGO_WEBHOOK_SECRET` = signing secret from the PayMongo webhook configuration
- `SITE_URL` = `https://cse-ready-ebook-store.onrender.com`
- `PRODUCT_PRICE` = `14900`
- `CURRENCY` = `PHP`

Then deploy and check `https://YOUR-BACKEND.onrender.com/health`.

Configure a PayMongo Test Mode webhook at `https://YOUR-BACKEND.onrender.com/webhooks/paymongo` and select the relevant checkout/payment events.

## Important
This is only the backend starter. It does not yet store orders, send email, or deliver PDFs. Do not accept real payments until persistent order tracking, verified paid-event handling, duplicate-event protection, and secure delivery are added and tested. Confirm QR Ph is enabled for your PayMongo account; if the API rejects `qrph`, check your account's enabled methods and current PayMongo docs.

The existing frontend still needs a small JavaScript change to POST the buyer email to `/api/create-checkout-session` and redirect to the returned `checkoutUrl`. Never put the secret key in `index.html` or browser code.
