# MineListings.zw

A marketplace for buying and selling mines, claims and mineral blocks in Zimbabwe.

## Run it

Requires Node.js 22.13 or newer (it uses Node's built-in SQLite, so there are no native modules to compile).

```bash
npm install
npm start            # http://localhost:3000
```

On first start the app creates `data/mines.db`, seeds the launch listings and creates an admin account.
The admin password is printed in the terminal and saved to `data/admin-credentials.txt`.
To choose your own admin login, set it before the first start:

```bash
ADMIN_EMAIL=you@yourdomain.com ADMIN_PASSWORD='something-strong' npm start
```

Locked out of the admin account? Set `ADMIN_RESET_PASSWORD` and restart. The new password is applied on startup and the
admin email is printed in the logs. Remove the variable afterwards, or the password resets on every restart.

To start over from scratch, stop the server and delete the `data/` folder.

## Settings

Edit `config.js` (or set environment variables) for the site name, contact email, phone, WhatsApp number
(which turns on the WhatsApp buttons), office address, and the lists of minerals and provinces.
In production set `NODE_ENV=production` so cookies are marked `Secure` (HTTPS only).

## What's where

| Area | URL |
| --- | --- |
| Browse / search / filter | `/mines` |
| Listing page (gallery, enquiry, site visit, offer) | `/mines/:slug` |
| Submit a listing | `/sell` |
| User dashboard (listings & review status, offers, saved mines) | `/dashboard` |
| Admin: review queue, approve/decline with note, feature, mark under offer/sold, delete | `/admin/listings` |
| Admin: offers (accept/decline), enquiries, users | `/admin/offers`, `/admin/enquiries`, `/admin/users` |
| Terms, privacy, cookie policy | `/terms`, `/privacy`, `/cookies` |

### Adding listings
Sellers submit through `/sell` and their listing waits in the admin review queue. Admins can edit any listing.
To change the launch data, edit `seed.js`. It only runs when the database has no listings.

### Cookie consent
The banner stores the visitor's choice in a `cookie_consent` cookie. To add analytics or marketing tags,
put them in `views/partials/footer.ejs` as `<script type="text/plain" data-cookie-category="analytics">`.
They only run after the visitor allows that category. Bump `cookieConsentVersion` in `config.js` to ask everyone again.

### Images
Stock mineral photos in `public/img/minerals/` come from Wikimedia Commons under open licences.
Attribution is shown at `/image-credits` and must stay there. Seller uploads go to `uploads/`.

## Before going live
- Have a Zimbabwean legal practitioner review `views/legal/*.ejs`. They're a solid starting template, not legal advice.
- Replace the placeholder contact details in `config.js`.
- Set up email notifications (e.g. Nodemailer + SMTP) if you want admins/sellers emailed. Right now everything shows on the dashboards.
- Back up `data/` and `uploads/` regularly.
