/**
 * User configuration for auto-update behavior.
 * Stored at ~/.config/skillpro/config.json
 *
 * Default: passive notifications, no auto-apply. User must opt-in.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

// ─── Types ────────────────────────────────────────────────────────────

export interface UpdateConfig {
  check_cli: boolean;
  check_registry: boolean;
  check_skills: boolean;
  auto_apply_skills: boolean;
  skip_breaking_changes: boolean;
}

export interface NotifyConfig {
  breaking_changes: 'always' | 'never' | 'warn';
  new_skills: 'always' | 'weekly' | 'never';
  trending: boolean;
}

export interface SkillProConfig {
  version: 1;
  update: UpdateConfig;
  notify: NotifyConfig;
  telemetry: boolean;
}

// ─── Defaults ─────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: SkillProConfig = {
  version: 1,
  update: {
    check_cli: true,           // daily check for newer skillpro
    check_registry: true,      // fetch registry overlay every run (fast, ETag)
    check_skills: true,        // check installed skills for updates
    auto_apply_skills: false,  // passive by default
    skip_breaking_changes: true, // if auto-apply enabled, skip breaking
  },
  notify: {
    breaking_changes: 'always',
    new_skills: 'weekly',
    trending: false,
  },
  telemetry: false, // privacy first
};

// ─── Paths ────────────────────────────────────────────────────────────

export function getConfigDir(): string {
  return join(homedir(), '.config', 'skillpro');
}

function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

// ─── Read / Write ─────────────────────────────────────────────────────

let _cache: SkillProConfig | null = null;

export function loadConfig(): SkillProConfig {
  if (_cache) return _cache;

  const path = getConfigPath();
  if (!existsSync(path)) {
    _cache = DEFAULT_CONFIG;
    return _cache;
  }

  try {
    const content = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(content) as Partial<SkillProConfig>;
    // Merge with defaults for forward compatibility
    _cache = {
      version: 1,
      update: { ...DEFAULT_CONFIG.update, ...parsed.update },
      notify: { ...DEFAULT_CONFIG.notify, ...parsed.notify },
      telemetry: parsed.telemetry ?? DEFAULT_CONFIG.telemetry,
    };
    return _cache;
  } catch {
    // Corrupt file — use defaults
    _cache = DEFAULT_CONFIG;
    return _cache;
  }
}

export function saveConfig(config: SkillProConfig): void {
  const path = getConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
  _cache = config;
}

/** Write default config file if it doesn't exist. */
export function ensureConfigFile(): void {
  const path = getConfigPath();
  if (!existsSync(path)) {
    saveConfig(DEFAULT_CONFIG);
  }
}
