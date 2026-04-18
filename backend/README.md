# BookEase Backend

## Tech Stack
- Node.js + Express.js
- MongoDB + Mongoose
- JWT Authentication
- bcryptjs for password hashing

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables in `.env`

3. Start MongoDB

4. Seed the database:
```bash
npm run seed
```

5. Start the server:
```bash
npm run dev
```

## API Endpoints

### Auth
- `POST /api/auth/register` - Register
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get profile
- `PUT /api/auth/me` - Update profile

### Services
- `GET /api/services` - List services
- `POST /api/services` - Create service request
- `POST /api/services/:id/bids` - Submit bid

### Bookings
- `POST /api/bookings` - Create booking
- `GET /api/bookings` - My bookings
- `POST /api/bookings/:id/rating` - Rate booking

### Admin
- `GET /api/admin/dashboard` - Dashboard stats
- `GET /api/admin/users` - Manage users
- `GET /api/admin/reviews` - Moderate reviews
