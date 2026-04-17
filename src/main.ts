import { parseArgs } from 'node:util';
import type { CliArgs } from './types.js';
import { printBanner, getVersion } from './ui/banner.js';
import { Spinner } from './ui/spinner.js';
import { bold, orange, dim, gray, red, yellow, symbols } from './ui/colors.js';
import { detectStack } from './detect/stack.js';
import { getStacks, matchSkills } from './registry.js';
import type { MatchedSkill } from './registry.js';
import { installAll } from './install/index.js';
import { exportSkills } from './export/index.js';
import { generateClaudeMd } from './export/claude.js';
import { loadConfig, ensureConfigFile } from './update/config.js';
import { checkCliUpdate } from './update/cli-check.js';
import { refreshRegistry } from './update/registry-refresh.js';
import { checkSkillUpdates } from './update/skill-check.js';

// ─── CLI Args ─────────────────────────────────────────────────────────

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      yes: { type: 'boolean', short: 'y', default: false },
      'dry-run': { type: 'boolean', default: false },
      verbose: { type: 'boolean', short: 'v', default: false },
      all: { type: 'boolean', default: false },
      agent: { type: 'string', short: 'a', default: '' },
      sources: { type: 'string', default: '' },
      export: { type: 'string', default: '' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', default: false },
    },
    strict: true,
  });

  return {
    yes: values.yes ?? false,
    dryRun: values['dry-run'] ?? false,
    verbose: values.verbose ?? false,
    agents: (values.agent as string).split(',').filter(Boolean),
    sources: (values.sources as string).split(',').filter(Boolean),
    exportTarget: (values.export as string) || null,
    help: values.help ?? false,
    version: values.version ?? false,
  };
}

function printHelp(): void {
  process.stderr.write(`
  ${bold('Usage:')} npx skillpro [options]

  ${bold('Options:')}
    -y, --yes          Skip confirmation, install all recommended
    -s, --select       Interactive multi-select (space toggle, enter confirm)
    --dry-run          Show skills without installing
    --all              Show all matches including alternatives
    -v, --verbose      Show error details
    -a, --agent <ids>  Target specific agents (cursor,claude-code,codex)
    --export <target>  Export after install (cursor, codex)
    -h, --help         Show this help
    --version          Show version

  ${bold('Examples:')}
    ${dim('$')} npx skillpro                ${dim('# show list, ask Y/n, install')}
    ${dim('$')} npx skillpro -y             ${dim('# install all without asking')}
    ${dim('$')} npx skillpro -s             ${dim('# pick skills with space/enter')}
    ${dim('$')} npx skillpro --dry-run      ${dim('# preview only')}
    ${dim('$')} npx skillpro --export cursor ${dim('# also export to .cursor/rules/')}
\n`);
}

// ─── Format helpers ───────────────────────────────────────────────────

function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n > 0) return String(n);
  return '';
}

function sourceTag(skill: MatchedSkill): string {
  if (skill.source === 'Anthropic Skills') return bold(orange('anthropic'));
  const installs = formatInstalls(skill.weekly_installs ?? 0);
  if (installs) return orange(installs);
  const stars = skill.github_stars ?? 0;
  if (stars > 0) return dim(`${symbols.bullet} ${formatInstalls(stars)}`);
  return '';
}

