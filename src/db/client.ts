import Database from 'better-sqlite3';
import { getDbPath, ensureStorageDirs } from '../storage/paths.js';
import { runMigrations } from './migrations.js';

let defaultDb: Database.Database | null = null;

export function initDatabase(dbPath?: string): Database.Database {
  if (!dbPath || dbPath !== ':memory:') {
    ensureStorageDirs();
  }

  const resolvedPath = dbPath || getDbPath();
  const db = new Database(resolvedPath);

  // Enable WAL mode for better concurrency and performance (except in-memory)
  if (resolvedPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');

  // Initialize and migrate schema
  runMigrations(db);

  return db;
}

export function getDatabase(): Database.Database {
  if (!defaultDb) {
    defaultDb = initDatabase();
  }
  return defaultDb;
}

export function closeDatabase(): void {
  if (defaultDb) {
    defaultDb.close();
    defaultDb = null;
  }
}
