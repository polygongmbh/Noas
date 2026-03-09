/**
 * Configuration Module
 * 
 * Loads and exports application configuration from environment variables.
 * Handles .env file loading and provides typed config object for the app.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get the current directory for ES modules
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env file
dotenv.config({ path: join(__dirname, '../.env') });

// Export configuration object with all app settings
export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL,
  domain: process.env.DOMAIN || `localhost:${process.env.PORT || '3000'}`,
  isTest: process.env.NODE_ENV === 'test',
};

// Ensure domain matches the actual port being used
if (!process.env.DOMAIN) {
  config.domain = `localhost:${config.port}`;
}