// ─── Main ─────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  const args = parseCliArgs();
  const showAll = process.argv.includes('--all');

  if (args.version) {
    process.stdout.write(`${getVersion()}\n`);
    return;
  }

  if (args.help) {
    printBanner();
    printHelp();
    return;
  }

  printBanner();
  const spinner = new Spinner();

  // ─── Step 0: Ensure config file + parallel auto-update checks ──────
  ensureConfigFile();
  const config = loadConfig();

  // Kick off auto-update checks in parallel (non-blocking)
  const cliUpdatePromise = config.update.check_cli
    ? checkCliUpdate(getVersion()).catch(() => null)
    : Promise.resolve(null);
  const registryRefreshPromise = config.update.check_registry
    ? refreshRegistry().catch(() => null)
    : Promise.resolve(null);

  // ─── Step 1: Detect stack ──────────────────────────────────────────
  spinner.start('Scanning project...');
  const stacks = getStacks();
  const detected = detectStack(process.cwd(), stacks);
  spinner.stop();

  printDetectionReport(detected);

  // ─── Step 1.5: Auto-update notifications (non-blocking) ────────────
  await showUpdateNotifications(cliUpdatePromise, registryRefreshPromise, config);

  // ─── Step 2: Match & rank skills ───────────────────────────────────
  spinner.start('Matching skills...');
  const detectedIds = detected.all.map((s) => s.id);
  const result = matchSkills(detectedIds, detected.language, detected.dependencies);

  spinner.succeed(
    `${bold(String(result.recommended.length))} skills ${dim(`(from ${result.totalMatched} matches)`)}`,
  );
  if (result.alternatives.length > 0) {
    process.stderr.write(`  ${dim(`${result.alternatives.length} alternatives hidden — use --all to see`)}\n`);
  }
  process.stderr.write('\n');

  if (result.recommended.length === 0) {
    process.stderr.write(`  ${dim('No matching skills found.')}\n\n`);
    return;
  }

  // ─── Dry-run: show preview list and exit ──────────────────────────
  if (args.dryRun) {
    printSkillList(result.recommended);
    if (showAll && result.alternatives.length > 0) {
      process.stderr.write(`  ${dim('─── Alternatives ───')}\n\n`);
      for (const alt of result.alternatives) {
        const tag = sourceTag(alt);
        process.stderr.write(
          `    ${dim(symbols.checkboxOff)} ${dim(alt.name)} ${tag} ${dim(`(alt of ${alt.alternativeOf})`)}\n`,
        );
      }
      process.stderr.write('\n');
    }
    process.stderr.write(`  ${dim('Dry run — nothing installed. Remove --dry-run to install.')}\n\n`);
    return;
  }

  // ─── Interactive multi-select (default) or --yes bypass ───────────
  let toInstall: MatchedSkill[];
  if (args.yes) {
    toInstall = result.recommended;
  } else {
    toInstall = await promptSelection(result.recommended);
    if (toInstall.length === 0) {
      process.stderr.write(`  ${dim('Nothing selected. Exiting.')}\n\n`);
      return;
    }
  }

  const asScoredSkills = toInstall.map((s) => ({
    ...s,
    version: null,
    commit_sha: null,
    tags: [],
    boost_when: [],
    penalize_when: [],
    default_for: [],
    match_language: null,
    match_framework: null,
    match_sub_framework: null,
    match_libraries: [],
    boost_libraries: [],
    category: s.matchedStack,
    popularity: 0,
    source: { name: s.source, install_url: s.install_url, commit_sha: null, type: s.source === 'skills.sh' ? 'skills-sh' : 'registry' },
    score: s.priority,
    relevance: 'recommended' as const,
  }));

  process.stderr.write(`  Installing ${bold(String(toInstall.length))} skills...\n`);
  const results = await installAll(asScoredSkills, args);

  const ok = results.filter((r) => r.success).length;
  const fail = results.filter((r) => !r.success).length;

  process.stderr.write('\n');
  if (ok > 0) process.stderr.write(`  ${orange(`${ok} installed`)}`);
  if (fail > 0) process.stderr.write(`  ${red(`${fail} failed`)}`);
  process.stderr.write('\n');

  const installed = results
    .filter((r) => r.success)
    .map((r) => asScoredSkills.find((s) => s.id === r.skill_id)!)
    .filter(Boolean);

  if (installed.length > 0) {
    generateClaudeMd(installed, process.cwd());
    process.stderr.write(`  ${dim('Updated CLAUDE.md')}\n`);
  }

  if (args.exportTarget) {
    exportSkills(installed, args.exportTarget, process.cwd());
    process.stderr.write(`  ${dim(`Exported to ${args.exportTarget}`)}\n`);
  }

  process.stderr.write('\n');
}

