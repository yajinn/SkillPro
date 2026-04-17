/**
 * Cursor Rules exporter — write .cursor/rules/<id>.mdc files.
 *
 * Port of scripts/converters/cursor.py.
 *
 * For each installed skill, reads the SKILL.md content, strips YAML
 * frontmatter, and creates a .mdc file with Cursor-compatible
 * frontmatter (description + alwaysApply: false).
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ScoredSkill } from '../types.js';
import { readInstalledSkill, skillDirCandidates } from '../install/installed.js';

/**
 * Regex to match YAML frontmatter at the start of a file.
 * Matches: ---\n<content>\n---\n
 */
const FRONTMATTER_RE = /^\s*---\s*\n([\s\S]*?)\n---\s*\n?/;

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Returns [frontmatter dict, body without frontmatter].
 *
 * Minimal parser: only handles `key: value` pairs on single lines.
 * Matches the parser SkillPro uses elsewhere.
 */
function parseFrontmatter(body: string): [Record<string, string>, string] {
  const match = FRONTMATTER_RE.exec(body);
  if (!match) return [{}, body];

  const fmText = match[1];
  const rest = body.slice(match[0].length);
  const fm: Record<string, string> = {};

  for (const line of fmText.split('\n')) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    // Strip matching quotes
    if (val.length >= 2 && val[0] === val[val.length - 1] && (val[0] === '"' || val[0] === "'")) {
      val = val.slice(1, -1);
    }
    fm[kv[1]] = val;
  }

  return [fm, rest];
}

/**
 * Escape a string for YAML frontmatter emission.
 * Always double-quotes to avoid edge cases.
 */
function escapeYamlString(s: string): string {
  const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Check for non-portable asset directories next to the installed skill.
 * Checks both project-scoped and home-scoped candidate dirs.
 */
function checkNonPortableAssets(projectDir: string, skillId: string): string[] {
  const warnings: string[] = [];
  for (const baseDir of skillDirCandidates(projectDir, skillId)) {
    if (!existsSync(baseDir)) continue;
    if (existsSync(join(baseDir, 'scripts'))) {
      warnings.push(
        `${skillId}: scripts/ directory not portable to Cursor -- skipped (only the markdown body was copied)`,
      );
    }
    if (existsSync(join(baseDir, 'references'))) {
      warnings.push(
        `${skillId}: references/ directory not portable to Cursor -- skipped (only the markdown body was copied)`,
      );
    }
    break;
  }
  return warnings;
}

/**
 * Export skills to Cursor rules format.
 *
 * For each skill:
 *   1. Read SKILL.md from ~/.claude/skills/<id>/SKILL.md
 *   2. Strip YAML frontmatter
 *   3. Create .mdc with Cursor-compatible frontmatter
 *   4. Write to <projectDir>/.cursor/rules/<id>.mdc
 */
export function exportToCursor(
  skills: ScoredSkill[],
  projectDir: string,
): void {
  const rulesDir = join(projectDir, '.cursor', 'rules');
  mkdirSync(rulesDir, { recursive: true });

  for (const skill of skills) {
    const found = readInstalledSkill(projectDir, skill.id);
    if (!found) {
      process.stderr.write(
        `  \u2718 ${skill.id}: SKILL.md not found, skipping Cursor export\n`,
      );
      continue;
    }

    // Check for non-portable assets and warn
    const warnings = checkNonPortableAssets(projectDir, skill.id);
    for (const w of warnings) {
      process.stderr.write(`  \u26A0 ${w}\n`);
    }

    const [fm, body] = parseFrontmatter(found.content);

    let description = (fm.description || '').trim();
    if (!description) {
      process.stderr.write(
        `  \u26A0 ${skill.id}: no description in SKILL.md frontmatter -- Cursor will show an empty tooltip\n`,
      );
      description = skill.id;
    }

    const bodyStripped = body.replace(/^\n+/, '').replace(/\n+$/, '');

    const mdcContent =
      '---\n' +
      `description: ${escapeYamlString(description)}\n` +
      'alwaysApply: false\n' +
      '---\n\n' +
      bodyStripped +
      '\n';

    const outPath = join(rulesDir, `${skill.id}.mdc`);
    writeFileSync(outPath, mdcContent, 'utf-8');
    process.stderr.write(`  \u2713 ${skill.id} -> .cursor/rules/${skill.id}.mdc\n`);
  }
}
