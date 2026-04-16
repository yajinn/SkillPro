// ─── Project Detection ────────────────────────────────────────────────

export type Characteristic =
  | 'has_ui'
  | 'has_web'
  | 'has_mobile_ui'
  | 'has_api'
  | 'has_db'
  | 'handles_auth'
  | 'has_user_input'
  | 'serves_traffic'
  | 'is_library'
  | 'has_ci'
  | 'has_docker'
  | 'has_i18n'
  | 'has_ecommerce'
  | 'has_cms'
  | 'cli_only'
  | 'data_pipeline'
  | 'headless'
  | 'serves_public';

export interface ProjectProfile {
  language: string;
  language_version: string;
  framework: string | null;
  sub_framework: string | null;
  project_type: string;
  package_manager: string;
  database: string | null;
  characteristics: Record<Characteristic, boolean>;
  libraries: string[];
  critical_files: string[];
  infrastructure: {
    cdn: string | null;
    ci_tool: string | null;
    docker: boolean;
  };
  monorepo_hoist: boolean;
  detection_dir: string;
}

// ─── Skill Catalog ────────────────────────────────────────────────────

export interface SkillSource {
  name: string;
  install_url: string;
  commit_sha: string | null;
  type: string;
}

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  install_url: string;
  version: string | null;
  commit_sha: string | null;
  tags: string[];
  boost_when: string[];
  penalize_when: string[];
  default_for: string[];
  match_language: string | null;
  match_framework: string | null;
  match_sub_framework: string | null;
  match_libraries: string[];
  boost_libraries: string[];
  category: string | null;
  popularity: number;
  source: SkillSource;
}

export interface ScoredSkill extends SkillEntry {
  score: number;
  relevance: 'recommended' | 'optional' | 'not_relevant';
}

// ─── Source Configuration ─────────────────────────────────────────────

export interface SourceConfig {
  type: 'skills-sh-html' | 'marketplace' | 'awesome-list' | 'sitemap';
  name: string;
  url: string;
  require_audit: boolean;
  max_skills?: number;
}

export interface SourcesConfig {
  version: number;
  defaults: SourceConfig[];
}

// ─── Scoring ──────────────────────────────────────────────────────────

export interface ScoringThresholds {
  recommended: number;
  optional: number;
  not_relevant: number;
}

export interface ScoringRules {
  thresholds: ScoringThresholds;
}

// ─── Index ────────────────────────────────────────────────────────────

export interface FederatedIndex {
  version: number;
  fetched_at: string;
  ttl_seconds: number;
  partial: boolean;
  sources: SourceStatus[];
  scoring_rules: ScoringRules;
  skills: SkillEntry[];
}

export interface SourceStatus {
  type: string;
  name: string;
  url: string;
  skill_count: number;
  fetched_at: string;
  status: 'success' | 'error' | 'timeout';
  error?: string;
}

// ─── Installation ─────────────────────────────────────────────────────

export interface InstallResult {
  skill_id: string;
  success: boolean;
  path?: string;
  error?: string;
}

export interface SelectionEntry {
  enabled: boolean;
  installed_at: string;
  source: string;
  sha: string | null;
}

export interface SelectionsFile {
  version: number;
  updated: string;
  selections: Record<string, SelectionEntry>;
}

// ─── CLI ──────────────────────────────────────────────────────────────

export interface CliArgs {
  yes: boolean;
  dryRun: boolean;
  verbose: boolean;
  agents: string[];
  sources: string[];
  exportTarget: string | null;
  help: boolean;
  version: boolean;
}
