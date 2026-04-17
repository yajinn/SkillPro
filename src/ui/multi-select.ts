import { emitKeypressEvents } from 'node:readline';
import type { ScoredSkill } from '../types.js';
import { bold, orange, dim, gray, cyan, symbols } from './colors.js';
import { clusterSkills } from '../score/clustering.js';

interface SelectionState {
  items: SelectionItem[];
  cursor: number;
}

interface SelectionItem {
  skill: ScoredSkill;
  checked: boolean;
  isGroupHeader: boolean;
  installed: boolean;
  groupLabel?: string;
  groupCount?: number;
  groupChecked?: number;
}

function buildItems(
  skills: ScoredSkill[],
  installedIds: Set<string>,
): SelectionItem[] {
  const groups = clusterSkills(skills);
  const items: SelectionItem[] = [];

  for (const [category, groupSkills] of groups) {
    // Installed skills default UNCHECKED (don't overwrite without intent),
    // fresh ones default CHECKED (user uses space to drop unwanted ones).
    const defaultCheckedCount = groupSkills.filter(
      (s) => !installedIds.has(s.id),
    ).length;

    items.push({
      skill: groupSkills[0]!,
      checked: false,
      isGroupHeader: true,
      installed: false,
      groupLabel: category || 'other',
      groupCount: groupSkills.length,
      groupChecked: defaultCheckedCount,
    });

    for (const skill of groupSkills) {
      const installed = installedIds.has(skill.id);
      items.push({
        skill,
        checked: !installed,
        isGroupHeader: false,
        installed,
      });
    }
  }

  return items;
}

function renderLine(item: SelectionItem, isActive: boolean): string {
  if (item.isGroupHeader) {
    const label = bold(item.groupLabel!);
    const count = dim(`(${item.groupChecked}/${item.groupCount})`);
    return `\n  ${label} ${count}`;
  }

  const pointer = isActive ? orange(symbols.pointer) : ' ';
  const checkbox = item.checked
    ? orange(symbols.checkboxOn)
    : dim(symbols.checkboxOff);

  // Installed skills: name in cyan + "installed" badge; fresh skills use default color.
  const rawName = item.skill.name;
  const name = item.installed
    ? (isActive ? bold(cyan(rawName)) : cyan(rawName))
    : (isActive ? bold(rawName) : rawName);
  const badge = item.installed ? ' ' + cyan(dim('installed')) : '';
  const score = dim(`(${String(item.skill.score).padStart(3)})`);

  // Truncate description to fit terminal
  const cols = process.stdout.columns || 80;
  const prefix = `  ${pointer} ${checkbox} ${name}${badge} ${score}  `;
  const plainPrefix = prefix.replace(/\x1b\[[\d;]+m/g, '');
  const maxDesc = Math.max(0, cols - plainPrefix.length - 2);
  let desc = item.skill.description;
  if (desc.length > maxDesc) {
    desc = desc.slice(0, maxDesc - 1) + '\u2026';
  }

  const descColored = item.installed ? dim(desc) : gray(desc);
  return `  ${pointer} ${checkbox} ${name}${badge} ${score}  ${descColored}`;
}

function render(state: SelectionState): string {
  const lines: string[] = [];

  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i]!;
    lines.push(renderLine(item, i === state.cursor));
  }

  // Summary line — selected count
  const totalSelectable = state.items.filter((x) => !x.isGroupHeader).length;
  const selectedCount = state.items.filter((x) => !x.isGroupHeader && x.checked).length;

  lines.push('');
  lines.push(
    `  ${bold(`${selectedCount}/${totalSelectable} selected`)}`,
  );
  lines.push(
    `  ${dim('↑↓ navigate · space select · a all · n none · enter install · q cancel')}`,
  );

  return lines.join('\n');
}

