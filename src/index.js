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

// CORS middleware - allows cross-origin requests with credentials support
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Explicitly allow requests from any browser origin.
  // With credentials enabled, '*' is not valid, so reflect the request origin.
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }

  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve landing page and static assets
app.use(express.static(join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/verify', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'verify.html'));
});

// Mount all API routes
app.use(router);

// Start server if not in test mode
if (!config.isTest) {
  const server = app.listen(config.port, () => {
    console.log(`Noas server running on port ${config.port}`);
    console.log(`Domain: ${config.domain}`);
  });

  // Handle port conflict gracefully
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use.`);
      console.error('Try one of these solutions:');
      console.error('1. Stop the existing server: docker stop noas');
      console.error('2. Use a different port: change PORT in .env file');
      console.error('3. Check running processes: ps aux | grep node');
      process.exit(1);
    } else {
      console.error('Server error:', error);
      process.exit(1);
    }
  });
}

export { app };