// ─── Skill list (always-shown preview) ────────────────────────────────

function printSkillList(skills: MatchedSkill[]): void {
  const byStack = new Map<string, MatchedSkill[]>();
  for (const skill of skills) {
    const stack = skill.matchedStack;
    if (!byStack.has(stack)) byStack.set(stack, []);
    byStack.get(stack)!.push(skill);
  }

  for (const [stack, groupSkills] of byStack) {
    process.stderr.write(`  ${bold(stack)} ${dim(`(${groupSkills.length})`)}\n`);
    for (const skill of groupSkills) {
      const tag = sourceTag(skill);
      process.stderr.write(
        `    ${orange(symbols.checkboxOn)} ${bold(skill.name)} ${tag}\n`,
      );
      if (skill.description) {
        process.stderr.write(`      ${gray(skill.description.slice(0, 80))}\n`);
      }
    }
    process.stderr.write('\n');
  }
}

// ─── Y/N confirm prompt ────────────────────────────────────────────────

async function confirmInstall(count: number): Promise<boolean> {
  if (!process.stdin.isTTY) {
    // Non-interactive: default to install (can override with --dry-run)
    return true;
  }

  process.stderr.write(
    `  ${bold('Install')} ${orange(String(count))} ${bold('skills?')} ${dim('[Y/n]')} `,
  );

  return new Promise<boolean>((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const handler = (data: string): void => {
      const ch = data[0] ?? '';
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', handler);
      process.stderr.write(`${ch}\n\n`);
      // Enter or Y/y → install. N/n → cancel.
      if (ch === 'n' || ch === 'N') resolve(false);
      else if (ch === '\x03' || ch === '\x04') resolve(false);  // Ctrl+C/D
      else resolve(true);
    };

    stdin.on('data', handler);
  });
}

// ─── Interactive Selection (--select flag) ─────────────────────────────

async function promptSelection(matched: MatchedSkill[]): Promise<MatchedSkill[]> {
  if (!process.stdin.isTTY) return matched; // non-interactive: install all

  // Adapt MatchedSkill → ScoredSkill for the multi-select UI
  const { multiSelect } = await import('./ui/multi-select.js');
  const asScored = matched.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    install_url: s.install_url,
    version: null,
    commit_sha: null,
    tags: [],
    boost_when: [],
    penalize_when: [],
    default_for: [],
    match_language: null,
    match_framework: null,
    match_sub_framework: null,
    match_libraries: [],
    boost_libraries: [],
    category: s.matchedStack,
    popularity: 0,
    source: { name: s.source, install_url: s.install_url, commit_sha: null, type: s.source === 'skills.sh' ? 'skills-sh' : 'registry' },
    score: s.priority,
    relevance: 'recommended' as const,
  }));

  process.stderr.write(`  ${bold('Select skills to install')} ${dim('(space toggle · a all · n none · enter install · q cancel)')}\n`);

  const picked = await multiSelect(asScored);
  const pickedIds = new Set(picked.map((p) => p.id));
  return matched.filter((m) => pickedIds.has(m.id));
}

// ─── Detection Report ──────────────────────────────────────────────────

/**
 * Render the detected project stack as a visually prominent block.
 * Grid of tech pills + language + package manager + workspaces.
 */
