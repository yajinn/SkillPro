import type { ScoredSkill } from '../types.js';
import { bold, orange, dim, gray, yellow, symbols } from './colors.js';
import { clusterSkills } from '../score/clustering.js';

interface SelectionState {
  items: SelectionItem[];
  cursor: number;
}

interface SelectionItem {
  skill: ScoredSkill;
  checked: boolean;
  isGroupHeader: boolean;
  groupLabel?: string;
  groupCount?: number;
  groupChecked?: number;
}

function buildItems(skills: ScoredSkill[]): SelectionItem[] {
  const groups = clusterSkills(skills);
  const items: SelectionItem[] = [];

  for (const [category, groupSkills] of groups) {
    items.push({
      skill: groupSkills[0]!,
      checked: false,
      isGroupHeader: true,
      groupLabel: category || 'other',
      groupCount: groupSkills.length,
      groupChecked: 0, // starts empty — user actively picks
    });

    // All skills start UNCHECKED. User presses space to select.
    // Pressing enter with nothing selected exits cleanly.
    for (const skill of groupSkills) {
      items.push({
        skill,
        checked: false,
        isGroupHeader: false,
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
  const name = isActive ? bold(item.skill.name) : item.skill.name;
  const score = dim(`(${String(item.skill.score).padStart(3)})`);

  // Truncate description to fit terminal
  const cols = process.stdout.columns || 80;
  const prefix = `  ${pointer} ${checkbox} ${name} ${score}  `;
  const plainPrefix = prefix.replace(/\x1b\[\d+m/g, '');
  const maxDesc = Math.max(0, cols - plainPrefix.length - 2);
  let desc = item.skill.description;
  if (desc.length > maxDesc) {
    desc = desc.slice(0, maxDesc - 1) + '\u2026';
  }

  return `  ${pointer} ${checkbox} ${name} ${score}  ${gray(desc)}`;
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
): Promise<ScoredSkill[]> {
  if (!process.stdin.isTTY) {
    // Non-interactive: return all recommended
    return skills.filter((s) => s.relevance === 'recommended');
  }

  const state: SelectionState = {
    items: buildItems(skills),
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
    stdin.setRawMode(true);
    stdin.resume();
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
      stdin.removeAllListeners('data');
      process.stderr.write('\x1b[?25h'); // show cursor
    }

    draw();

    stdin.on('data', (key: string) => {
      // Handle all common arrow-key escape sequences:
      //   \x1b[A/B — ANSI/xterm
      //   \x1bOA/OB — VT100 application cursor mode
      //   k/j — vim-style
      switch (key) {
        case '\x1b[A':
        case '\x1bOA':
        case 'k':
          moveCursor(-1);
          break;
        case '\x1b[B':
        case '\x1bOB':
        case 'j':
          moveCursor(1);
          break;
        case ' ': {
          // toggle
          const item = state.items[state.cursor];
          if (item && !item.isGroupHeader) {
            item.checked = !item.checked;
            updateGroupHeaders(state.items);
          }
          break;
        }
        case 'a': // select all
          for (const item of state.items) {
            if (!item.isGroupHeader) item.checked = true;
          }
          updateGroupHeaders(state.items);
          break;
        case 'n': // deselect all
          for (const item of state.items) {
            if (!item.isGroupHeader) item.checked = false;
          }
          updateGroupHeaders(state.items);
          break;
        case '\r': // enter — confirm
        case '\n': {
          cleanup();
          const selected = state.items
            .filter((item) => !item.isGroupHeader && item.checked)
            .map((item) => item.skill);
          resolve(selected);
          return;
        }
        case '\x03': // Ctrl+C
        case 'q': {
          cleanup();
          resolve([]);
          return;
        }
      }
      draw();
    });
  });
}
