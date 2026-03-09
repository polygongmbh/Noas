/**
 * Main Server Entry Point
 * 
 * Initializes Express server, sets up middleware, and starts listening.
 * Handles CORS and JSON parsing.
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from './config.js';
import { router } from './routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();

// Parse JSON request bodies
app.use(express.json({ limit: '4mb' }));

// CORS middleware - allows cross-origin requests from any origin
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve landing page and static assets
app.use(express.static(join(__dirname, 'public'), { extensions: ['html'] }));

// Mount all API routes
app.use(router);

// Start server if not in test mode
if (!config.isTest) {
  app.listen(config.port, () => {
    console.log(`Noas server running on port ${config.port}`);
    console.log(`Domain: ${config.domain}`);
  });
}

export { app };
