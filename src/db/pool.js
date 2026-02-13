/**
 * Database Connection Pool
 * 
 * Manages PostgreSQL database connections using a connection pool.
 * Provides query function for executing SQL queries.
 */

import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

// Create PostgreSQL connection pool
export const pool = new Pool({
  connectionString: config.databaseUrl,
});

/**
 * Execute a SQL query against the database
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters for parameterized queries
 * @returns {Promise} Query result object
 */
export async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

/**
 * Close the database connection pool
 */
export async function closePool() {
  await pool.end();
}
