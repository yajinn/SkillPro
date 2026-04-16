// ─── Database Detection ─────────────────────────────────────────────
// Ported from detect.sh section 5: Database Detection
// ─────────────────────────────────────────────────────────────────────

import { join } from 'node:path';
import {
  pkgHas,
  pipHas,
  composerHas,
  pubHas,
  fileExists,
  fileContains,
  dirExists,
} from './manifest-readers.js';

/**
 * Detect the primary database / ORM from dependencies and config files.
 * Returns a string like "postgresql+prisma", "mongodb", "sqlite", etc., or null.
 */
export function detectDatabase(dir: string, language: string): string | null {
  // ── Prisma (highest priority — has its own schema file) ────────────
  if (dirExists(dir, 'prisma') || fileExists(join(dir, 'prisma/schema.prisma'))) {
    let db = 'prisma';
    if (fileExists(join(dir, 'prisma/schema.prisma'))) {
      const schema = join(dir, 'prisma/schema.prisma');
      if (fileContains(schema, 'postgresql')) db = 'postgresql+prisma';
      else if (fileContains(schema, 'mysql')) db = 'mysql+prisma';
      else if (fileContains(schema, 'sqlite')) db = 'sqlite+prisma';
    }
    return db;
  }

  // ── Drizzle ────────────────────────────────────────────────────────
  if (dirExists(dir, 'drizzle') || fileExists(join(dir, 'drizzle.config.ts'))) {
    return 'drizzle';
  }

  // ── MongoDB ────────────────────────────────────────────────────────
  if (pkgHas(dir, '"mongoose"') || pipHas(dir, 'pymongo')) {
    return 'mongodb';
  }

  // ── PostgreSQL ─────────────────────────────────────────────────────
  if (pkgHas(dir, '"pg"') || pipHas(dir, 'psycopg') || composerHas(dir, 'doctrine/dbal')) {
    return 'postgresql';
  }

  // ── SQLAlchemy ─────────────────────────────────────────────────────
  if (pipHas(dir, 'sqlalchemy')) {
    return 'sqlalchemy';
  }

  // ── WordPress = MySQL ──────────────────────────────────────────────
  if (fileExists(join(dir, 'wp-config.php'))) {
    return 'mysql';
  }

  // ── MySQL ──────────────────────────────────────────────────────────
  if (pkgHas(dir, '"mysql2"') || composerHas(dir, 'mysql')) {
    return 'mysql';
  }

  // ── Dart/Flutter databases ─────────────────────────────────────────
  if (pubHas(dir, 'cloud_firestore') || pubHas(dir, 'firebase_firestore')) {
    return 'firestore';
  }
  if (pubHas(dir, 'drift')) {
    return 'drift';
  }
  if (pubHas(dir, 'isar')) {
    return 'isar';
  }
  if (pubHas(dir, 'hive') || pubHas(dir, 'hive_flutter')) {
    return 'hive';
  }

  // ── SQLite ─────────────────────────────────────────────────────────
  if (pkgHas(dir, '"better-sqlite3"') || pipHas(dir, 'sqlite') || pubHas(dir, 'sqflite')) {
    return 'sqlite';
  }

  // ── Redis (can be secondary, but return if nothing else found) ─────
  if (pkgHas(dir, '"redis"') || pipHas(dir, 'redis')) {
    return 'redis';
  }

  return null;
}
