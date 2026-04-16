/**
 * Track installed skills in a persistent selections file.
 *
 * Location: ~/.config/skillpro/selections.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { SelectionsFile, SelectionEntry } from '../types.js';

function selectionsPath(): string {
  return join(homedir(), '.config', 'skillpro', 'selections.json');
}

/**
 * Load the selections file. Returns a default empty structure
 * if the file doesn't exist or is malformed.
 */
export function loadSelections(): SelectionsFile {
  const path = selectionsPath();
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as SelectionsFile;
    // Validate minimum shape
    if (
      typeof data === 'object' &&
      data !== null &&
      typeof data.version === 'number' &&
      typeof data.selections === 'object' &&
      data.selections !== null
    ) {
      return data;
    }
  } catch {
    // File doesn't exist or is invalid — return default
  }
  return {
    version: 1,
    updated: new Date().toISOString(),
    selections: {},
  };
}

/**
 * Save a selection entry for a skill. Merges into existing selections.
 */
export function saveSelection(skillId: string, entry: SelectionEntry): void {
  const selections = loadSelections();
  selections.selections[skillId] = entry;
  selections.updated = new Date().toISOString();
  persist(selections);
}

/**
 * Remove a selection entry for a skill.
 */
export function removeSelection(skillId: string): void {
  const selections = loadSelections();
  delete selections.selections[skillId];
  selections.updated = new Date().toISOString();
  persist(selections);
}

/**
 * Write the selections file to disk, creating directories as needed.
 */
function persist(data: SelectionsFile): void {
  const path = selectionsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
