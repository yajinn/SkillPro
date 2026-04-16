/**
 * CLAUDE.md exporter — bundle skills into CLAUDE.md managed section.
 *
 * Same marker pattern and merge logic as the Codex exporter,
 * but targets CLAUDE.md instead of AGENTS.md.
 *
 *   <!-- skillforge:start -->
 *   # SkillForge skills
 *   ... generated content ...
 *   <!-- skillforge:end -->
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { ScoredSkill } from '../types.js';

const START_MARKER = '<!-- skillforge:start -->';
const END_MARKER = '<!-- skillforge:end -->';

/**
 * Regex to match YAML frontmatter at the start of a file.
 */
const FRONTMATTER_RE = /^\s*---\s*\n([\s\S]*?)\n---\s*\n?/;

/**
 * Parse YAML frontmatter.
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
    if (val.length >= 2 && val[0] === val[val.length - 1] && (val[0] === '"' || val[0] === "'")) {
      val = val.slice(1, -1);
    }
    fm[kv[1]] = val;
  }

  return [fm, rest];
}

/**
 * Try to read the SKILL.md content for a given skill.
 */
function readSkillMd(skillId: string): string | null {
  const path = join(homedir(), '.claude', 'skills', skillId, 'SKILL.md');
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Render a single skill as a ## section for the managed block.
 */
function renderSkillSection(skill: ScoredSkill, mdContent: string): string {
  const [fm, body] = parseFrontmatter(mdContent);

  let description = (fm.description || '').trim();
  if (!description) {
    description = skill.id;
  }

  const bodyStripped = body.replace(/^\n+/, '').replace(/\n+$/, '');

  return (
    `## ${skill.id}\n` +
    `_Activate when: ${description}_\n\n` +
    `${bodyStripped}\n`
  );
}

/**
 * Build the full managed block bracketed by markers.
 */
function renderManagedSection(skills: ScoredSkill[]): string {
  const sections: string[] = [];

  for (const skill of skills) {
    const mdContent = readSkillMd(skill.id);
    if (!mdContent) {
      process.stderr.write(
        `  \u2718 ${skill.id}: SKILL.md not found, skipping CLAUDE.md export\n`,
      );
      continue;
    }
    sections.push(renderSkillSection(skill, mdContent));
  }

  let inner: string;
  if (sections.length === 0) {
    inner = '_No skills installed. Run `/sf confirm` first._\n';
  } else {
    inner = '# SkillForge skills\n\n' + sections.join('\n---\n\n');
  }

  return `${START_MARKER}\n${inner}\n${END_MARKER}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regex to find the managed section.
 */
const MANAGED_RE = new RegExp(
  escapeRegex(START_MARKER) + '[\\s\\S]*?' + escapeRegex(END_MARKER),
);

/**
 * Generate CLAUDE.md with managed section.
 *
 * Merge semantics (same as Codex):
 *   - If CLAUDE.md exists with markers -> replace managed section
 *   - If CLAUDE.md exists without markers -> append managed section
 *   - If no CLAUDE.md -> create new file with managed section
 */
export function generateClaudeMd(
  skills: ScoredSkill[],
  projectDir: string,
): void {
  const claudePath = join(projectDir, 'CLAUDE.md');
  const managedBlock = renderManagedSection(skills);

  let existing = '';
  try {
    existing = readFileSync(claudePath, 'utf-8');
  } catch {
    // File doesn't exist
  }

  let content: string;

  if (!existing.trim()) {
    // Brand new file
    content = managedBlock + '\n';
  } else if (MANAGED_RE.test(existing)) {
    // Replace existing managed section
    content = existing.replace(MANAGED_RE, managedBlock);
    if (!content.endsWith('\n')) {
      content += '\n';
    }
  } else {
    // Append managed section
    content = existing.trimEnd() + '\n\n' + managedBlock + '\n';
  }

  mkdirSync(dirname(claudePath), { recursive: true });
  writeFileSync(claudePath, content, 'utf-8');
  process.stderr.write(`  \u2713 CLAUDE.md updated\n`);
}
