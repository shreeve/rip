/**
 * Legacy server.ts (GUTTED): preserved HTTPS/TLS snippets for migration.
 *
 * This file is intentionally non-functional and kept only to retain small
 * pieces we still want to port into the new per-worker LB server
 * in `packages/server/server.ts`.
 *
 * References for cert generation and CA usage:
 * - HTTPS-SETUP.md
 * - CURL-HTTPS-GUIDE.md
 */

/**
 * HTTPS/TLS snippet preserved from legacy for porting:
 *
 * Example (Bun HTTPS server):
 *
 *   const httpsServer = Bun.serve({
 *     port: httpsPort,
 *     tls: { cert, key },
 *     fetch: handleRequest,
 *   })
 *
 * Where:
 * - httpsPort: number
 * - cert: string (PEM)
 * - key: string (PEM)
 *
 * Legacy code lines for reference:
 *
 *   const { httpsPort, cert, key } = this.httpsConfig
 *   this.httpsServer = Bun.serve({
 *     port: httpsPort,
 *     tls: { cert, key },
 *     fetch: this.handleRequest.bind(this),
 *   })
 *
 * Porting guidance:
 * - Add optional HTTPS listener alongside HTTP in the new LB (`LBServer`).
 * - Reuse the same fetch handler used by HTTP so both endpoints share logic.
 * - Extend flags to include httpsPort, cert path, key path (and optionally CA).
 */

export {}