function printDetectionReport(detected: ReturnType<typeof detectStack>): void {
  const languageLabel = titleCase(detected.language);
  const pm = detected.packageManager;

  // Section header
  process.stderr.write(`  ${orange('◆')} ${bold('Detected project:')}\n\n`);

  // Language + package manager line
  process.stderr.write(
    `    ${dim('language')}  ${bold(orange(languageLabel))}   ${dim('·')}   ${dim('package manager')}  ${bold(pm)}\n`,
  );

  // Stack grid — all detected stacks as pills
  if (detected.all.length > 0) {
    process.stderr.write(`    ${dim('stacks')}    `);
    const pills = detected.all.map((s) => `${orange('✓')} ${bold(s.name)}`);
    // Layout as wrapped line with 3 per row max
    const perRow = 3;
    for (let i = 0; i < pills.length; i += perRow) {
      const row = pills.slice(i, i + perRow).join('   ');
      if (i === 0) process.stderr.write(`${row}\n`);
      else process.stderr.write(`              ${row}\n`);
    }
  } else {
    process.stderr.write(`    ${dim('stacks')}    ${dim('(no framework-specific stacks detected)')}\n`);
  }

  // Workspaces breakdown (for monorepos)
  if (detected.workspaces && detected.workspaces.length > 0) {
    process.stderr.write(`\n  ${orange('◆')} ${bold(`${detected.workspaces.length} workspaces:`)}\n\n`);
    const maxNameLen = Math.max(...detected.workspaces.map((w) => w.name.length));
    for (const ws of detected.workspaces) {
      const pad = ws.name.padEnd(maxNameLen);
      const wsStacks = ws.stacks.length > 0
        ? ws.stacks.map((s) => orange(s.name)).join(`${dim(' · ')}`)
        : dim('(no stacks)');
      process.stderr.write(`    ${dim('↳')} ${bold(pad)}   ${wsStacks}\n`);
    }
  }

  process.stderr.write('\n');
}

function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Update Notifications ──────────────────────────────────────────────

async function showUpdateNotifications(
  cliUpdatePromise: Promise<Awaited<ReturnType<typeof checkCliUpdate>> | null>,
  registryRefreshPromise: Promise<Awaited<ReturnType<typeof refreshRegistry>> | null>,
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  // CLI update banner
  if (config.update.check_cli) {
    const cliUpdate = await cliUpdatePromise;
    if (cliUpdate?.updateAvailable && cliUpdate.latest) {
      process.stderr.write(
        `  ${yellow('↑')} ${bold('SkillPro update available')}: ${dim(cliUpdate.current)} → ${orange(cliUpdate.latest)}\n`,
      );
      process.stderr.write(`    ${dim('Run:')} ${orange('npm i -g skillpro@latest')}  ${dim('or')}  ${orange('npx skillpro@latest')}\n\n`);
    }
  }

  // Registry refresh status (only show if fresh data pulled)
  if (config.update.check_registry) {
    const refresh = await registryRefreshPromise;
    if (refresh?.status === 'fresh' && refresh.skillCount) {
      process.stderr.write(
        `  ${orange('✓')} ${dim(`Registry refreshed: ${refresh.skillCount} skills`)}\n\n`,
      );
    }
  }

  // Skill updates notification
  if (config.update.check_skills) {
    try {
      const report = checkSkillUpdates();
      if (report.updates.length > 0 || report.deprecated.length > 0) {
        process.stderr.write(`  ${yellow('↑')} ${bold('Installed skill updates:')}\n`);
        for (const up of report.updates.slice(0, 5)) {
          const arrow = up.breaking ? red('⚠ BREAKING') : orange('→');
          const ver = `${up.currentVersion ?? '?'} → ${up.latestVersion ?? '?'}`;
          process.stderr.write(`    ${arrow} ${up.id} ${dim(ver)}\n`);
        }
        if (report.updates.length > 5) {
          process.stderr.write(`    ${dim(`... +${report.updates.length - 5} more`)}\n`);
        }
        if (report.deprecated.length > 0) {
          process.stderr.write(
            `    ${red('✗')} ${bold(`${report.deprecated.length} deprecated`)}: ${dim(report.deprecated.slice(0, 3).join(', '))}\n`,
          );
        }
        process.stderr.write(`    ${dim('Run:')} ${orange('npx skillpro --update')}\n\n`);
      }
    } catch {
      // Skill update check failed — silent
    }
  }
}
