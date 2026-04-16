import { parseArgs } from 'node:util';
import type { CliArgs } from './types.js';
import { printBanner, getVersion } from './ui/banner.js';
import { Spinner } from './ui/spinner.js';
import { bold, cyan, dim, green, gray, red, yellow, symbols } from './ui/colors.js';
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
    --dry-run          Show skills without installing
    --all              Show all matches including alternatives
    -v, --verbose      Show error details
    -a, --agent <ids>  Target specific agents (cursor,claude-code,codex)
    --export <target>  Export after install (cursor, codex)
    -h, --help         Show this help
    --version          Show version

  ${bold('Examples:')}
    ${dim('$')} npx skillpro
    ${dim('$')} npx skillpro -y
    ${dim('$')} npx skillpro --dry-run
    ${dim('$')} npx skillpro --dry-run --all
    ${dim('$')} npx skillpro -a cursor,claude-code
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
  if (skill.source === 'Anthropic Skills') return bold(cyan('anthropic'));
  const installs = formatInstalls(skill.weekly_installs ?? 0);
  if (installs) return green(installs);
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

  // ─── Step 3: Display ───────────────────────────────────────────────
  if (args.dryRun) {
    // Group by stack for display
    const byStack = new Map<string, MatchedSkill[]>();
    for (const skill of result.recommended) {
      const stack = skill.matchedStack;
      if (!byStack.has(stack)) byStack.set(stack, []);
      byStack.get(stack)!.push(skill);
    }

    for (const [stack, skills] of byStack) {
      process.stderr.write(`  ${bold(stack)} ${dim(`(${skills.length})`)}\n`);
      for (const skill of skills) {
        const tag = sourceTag(skill);
        process.stderr.write(
          `    ${green(symbols.checkboxOn)} ${bold(skill.name)} ${tag}\n`,
        );
        if (skill.description) {
          process.stderr.write(`      ${gray(skill.description.slice(0, 80))}\n`);
        }
      }
      process.stderr.write('\n');
    }

    // Show alternatives if --all
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

    return;
  }

  // ─── Step 4: Install ───────────────────────────────────────────────
  const toInstall = args.yes
    ? result.recommended
    : result.recommended; // TODO: interactive multi-select

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
    source: { name: s.source, install_url: s.install_url, commit_sha: null, type: 'registry' },
    score: s.priority,
    relevance: 'recommended' as const,
  }));

  process.stderr.write(`  Installing ${bold(String(toInstall.length))} skills...\n`);
  const results = await installAll(asScoredSkills, args);

  const ok = results.filter((r) => r.success).length;
  const fail = results.filter((r) => !r.success).length;

  process.stderr.write('\n');
  if (ok > 0) process.stderr.write(`  ${green(`${ok} installed`)}`);
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

// ─── Detection Report ──────────────────────────────────────────────────

/**
 * Render the detected project stack as a visually prominent block.
 * Grid of tech pills + language + package manager + workspaces.
 */
function printDetectionReport(detected: ReturnType<typeof detectStack>): void {
  const languageLabel = titleCase(detected.language);
  const pm = detected.packageManager;

  // Section header
  process.stderr.write(`  ${cyan('◆')} ${bold('Detected project:')}\n\n`);

  // Language + package manager line
  process.stderr.write(
    `    ${dim('language')}  ${bold(cyan(languageLabel))}   ${dim('·')}   ${dim('package manager')}  ${bold(pm)}\n`,
  );

  // Stack grid — all detected stacks as pills
  if (detected.all.length > 0) {
    process.stderr.write(`    ${dim('stacks')}    `);
    const pills = detected.all.map((s) => `${green('✓')} ${bold(s.name)}`);
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
    process.stderr.write(`\n  ${cyan('◆')} ${bold(`${detected.workspaces.length} workspaces:`)}\n\n`);
    const maxNameLen = Math.max(...detected.workspaces.map((w) => w.name.length));
    for (const ws of detected.workspaces) {
      const pad = ws.name.padEnd(maxNameLen);
      const wsStacks = ws.stacks.length > 0
        ? ws.stacks.map((s) => green(s.name)).join(`${dim(' · ')}`)
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
        `  ${yellow('↑')} ${bold('SkillPro update available')}: ${dim(cliUpdate.current)} → ${green(cliUpdate.latest)}\n`,
      );
      process.stderr.write(`    ${dim('Run:')} ${cyan('npm i -g skillpro@latest')}  ${dim('or')}  ${cyan('npx skillpro@latest')}\n\n`);
    }
  }

  // Registry refresh status (only show if fresh data pulled)
  if (config.update.check_registry) {
    const refresh = await registryRefreshPromise;
    if (refresh?.status === 'fresh' && refresh.skillCount) {
      process.stderr.write(
        `  ${green('✓')} ${dim(`Registry refreshed: ${refresh.skillCount} skills`)}\n\n`,
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
          const arrow = up.breaking ? red('⚠ BREAKING') : green('→');
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
        process.stderr.write(`    ${dim('Run:')} ${cyan('npx skillpro --update')}\n\n`);
      }
    } catch {
      // Skill update check failed — silent
    }
  }
}
