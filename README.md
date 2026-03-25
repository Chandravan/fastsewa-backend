# FastSewa Backend

Node.js + Express + MongoDB backend for the FastSewa frontend.

## Features

- JWT-based auth with register, login, and profile APIs
- Service catalog APIs backed by MongoDB
- Order creation, listing, detail, CCAvenue payment initiation/callback, and document metadata APIs
- Client dashboard overview API with stats, recent orders, and reminders
- Admin workspace APIs for control-tower metrics, users, services, orders, bulk actions, and audit logs
- Scoped admin permissions for dashboard, orders, services, users, and audit visibility
- SMTP-backed welcome, order, payment, and admin alert emails with graceful fallback when SMTP is not configured
- Seed script with demo users, services, and sample orders

## Quick Start

1. Copy `backend/.env.example` to `backend/.env`
2. Make sure MongoDB is running locally
3. Add your CCAvenue merchant credentials and public callback URLs
4. Add SMTP credentials if you want live emails and admin alerts
5. Install backend dependencies
6. Seed the database
7. Start the API

```bash
npm --prefix backend install
npm run seed:api
npm run dev:api
```

The API will run on `http://localhost:5000` by default.

For local CCAvenue testing, `BACKEND_PUBLIC_URL` must be a publicly reachable HTTPS URL. In practice that means deploying the backend or exposing it with a tunnel before the gateway can POST back to `/api/payments/ccavenue/callback`.

## Demo Accounts

- Admin: `admin@fastsewa.in`
- Client: `demo@fastsewa.in`
- Default password: the values from `SEED_ADMIN_PASSWORD` and `SEED_CLIENT_PASSWORD`

## API Routes

### Health

- `GET /api/health`

### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/change-password` (authenticated)
- `GET /api/auth/me` (authenticated)

### Services

- `GET /api/services`
- `GET /api/services/:serviceId`
- `GET /api/services/admin/catalog` (admin, `services.view`)
- `POST /api/services` (admin, `services.manage`)
- `PUT /api/services/:serviceId` (admin, `services.manage`)
- `DELETE /api/services/:serviceId` (admin archive, `services.archive`)
- `POST /api/services/:serviceId/restore` (admin, `services.restore`)
- `POST /api/services/bulk` (admin, `services.bulk`)

### Dashboard

- `GET /api/dashboard/overview`
- `GET /api/dashboard/admin-overview` (admin, `dashboard.view`)

### Users

- `GET /api/users` (admin, `users.view`)
- `POST /api/users` (admin, `users.manage`)
- `PUT /api/users/:userId` (admin, `users.manage`)
- `PUT /api/users/:userId/status` (admin, `users.disable`)
- `DELETE /api/users/:userId` (admin, `users.delete`)
- `POST /api/users/bulk` (admin, `users.bulk`)
- `GET /api/users/profile`
- `PUT /api/users/profile`

### Orders

- `GET /api/orders`
- `POST /api/orders`
- `GET /api/orders/:orderId`
- `POST /api/orders/:orderId/documents`
- `PUT /api/orders/:orderId/admin` (admin, `orders.manage`)
- `POST /api/orders/bulk/admin` (admin, `orders.bulk`)
- `POST /api/orders/:orderId/payments/ccavenue/initiate`

### Payments

- `POST /api/payments/ccavenue/callback`

### Audit Logs

- `GET /api/audit-logs` (admin, `audit.view`)

## Notes

- Service pricing is stored as `basePrice`, with discount-ready fields in the schema.
- API responses also expose a frontend-friendly `price`/`finalPrice`.
- File uploads are modeled as document metadata for now; storage integration can be added later.
- Admin APIs use permission-gated middleware, so scoped admins only see and mutate the resources their permission set allows.
- Audit logging is enabled for sensitive admin operations such as service, user, and order management actions.
- CCAvenue uses the billing-page redirect flow, so the frontend receives an encrypted request from the backend and submits it to CCAvenue with the merchant access code.
- If `SMTP_HOST` and `SMTP_FROM` are missing, notification hooks stay enabled in code but skip actual delivery and log the skip locally.
- `ADMIN_ALERT_EMAILS` accepts a comma-separated list. If left empty, admin alerts fall back to `SUPPORT_EMAIL`.
- In non-production environments, forgot-password responses can include a preview reset URL to help with local testing when SMTP is not configured.
