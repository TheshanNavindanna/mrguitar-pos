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

### c. Fill in the shop details

**More → Settings**: shop name, address, phone, currency, tax %, low-stock level,
invoice prefix and receipt size (80 mm thermal or A5).

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
- Printable 80 mm / A5 receipt, plus a plain-text version to share on WhatsApp

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

## 4. Offline behaviour

The shop's internet does not have to be reliable.

- The app shell is cached by the service worker, so it opens with no connection.
- Inventory, customers and settings are mirrored to `localStorage`, so the
  register is usable straight after a reload while offline.
- **Every write goes through a durable outbox** in `localStorage` and replays in
  order when the connection returns — a sale rung up offline survives a page
  reload or a dead battery.
- Offline invoices get a temporary `MG-OFF…` number so two tills cannot collide;
  online invoices come from an atomic counter.
- The header shows an **Offline** or **Syncing n** pill whenever there is
  anything queued.

Stock changes are applied as **transactions**, not read-modify-write, so two
tills selling the same item at the same time cannot overwrite each other.

---

## 5. Layout

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

## 6. Notes

- The Firebase web config in `js/firebase.js` is **not** a secret — web API keys
  are public by design. Your protection is the database rules in step 1a.
- **More → Settings → Download backup** writes a full JSON snapshot. Do it
  monthly; Realtime Database has no free automatic backup.
- Removing a staff profile does not delete their Firebase Authentication login.
  Delete that in the Firebase console too, otherwise they can sign up again as a
  pending user.
- The app icon is an SVG. If you want a crisper icon on older Android, export a
  512×512 PNG and add it to `manifest.json`.
