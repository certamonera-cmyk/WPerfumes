# WPerfumes E-Commerce Flask Application

[Project repository](https://github.com/certamonera-cmyk/WPerfumes)

---
Paypal

##  chmod +x ./run-local.sh
## ./run-local.sh
Client ID:Aex5V6cd5gPmzyKIQ48BSM6iqwfpcZh_8YtxE_Dtn-F5txEJ1q4aaYguPAah098_VIAg6G5JnXJEZT3v
Secret: EPsB0GYPkOvjjX4obDvJDjnHmcr2M5U9NsmRS3udNXj1eMDYFgS2V9zEgPE3nduhzC2aNLtLC00PrjFw




## Features

- User authentication (admin-only)
- Product and brand CRUD operations
- Homepage featured products
- Shopping cart and checkout logic
- Order placement and tracking
- Coupon and promotions management
- Email notifications via Gmail SMTP
- Price comparison (admin-managed and competitor scraper)
- Top picks + smart product sections
- CORS enabled for frontend integration

---

## Project Structure

```
WPerfumes/
├── app/
│   ├── __init__.py        # Flask app factory, extension setup, blueprint registration
│   ├── models.py          # Database models & seed data
│   ├── routes.py          # API and page endpoints
│   ├── ...                # Other route files (content, search, admin, etc.)
│   ├── templates/         # Jinja2 HTML templates
│   └── static/            # CSS, JS, images, audio, etc.
├── run.py                 # App entry point
├── requirements.txt       # Python dependencies
├── Procfile               # For deployment (Render/heroku)
├── .gitignore             # Files to ignore in Git
└── README.md              # Project documentation (you are here)
```

---

## Local Development Setup

1. **Clone the repository:**

   ```sh
   git clone https://github.com/certamonera-cmyk/WPerfumes.git
   cd WPerfumes
   ```

2. **Create a virtual environment and activate it:**

   ```sh
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **Install dependencies:**

   ```sh
   pip install -r requirements.txt
   ```

4. **Set your environment variables (for local Postgres, email, PayPal, etc):**

   ```sh
   export DATABASE_URL="postgresql://youruser:yourpass@localhost:5432/yourdb"
   export SECRET_KEY="your-secret-key"
   export MAIL_USERNAME="your_gmail@example.com"
   export MAIL_PASSWORD="your_app_specific_gmail_password"
   export PAYPAL_CLIENT_ID="your-paypal-client-id"
   export PAYPAL_SECRET="your-paypal-secret"
   # For Windows Git Bash use: export VAR="value"
   ```

   - Or create an `.env` file if you use a loader, or `instance/config.py` for local config override.

5. **Run the app:**

   ```sh
   python run.py
   ```
   The API and frontend will be available at http://localhost:5000/

---

## Deployment (Render, Heroku & others)

- **Provision a PostgreSQL database** in your hosting platform.
- **Set the `DATABASE_URL` environment variable** (Render/heroku does this for you if you link a database).
- **Configure mail and PayPal environment variables**.
- **Deploy** (Render will use the `Procfile` and `requirements.txt`).

---

## Database

- **Local:** Uses SQLite by default if `DATABASE_URL` is not set, but you should set Postgres for full feature parity.
- **Production:** Always uses PostgreSQL via the `DATABASE_URL` environment variable.

---

## GitHub Usage (for this repository)

- All remote actions and project pushes should be to:  
  `https://github.com/certamonera-cmyk/WPerfumes.git`

  Set your remote using:
  ```sh
  git remote set-url origin https://github.com/certamonera-cmyk/WPerfumes.git
  ```
  Then push normally:
  ```sh
  git push origin master
  ```

> **All documentation, code, and badges should point to `certamonera-cmyk`.**

---

## Important Endpoints

| Endpoint                       | Method | Description                          |
|---------------------------------|--------|--------------------------------------|
| `/api/auth/login`               | POST   | Admin login                          |
| `/api/brands`                   | GET    | List all brands                      |
| `/api/products`                 | GET    | List all products                    |
| `/api/orders`                   | GET    | List all orders (admin)              |
| `/api/orders`                   | POST   | Place a new order                    |
| `/api/coupons`                  | GET    | List all coupons                     |
| `/api/settings/checkout_discount`| GET   | Site-wide (auto) discount information|
| `/content-api/stories`          | GET    | Public API for content stories       |
| `/api/search?q=...`             | GET    | Product search                       |
| `/api/price-compare`            | GET    | Product price comparison             |
| ...                             | ...    | ...                                  |

---

## Notes

- **Static files** (CSS, JS, images, audio) go in `app/static/`.
- **HTML templates** go in `app/templates/`.
- **Seed data** is auto-inserted on first run if the database is empty.
- **Sensitive information** (passwords, tokens) should not be committed to the repo. Use environment variables.

---

## License

MIT License

---

## Author

- [certamonera-cmyk](https://github.com/certamonera-cmyk)