# Mr. Guitar POS

Point of sale, inventory, repairs and rentals for **Mr. Guitar, Beliatta**.

A static PWA — no build step, no `npm install`. Plain ES modules + Firebase
(Authentication + Realtime Database) loaded from the CDN. Works on a phone, a
tablet or a shop counter PC, and keeps selling when the internet drops.

---

## 1. Setup (do this once)

### a. Publish the database rules — **this is the important one**

Until you do this, anyone who signs up can read and write your whole database
directly, regardless of what the app shows them. The approval and role system is
only real once the rules are live.

1. Open the [Firebase console](https://console.firebase.google.com/) → project
   **mrguitarpos** → **Realtime Database** → **Rules**.
2. Replace everything with the contents of [`database.rules.json`](database.rules.json).
3. Click **Publish**.

### b. Create the first admin

The **first account to sign up in an empty database becomes the admin
automatically**. Every account after that is created as `pending / staff` and
must be approved from **More → Staff**.

So: publish the rules, open the app, sign up once with your own email. That
account is now the admin.

> If you already have accounts in the database, the automatic promotion will not
> fire. In that case set `role: "admin"` and `status: "approved"` on your own
> `/users/<uid>` record by hand in the Firebase console, and add `/meta/seeded: true`.

### c. Storage — optional, and **not** needed for PDF receipts

Firebase **Storage now requires the Blaze (pay-as-you-go) plan**, so it asks you
to add a card even though receipt-sized files sit well inside the free
allowance. You do not need it: the *share sheet* mode sends a real PDF for free.
See [Sending on WhatsApp](#sending-on-whatsapp).

Only if you do upgrade and want the one-tap download link:

1. Firebase console → **Storage** → **Get started**.
2. **Storage → Rules**, paste the contents of [`storage.rules`](storage.rules), **Publish**.
3. In the app: **More → Settings → WhatsApp receipts** → *Message + PDF download link*.

### d. Fill in the shop details

**More → Settings**: shop name, address, phone, currency, tax %, low-stock level,
invoice prefix, and the whole receipt template (below).

---

## 2. Running it

It is a static site — serve the folder over HTTP (ES modules do not work from
`file://`).

```bash
python -m http.server 5177
```

Then open <http://localhost:5177>.

For the shop, host it anywhere static — GitHub Pages, Firebase Hosting, Netlify.
On the phone, open it in Chrome/Safari and use **Add to home screen** to install
it as an app.

---

## 3. What it does

### Register (POS)
- Search by name, SKU or **barcode scan** (scanner types into the search box, Enter adds the item)
- Category filters, live stock counts, out-of-stock items greyed out
- Quantity steppers, per-line price override, per-line discount
- Cart-level discount by amount or percent, plus tax if configured
- **Quick / custom lines** for labour, one-off items or charges
- **Park and resume** sales when a customer steps away
- Attach a customer, or sell to a walk-in
- Payment: cash (with quick-tender buttons and change calculation), card, bank
  transfer, on-credit, and **split payments** across methods
- Optional **WhatsApp number** field at checkout (pre-filled from the customer record)
- Printable 80 mm / A5 receipt, plus WhatsApp delivery — see below

### Inventory
- SKU / barcode, brand, category, cost price, selling price, margin
- Reorder level per item and a low-stock alert on sign-in
- **Stock adjustments** (purchase, return, damage, stock-count correction) with an
  audit trail in `/stockmoves`
- CSV import and export
- Optional "don't track stock" items

### Sales
- Invoice history with date filters and search
- Full invoice detail with cost and profit (manager and admin only)
- **Refunds** — full or partial, line by line, with optional restock
- Settle unpaid (credit) invoices
- CSV export

### Reports
- Revenue, cost, gross profit, expenses, **net profit**, average sale, items sold
- Daily revenue chart
- Top selling items, payment method mix, sales by staff member
- Any date range including custom, exportable to CSV

### Repairs
Job intake with instrument, reported problem, estimate, advance, promised date and
status (received → in progress → waiting for parts → ready → delivered).
"Charge & close" pushes parts and labour into the register as a sale, less any
advance already taken.

### Rentals
Rent an instrument out with a daily rate, deposit and due date. Overdue rentals
are flagged. On return the charge is calculated from days out and pushed to the
register. Inventory-linked rentals move stock automatically.

### Customers & expenses
Customer records with purchase history, total spent and outstanding balance.
Expense log by category, which feeds the net profit figure in reports.

### Staff
Sign-ups are locked out until an admin approves them. Three roles:

| Role | Can do |
| --- | --- |
| **Staff** | Sell, add and adjust stock, log repairs and rentals |
| **Manager** | Also: profit figures, refunds, expenses, settling credit |
| **Admin** | Also: staff accounts, shop settings, categories |

---

## 4. Receipts and WhatsApp

### Changing the receipt

Everything is under **More → Settings → Receipt template** — no code needed:

| Setting | What it does |
| --- | --- |
| Paper size | 80 mm thermal roll, or A5/A4 |
| Layout | **Classic** (name, then qty × price), **Compact** (one line per item), **Detailed** (SKU and per-line totals) |
| Logo | Any image; shrunk to 240 px and stored with your settings |
| Extra header lines | VAT number, tagline — one per line |
| Show SKU / cashier / customer | Individual toggles |
| "You saved" line | Prints the total discount when there was one |
| Footer | Your thank-you text |

**Preview receipt** shows a sample invoice with your unsaved changes applied, so
you can judge it before saving.

The thermal PDF is a single continuous page sized to the content — a 2-line
receipt is 92 mm tall, a 12-line one is 200 mm. No wasted paper, no page breaks.

### Sending on WhatsApp

At checkout there is an optional **WhatsApp number** box. Leave it blank and
nothing changes. Fill it in and, as soon as the sale is saved, WhatsApp opens on
that number with the receipt ready to send.

Numbers are accepted in any format — `077 123 4567`, `+94771234567`,
`0094771234567` all become `94771234567`. The country code is configurable
(default `94`).

**Three ways to send it**, chosen in Settings → *How the receipt is sent*:

| Mode | Customer gets | Taps for you | Cost |
| --- | --- | --- | --- |
| **Message only** | Receipt written out as a WhatsApp message | 1 | free |
| **Message + share sheet PDF** | The real PDF as a chat attachment | 2 — number is auto-filled for the message, then you pick the customer in the share sheet for the file | free |
| **Message + download link** | Message with a tap-through PDF link | 1 | needs Firebase Blaze plan |

The share-sheet mode is the free way to get an actual PDF into the customer's
chat. It uses the phone's own share sheet, which is why the contact is chosen
there — no web page can pre-select a WhatsApp contact for a file. On a desktop
with no share sheet, the PDF downloads instead so you can attach it manually.

The message wording is a template you control in Settings. Available
placeholders:

```
{shop} {branch} {customer} {invoice} {date} {items} {total}
{currency} {paid} {due} {method} {phone} {link} {footer}
```

You can also send from **Sales → tap an invoice → WhatsApp** at any time later.

### The one limitation

WhatsApp's link format carries **a recipient number and text only** — there is no
way for any website to attach a file to a specific number's chat. That is
WhatsApp's design, not a gap here. The options are:

- **Share sheet** (*Send PDF* on the receipt): hands the real file to WhatsApp,
  but *you* pick the contact. Free.
- **Download link:** number auto-filled and one tap for the customer, but the PDF
  arrives as a link rather than a file, and needs the Blaze plan.
- **WhatsApp Business Cloud API:** the only way to push a real PDF attachment to
  a number automatically. Needs a Meta Business account, a verified WhatsApp
  Business number, a backend server, and per-conversation charges.

If a phone has no WhatsApp installed, the receipt falls back to copyable text.

**Popup note:** browsers only allow opening a new tab from a direct tap. After a
sale the app tries to open WhatsApp automatically; if the browser blocks it, the
green **WhatsApp** button on the receipt is right there — one tap.

---

## 5. Offline behaviour

The shop's internet does not have to be reliable.

- The app shell is cached by the service worker, so it opens with no connection.
- Inventory, customers and settings are mirrored to `localStorage`, so the
  register is usable straight after a reload while offline.
- **Every write goes through a durable outbox** in `localStorage` and replays in
  order when the connection returns — a sale rung up offline survives a page
  reload or a dead battery.
- Offline invoices get a temporary `MG-OFF…` number so two tills cannot collide;
  online invoices come from an atomic counter.
- App code is fetched **network first** with a 3-second timeout, so a deploy
  reaches every till on its next launch instead of being stuck behind the cache.
  Below that timeout, or with no signal at all, the cached build is used.

### If a device is stuck on an old version

Open the app once with `?fresh=1` on the end of the address:

```
https://<your-site>/mrguitar-pos/index.html?fresh=1
```

That clears every cache and the service worker, then reloads clean. There is also
**More → Settings → Data & device → Check for updates**, which shows the version
this device is running.
- The header shows an **Offline** or **Syncing n** pill whenever there is
  anything queued.

Stock changes are applied as **transactions**, not read-modify-write, so two
tills selling the same item at the same time cannot overwrite each other.

---

## 6. Layout

```
index.html              markup and mount points
manifest.json           PWA manifest
sw.js                   service worker (app shell cache)
database.rules.json     Firebase security rules — publish these
css/styles.css          mobile-first stylesheet, dark mode, print styles
icons/icon.svg          app icon
js/
  app.js                boot, navigation, header, service worker registration
  auth.js               sign in / sign up / approval gate
  store.js              state, Firebase subscriptions, offline outbox
  firebase.js           Firebase init and re-exports
  util.js               DOM, formatting, modals, toasts, CSV
  pos.js                register: cart, discounts, payment, checkout
  receipt.js            receipt HTML, print, share
  inventory.js          items, stock moves, low stock, CSV
  sales.js              history, invoice detail, refunds
  reports.js            KPIs, chart, top sellers
  customers.js          customers and the customer picker
  repairs.js            repair jobs
  rentals.js            rentals
  expenses.js           expenses
  admin.js              staff accounts, settings, categories, backup
```

---

## 7. Notes

- The Firebase web config in `js/firebase.js` is **not** a secret — web API keys
  are public by design. Your protection is the database rules in step 1a.
- **More → Settings → Download backup** writes a full JSON snapshot. Do it
  monthly; Realtime Database has no free automatic backup.
- Removing a staff profile does not delete their Firebase Authentication login.
  Delete that in the Firebase console too, otherwise they can sign up again as a
  pending user.
- The app icon is an SVG. If you want a crisper icon on older Android, export a
  512×512 PNG and add it to `manifest.json`.
