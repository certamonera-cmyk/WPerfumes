# WPerfumes E-Commerce Flask Application

## Commit to GitHub
git add -A
git commit -m "Remove Admin Tab, Automate product addition in Admin Panel"
git push origin master


##  chmod +x ./run-local.sh
## ./run-local.sh
AfTRhyp1ftl9u6Cy6Tz6HT8bLlnH3YKaoLgLkw6xLAJkEtOz-dCKVzmyVqwVHZ2uCU6Jrm6zV3L8C06f
ENfQY0jGTzefs-TaMLsfQa20ILEsxmzoNl8mYGK_fMbpDomqZwuSKKaLJo6teHA4HZpJ6qAvXD582LTZ


#Push changes to github
## 1 https://github.com/tulusehai-oss/WPerfumes

cd /Users/Makori/Desktop/WPerfumes

# 2 ensure we're in a git repo
if [ ! -d .git ]; then
  echo "No .git directory found. This folder is not a git repository."
  exit 1
fi

# 3 make sure origin points to the correct repo (add origin if missing)
if git remote | grep -q '^origin$'; then
  git remote set-url origin https://github.com/tulusehai-oss/WPerfumes.git
else
  git remote add origin https://github.com/tulusehai-oss/WPerfumes.git
fi

# 4 get current branch name
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Current branch: $BRANCH"

# 5 fetch remote and rebase local branch on remote changes (keeps history linear)
git fetch origin
git pull --rebase --autostash origin "$BRANCH"

# 6 stage all changes (new, modified, deleted)
git add -A

# 7 commit only if there are staged changes; use an exact timestamped message
if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "Update: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
fi

# 8 push to GitHub and set upstream if this is the first time for this branch
git push --set-upstream origin "$BRANCH"


This is an e-commerce backend built with Flask, SQLAlchemy, and PostgreSQL (compatible with SQLite for local development). It provides RESTful API endpoints for managing brands, products, homepage sections, orders, coupons, and more. The project is structured for easy deployment to [Render](https://render.com/) and supports email notifications for orders.

---

## Features

- User authentication (admin-only)
- Product and brand CRUD operations
- Homepage featured products
- Shopping cart logic
- Order placement and status tracking
- Coupon management
- Email notifications via Gmail SMTP
- CORS enabled for frontend integration

---

## Project Structure

```
WPerfumes/
├── app/
│   ├── __init__.py        # App factory, initialization
│   ├── models.py          # Database models & seed data
│   ├── routes.py          # API endpoints
│   ├── templates/         # (Your HTML files here)
│   └── static/            # CSS, JS, images, audio, etc.
├── run.py                 # App entry point
├── requirements.txt       # Python dependencies
├── Procfile               # For deployment (Render)
├── .gitignore             # Files to ignore in Git
└── README.md              # Project documentation
```

---

## Local Development

1. **Clone the repository:**
   ```sh
   git clone https://github.com/tulusehai-oss/WPerfumes.git
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

4. **Run the app locally:**
   ```sh
   python run.py
   ```
   The API will be available at `http://localhost:5000/`.

---

## Deployment (Render)

1. **Provision a PostgreSQL database** in Render.
2. **Add the `DATABASE_URL` environment variable** (Render does this if you link the database).
3. **Deploy the app** (Render will use `Procfile` and `requirements.txt`).
4. **App will automatically use PostgreSQL in production.**

---

## Configuration

- Edit `app/__init__.py` or use environment variables for:
  - `SECRET_KEY`
  - `MAIL_USERNAME` and `MAIL_PASSWORD` (use [App Passwords](https://support.google.com/accounts/answer/185833) if using Gmail)
- For local overrides, you can add an `instance/config.py` and load it if needed.

---

## Database

- **Local:** Uses SQLite by default for convenience (`database.db` in project root).
- **Production (Render):** Uses PostgreSQL via the `DATABASE_URL` environment variable.

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
| ...                             | ...    | ...                                  |

---

## Notes

- **Static files** (CSS, JS, images, audio) go in `app/static/`.
- **HTML templates** go in `app/templates/`.
- **Seed data** is auto-inserted on first run if the database is empty.
- Do **not commit** sensitive info (passwords, etc.) to the repo.

---

## License

MIT License

---

## Author

- [Mtulusehai-oss](https://github.com/tulusehai-oss)