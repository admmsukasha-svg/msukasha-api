# MSUKASHA Backend (Express + MongoDB Atlas on Vercel)

Matches every endpoint that `api.js`, `advertise.html`, `payment.html` and `admin_ads.html` call.

## 1. Setup

```bash
npm install
cp .env.example .env      # fill MONGODB_URI and JWT_SECRET
npm run dev               # http://localhost:5000/api/health
```

## 2. Deploy on Vercel

1. Push this folder to GitHub (the `.env` file is ignored by git).
2. Vercel -> Add New Project -> import the repo (Framework: Other).
3. Settings -> Environment Variables: `MONGODB_URI`, `JWT_SECRET`, `CORS_ORIGINS`, `REQUIRE_PAYMENT_FOR_APPROVAL`.
4. MongoDB Atlas -> Network Access: allow `0.0.0.0/0` (Vercel has no fixed IP).
5. Deploy, then open `https://YOUR-PROJECT.vercel.app/api/health`.
6. In `api.js` the API base URL must be this Vercel URL (or set `window.MSUKASHA_API_BASE`).

## 3. Make yourself admin

Register on the website first, then:

```bash
node scripts/make-admin.js you@example.com
```

Log out and log in again. `admin_ads.html` works only for admin accounts.

## 4. Change the package prices

`src/config/packages.js` holds the advertising prices (PKR) and durations. The values there are
placeholders. Prices are always read on the server, never from the browser.

## 5. Endpoints

| Area | Endpoints |
|---|---|
| Auth | POST `/api/register`, POST `/api/login`, GET/PUT `/api/profile`, PUT `/api/password` |
| Cart / Wishlist | POST `/api/cart/sync`, GET `/api/cart/:uid`, same for `/api/wishlist` |
| Products | GET/POST `/api/products`, GET `/api/products/my`, GET/PUT/DELETE `/api/products/:id` |
| C2C ads | POST/GET `/api/ads`, GET `/api/ads/my` |
| Orders | POST `/api/orders`, GET `/api/orders/my`, GET `/api/orders/seller`, PATCH `/api/orders/:id/status` |
| Seller | GET `/api/seller/stats` |
| Messages | POST `/api/messages`, GET `/api/messages/:conversationId` |
| Forms | POST `/api/contact`, `/api/job-application`, `/api/verification`, `/api/partner`, `/api/book-call` |
| Business ads | POST/GET `/api/business-ads`, GET `/active`, `/my`, `/:id`, PUT/DELETE `/:id`, POST `/:id/payment`, `/:id/impression`, `/:id/click` |
| Admin | GET `/api/admin/business-ads`, PATCH `.../:id/approve`, `.../:id/reject`, `.../:id/payment`, PUT `.../:id`, plus `/ads`, `/submissions`, `/users` |

## 6. Ad flow

1. Advertiser submits `advertise.html` -> ad saved as `pending` / `unpaid`, price taken from the server.
2. `payment.html` -> `POST /:id/payment` -> `paymentStatus = pending_verification` (needs a logged-in user).
3. Admin checks the bank transfer, then presses Approve in `admin_ads.html` -> ad becomes `approved`, payment `paid`, dates set from the package duration.
4. Homepage shows only approved ads inside their start/end dates.

## 7. Small frontend changes needed

### advertise.html: pass amount and duration to the payment page
Inside the `sessionStorage.setItem("msukasha_pending_ad_payment", ...)` object add:

```js
amount: result.amount,
duration: result.duration,
```

Without this the payment page shows "PKR 0".

### main.js: homepage must load ads from the API and escape text
`renderAdvertisingAds()` currently reads `localStorage`, so approved ads from the database never appear,
and it puts `ad.title` / `ad.description` straight into `innerHTML`. Replace the start of the function with:

```js
async function renderAdvertisingAds() {
  const container = document.getElementById('msukasha-advertising');
  if (!container || typeof apiGetActiveBusinessAds !== 'function') return;
  let ads = [];
  try { ads = await apiGetActiveBusinessAds(); } catch (e) { return; }
  if (!ads.length) return;
  const ad = ads[0];
  const id = String(ad.id || '');
  // ... keep the rest, but wrap every ${ad.title}, ${ad.description} in escHtml(...)
  // and use apiRecordAdClick(id) / apiRecordAdImpression(id) instead of the localStorage versions.
}
```

## 8. Security notes

- Passwords hashed with bcrypt; JWT expires after 7 days.
- Clients cannot choose `admin` at registration, and cannot set `status`, `paymentStatus`, price or `userId`.
- Ad links must be http(s) (blocks `javascript:`), and `< >` is stripped from text fields.
- Rate limits are in memory, so on Vercel they apply per server instance. Use Upstash/Redis for strict limits.
- Impression/click counters are public and can be inflated. Do not bill advertisers on these numbers yet.
- Card numbers are never stored. The "card" method on orders needs a real gateway before it can take money.
- Static catalog items (p1, c2c-honda...) are not in the database, so order prices for them come from the browser.
  Move the catalog into the `products` collection to make prices trusted.
