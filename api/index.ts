// 🚀 Rip API Server (TypeScript version)
// Simple Hono-based API that works seamlessly with rip-server

import { Hono } from 'hono';

// Create the Hono application
const app = new Hono();

// Basic success route with timestamp
app.get('/', (c) => {
  return c.json({
    success: true,
    timestamp: new Date().toISOString(),
    message: "🚀 Rip API has PERFECT LOGGING!",
    server: "enterprise-grade-architecture"
  });
});

// Health check route (optional but good practice)
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'rip-api'
  });
});

// API info route
app.get('/info', (c) => {
  return c.json({
    name: 'Rip API Server',
    version: '1.0.0',
    framework: 'Hono',
    runtime: 'Bun',
    worker: process.pid
  });
});

// Determine what to export based on context
let exportValue;
if (import.meta.main) {
  // Running directly - start the server
  console.log("🚀 Starting Rip API Server...");

  const server = Bun.serve({
    port: 3000,
    fetch: app.fetch.bind(app)
  });

  console.log(`📡 Rip API Server running at http://localhost:${server.port}`);

  // Export simple object to prevent Bun auto-server detection
  exportValue = { message: "Server started manually" };
} else {
  // Being imported by rip-server - export the Hono app
  exportValue = app;
}

// Single export statement at top level
export default exportValue;