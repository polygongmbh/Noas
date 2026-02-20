/**
 * Database Setup Script
 * 
 * Creates the database schema (tables, indexes, constraints).
 * Run this once after creating the database: npm run db:setup
 */

import { pool } from './pool.js';

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(32) UNIQUE NOT NULL,
  public_key VARCHAR(64) NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  relays JSONB DEFAULT '[]'::jsonb,
  profile_picture BYTEA,
  profile_picture_type VARCHAR(100),
  profile_picture_updated_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT username_format CHECK (username ~ '^[a-z0-9_]{3,32}$')
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_public_key ON users(public_key);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_picture BYTEA;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_picture_type VARCHAR(100);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_picture_updated_at TIMESTAMP;
`;

/**
 * Set up the database schema
 * Creates tables and indexes if they don't exist
 */
async function setup() {
  try {
    console.log('Setting up database...');
    await pool.query(schema);
    console.log('✓ Database setup complete');
    await pool.end();
  } catch (error) {
    console.error('Database setup failed:', error);
    process.exit(1);
  }
}

setup();
