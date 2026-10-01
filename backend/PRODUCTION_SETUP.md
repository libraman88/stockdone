# StockDone Backend — production setup

## 1. PostgreSQL
Run the database files in this order:
1. `database/schema.sql`
2. `database/migrations/002_security_inventory_hardening.sql`
3. `database/seed.sql`

## 2. Environment
Copy `backend/.env.example` to `backend/.env` and set:
- `DATABASE_URL`
- `DEFAULT_BUSINESS_ID`
- `DEFAULT_BRANCH_ID`
- `JWT_SECRET`

Never commit `backend/.env`.

## 3. Owner account
The seed intentionally does not contain a real password. Create the first owner with a bcrypt password hash after choosing the password. Do not store plaintext passwords in SQL, source code, or Git.

## 4. Start
```bash
cd backend
npm install
npm run build
npm start
```

Health check: `GET /api/health`.

## Production notes
- Use HTTPS/TLS in front of the API.
- Keep PostgreSQL credentials and JWT secret outside Git.
- Back up PostgreSQL separately from the local desktop backup.
- The API currently uses the configured default business/branch IDs; multi-branch identity should be completed before deploying a multi-branch installation.
