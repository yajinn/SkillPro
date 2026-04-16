import type { SkillEntry, SourceConfig } from '../types.js';

export interface SourceAdapter {
  type: string;
  fetch(url: string, config: SourceConfig): Promise<SkillEntry[]>;
}

export type HttpGet = (url: string) => Promise<string>;
