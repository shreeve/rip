<img src="/docs/rip-icon-512wa.png" style="width:50px" /> <br>

# Labs Server - Rip Implementation

**Drop-in replacement for BHVR Labs server using Rip**

This is a Rip-based implementation that mimics the BHVR Labs server API, allowing the React client to work seamlessly with our Rip backend.

## Features

- ✅ **API Compatible** - Same endpoints as original server
- ✅ **CORS Enabled** - Works with client on port 8205
- ✅ **SQLite Database** - Using Drizzle ORM with rip-schema
- ✅ **Auth Flow** - Email code-based authentication
- ✅ **All Endpoints** - Config, auth, users, tests, orders, results

## Quick Start

```bash
# From monorepo root
bun install

# Database setup (run these from the app directory)
cd apps/labs/server
bun db:push
bun db:seed
cd ../../..

# Start server (from monorepo root)
bun server apps/labs/server
```

## API Endpoints

All endpoints match the original BHVR server:

- `GET /ping` - Health check
- `GET /config` - Client configuration
- `POST /auth/code` - Request auth code
- `POST /auth/verify` - Verify auth code
- `GET /user/me` - Get current user
- `PATCH /user/me` - Update current user
- `GET /users` - List all users (admin)
- `GET /tests` - Get available tests
- `POST /orders` - Create order
- `GET /orders` - Get user's orders
- `GET /results` - Get user's results

## Test Credentials

After seeding:
- Email: `test@example.com`
- Admin user with test data

## Architecture

```
index.rip         # Main server with all routes
db/schema.rip     # Database schema (converted from Prisma)
db/labs.db        # SQLite database
seed.rip          # Test data seeder
```

## Differences from Original

1. **Database**: SQLite instead of MySQL (easier setup)
2. **Auth**: Simplified JWT (mock tokens)
3. **Emails**: Console logging instead of sending
4. **Payments**: Mock processing

## Development

The server runs on port 8305 to match the original. The React client on port 8205 is configured to use this port.

To test:
1. Keep your BHVR client running on 8205
2. Stop the original server
3. Start this Rip server
4. The client should work seamlessly!

## License

MIT

## Contributing

Part of the Rip ecosystem examples.

---

Built with ❤️ for the Bun community