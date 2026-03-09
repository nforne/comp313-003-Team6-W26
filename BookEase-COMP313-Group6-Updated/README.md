# BookEase - Local Service Booking Platform

> COMP313 - Group 6 Project  
> A full-stack service booking marketplace built with React + Express + MongoDB

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **MongoDB** >= 6.0 (running on `localhost:27017`)

### 1. Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Configure Environment

Edit `backend/.env` if needed (defaults work out of the box):

```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/bookease
JWT_SECRET=bookease_jwt_secret_key_2026_comp313
JWT_EXPIRES_IN=7d
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

### 3. Seed Database (Optional)

```bash
cd backend
node src/utils/seed.js
```

This creates demo accounts:

| Role     | Email               | Password    |
|----------|---------------------|-------------|
| Admin    | admin@bookease.com  | password123 |
| Customer | alice@example.com   | password123 |
| Customer | bob@example.com     | password123 |
| Customer | carol@example.com   | password123 |
| Provider | david@example.com   | password123 |
| Provider | emma@example.com    | password123 |
| Provider | frank@example.com   | password123 |
| Provider | grace@example.com   | password123 |
| Provider | henry@example.com   | password123 |

### 4. Run the Application

**Development mode (two terminals):**

```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm run dev
```

**Production mode (single server):**

```bash
# Build frontend
cd frontend
npm run build

# Start backend (serves frontend static files)
cd ../backend
npm start
```

Then open `http://localhost:5000` in your browser.

---

## Tech Stack

### Backend
- **Express.js** - REST API framework
- **MongoDB + Mongoose** - Database & ODM
- **JWT** - Authentication
- **bcryptjs** - Password hashing
- **express-validator** - Input validation

### Frontend
- **React 18** - UI library
- **Vite** - Build tool
- **React Router v6** - Client-side routing
- **TailwindCSS** - Utility-first CSS
- **Framer Motion** - Animations
- **Lucide React** - Icons
- **Axios** - HTTP client
- **React Hot Toast** - Notifications

---

## Project Structure

```
booking-platform/
├── backend/
│   ├── src/
│   │   ├── config/         # DB & env configuration
│   │   ├── models/         # Mongoose models
│   │   ├── controllers/    # Route handlers
│   │   ├── routes/         # API routes
│   │   ├── middleware/      # Auth, role, error middleware
│   │   ├── utils/          # Validators & seed script
│   │   └── app.js          # Express app setup
│   ├── server.js           # Entry point
│   ├── .env                # Environment variables
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api/            # Axios API modules
│   │   ├── app/            # App component & routing
│   │   ├── auth/           # Auth provider & guards
│   │   ├── components/     # Reusable components
│   │   ├── hooks/          # Custom hooks
│   │   ├── layouts/        # Layout components
│   │   └── pages/          # Page components
│   │       ├── public/     # Home, Services, Login, Register
│   │       ├── customer/   # Customer dashboard & bookings
│   │       ├── provider/   # Provider dashboard & services
│   │       ├── admin/      # Admin management pages
│   │       └── viewer/     # Favorites
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── package.json
└── README.md
```

---

## Features

### Customer
- Post service requests with budget and schedule
- Browse and compare provider bids
- Accept bids and create bookings
- Track booking status
- Rate and review providers

### Provider
- Browse open service requests
- Submit competitive bids
- Manage bookings and availability
- View earnings and ratings

### Admin
- System-wide dashboard with statistics
- User management (activate/deactivate/delete)
- Provider oversight
- Booking monitoring
- Review moderation

---

## API Endpoints

| Method | Endpoint                    | Description              | Auth     |
|--------|-----------------------------|--------------------------|----------|
| POST   | /api/auth/register          | Register new user        | Public   |
| POST   | /api/auth/login             | Login                    | Public   |
| GET    | /api/auth/me                | Get current user         | Required |
| GET    | /api/services               | List all services        | Public   |
| GET    | /api/services/:id           | Get service detail       | Public   |
| POST   | /api/services               | Create service request   | Customer |
| POST   | /api/services/:id/bid       | Submit bid               | Provider |
| GET    | /api/bookings               | Get my bookings          | Required |
| POST   | /api/bookings               | Create booking           | Customer |
| PATCH  | /api/bookings/:id/status    | Update booking status    | Required |
| POST   | /api/bookings/:id/rating    | Rate a booking           | Customer |
| GET    | /api/availability           | Get my availability      | Provider |
| POST   | /api/availability/bulk      | Set weekly schedule      | Provider |
| GET    | /api/admin/dashboard        | Admin dashboard stats    | Admin    |
| GET    | /api/admin/users            | List all users           | Admin    |
| GET    | /api/admin/providers        | List providers           | Admin    |
| GET    | /api/admin/bookings         | List all bookings        | Admin    |

---

## UI Design

The frontend follows an **Apple-inspired design language**:
- Frosted glass (glassmorphism) cards and navigation
- Smooth animations with Framer Motion
- Rounded corners and soft shadows
- Clean typography with SF-style system fonts
- Gradient accents and subtle hover effects

---

## License

COMP313 - Group 6 Academic Project © 2026