function updateGroupHeaders(items: SelectionItem[]): void {
  let currentGroup: SelectionItem | null = null;
  let groupChecked = 0;

  for (const item of items) {
    if (item.isGroupHeader) {
      if (currentGroup) {
        currentGroup.groupChecked = groupChecked;
      }
      currentGroup = item;
      groupChecked = 0;
    } else if (currentGroup) {
      if (item.checked) groupChecked++;
    }
  }

  if (currentGroup) {
    currentGroup.groupChecked = groupChecked;
  }
}

export async function multiSelect(
  skills: ScoredSkill[],
  installedIds: Set<string> = new Set(),
): Promise<ScoredSkill[]> {
  if (!process.stdin.isTTY) {
    // Non-interactive: return all recommended that aren't already installed
    return skills.filter(
      (s) => s.relevance === 'recommended' && !installedIds.has(s.id),
    );
  }

  const state: SelectionState = {
    items: buildItems(skills, installedIds),
    cursor: 0,
  };

  // Move cursor to first non-header item
  while (
    state.cursor < state.items.length &&
    state.items[state.cursor]!.isGroupHeader
  ) {
    state.cursor++;
  }

  return new Promise<ScoredSkill[]>((resolve) => {
    const stdin = process.stdin;

    // CRITICAL ORDER:
    // 1. Enable keypress parsing BEFORE raw mode
    // 2. Attach listener BEFORE resume
    // 3. Raw mode + resume together at the end
    // Otherwise: either events don't fire, or the first keypress is lost.
    emitKeypressEvents(stdin);
    stdin.setEncoding('utf8');

    // Hide cursor
    process.stderr.write('\x1b[?25l');

    let rendered = '';

    function draw(): void {
      if (rendered) {
        const lines = rendered.split('\n').length;
        process.stderr.write(`\x1b[${lines}A\x1b[J`);
      }
      rendered = render(state);
      process.stderr.write(rendered + '\n');
    }

    function moveCursor(delta: number): void {
      let next = state.cursor + delta;
      // Skip group headers
      while (
        next >= 0 &&
        next < state.items.length &&
        state.items[next]!.isGroupHeader
      ) {
        next += delta;
      }
      if (next >= 0 && next < state.items.length) {
        state.cursor = next;
      }
    }

    function cleanup(): void {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeAllListeners('keypress');
      process.stderr.write('\x1b[?25h'); // show cursor
    }

    interface Key {
      sequence?: string;
      name?: string;
      ctrl?: boolean;
      meta?: boolean;
      shift?: boolean;
    }

    const onKeypress = (_str: string | undefined, key: Key): void => {
      if (!key) return;
      const name = key.name ?? '';

      // Ctrl+C / Ctrl+D
      if (key.ctrl && (name === 'c' || name === 'd')) {
        cleanup();
        stdin.removeListener('keypress', onKeypress);
        resolve([]);
        return;
      }

      switch (name) {
        case 'up':
        case 'k':
          moveCursor(-1);
          break;
        case 'down':
        case 'j':
          moveCursor(1);
          break;
        case 'space': {
          const item = state.items[state.cursor];
          if (item && !item.isGroupHeader) {
            item.checked = !item.checked;
            updateGroupHeaders(state.items);
          }
          break;
        }
        case 'a':
          for (const item of state.items) {
            if (!item.isGroupHeader) item.checked = true;
          }
          updateGroupHeaders(state.items);
          break;
        case 'n':
          for (const item of state.items) {
            if (!item.isGroupHeader) item.checked = false;
          }
          updateGroupHeaders(state.items);
          break;
        case 'return':
        case 'enter': {
          cleanup();
          stdin.removeListener('keypress', onKeypress);
          const selected = state.items
            .filter((item) => !item.isGroupHeader && item.checked)
            .map((item) => item.skill);
          resolve(selected);
          return;
        }
        case 'q':
        case 'escape': {
          cleanup();
          stdin.removeListener('keypress', onKeypress);
          resolve([]);
          return;
        }
        default:
          return; // unknown key — don't redraw
      }
      draw();
    };

    // FINAL ORDER: draw first, then register listener, then raw mode + resume
    draw();
    stdin.on('keypress', onKeypress);
    stdin.setRawMode(true);
    stdin.resume();
  });
}
