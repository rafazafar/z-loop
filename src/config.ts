import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

export interface ProjectConfig {
  name: string;
  repo_path: string;
  description?: string;
}

export interface CommandsConfig {
  test?: string;
  lint?: string;
  build?: string;
}

export interface AssuranceConfig {
  enabled_dimensions: string[];
  sensitive_paths?: Record<string, string[]>;
}

export interface RoleConfig {
  model: string;
  variant: string;
}

export interface DiffBudgetConfig {
  max_files: number;
  max_insertions: number;
  max_deletions: number;
}

export interface RulesConfig {
  max_fix_attempts: number;
  max_impl_attempts: number;
  max_clean_retries: number;
  max_concurrent_sessions: number;
  diff_budget: DiffBudgetConfig;
  session_inactivity_timeout_sec: number;
  session_termination_grace_sec: number;
  session_timeout_sec: number;
  clone_reap_days: number;
}

export interface GithubConfig {
  frontier_label: string;
  integration_label?: string;
  decision_label: string;
  branch_prefix: string;
  base_branch: string;
}

export interface DaemonConfig {
  dashboard_port: number;
  service_identifier: string;
}

export interface DomainToggleConfig {
  enabled?: boolean;
  transcripts_path?: string;
}

export interface LoopConfig {
  project: ProjectConfig;
  commands?: CommandsConfig;
  assurance?: AssuranceConfig;
  domains?: Record<string, DomainToggleConfig>;
  roles: Record<string, RoleConfig>;
  rules: RulesConfig;
  github: GithubConfig;
  daemon?: DaemonConfig;
}

export function loadConfig(rootPath: string = process.cwd()): { config: LoopConfig; configPath: string } {
  const configFile = join(rootPath, 'config.json');
  const routingFile = join(rootPath, 'routing.json');

  let chosenFile = configFile;
  if (!existsSync(configFile) && existsSync(routingFile)) {
    chosenFile = routingFile;
  }

  if (!existsSync(chosenFile)) {
    throw new Error(`Configuration file not found. Looked for ${configFile} and ${routingFile}`);
  }

  const raw = readFileSync(chosenFile, 'utf8');
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`Failed to parse ${chosenFile}: ${err.message}`);
  }

  // Supply sensible defaults where omitted
  const config: LoopConfig = {
    project: {
      name: parsed.project?.name || 'project',
      repo_path: resolve(rootPath, parsed.project?.repo_path || '.'),
      description: parsed.project?.description || ''
    },
    commands: {
      test: parsed.commands?.test || '',
      lint: parsed.commands?.lint || '',
      build: parsed.commands?.build || ''
    },
    assurance: {
      enabled_dimensions: parsed.assurance?.enabled_dimensions || ['acceptance', 'code', 'security'],
      sensitive_paths: parsed.assurance?.sensitive_paths || {}
    },
    domains: parsed.domains || {},
    roles: parsed.roles || {},
    rules: {
      max_fix_attempts: parsed.rules?.max_fix_attempts ?? 5,
      max_impl_attempts: parsed.rules?.max_impl_attempts ?? 5,
      max_clean_retries: parsed.rules?.max_clean_retries ?? 2,
      max_concurrent_sessions: parsed.rules?.max_concurrent_sessions ?? 3,
      diff_budget: {
        max_files: parsed.rules?.diff_budget?.max_files ?? 12,
        max_insertions: parsed.rules?.diff_budget?.max_insertions ?? 800,
        max_deletions: parsed.rules?.diff_budget?.max_deletions ?? 400
      },
      session_inactivity_timeout_sec: parsed.rules?.session_inactivity_timeout_sec ?? 1800,
      session_termination_grace_sec: parsed.rules?.session_termination_grace_sec ?? 5,
      session_timeout_sec: parsed.rules?.session_timeout_sec ?? 7200,
      clone_reap_days: parsed.rules?.clone_reap_days ?? 7
    },
    github: {
      frontier_label: parsed.github?.frontier_label || 'ready-for-worker',
      integration_label: parsed.github?.integration_label || 'loop-integration',
      decision_label: parsed.github?.decision_label || 'need-decision',
      branch_prefix: parsed.github?.branch_prefix || 'issue',
      base_branch: parsed.github?.base_branch || 'main'
    },
    daemon: {
      dashboard_port: parsed.daemon?.dashboard_port || 4177,
      service_identifier: parsed.daemon?.service_identifier || 'dev.loop'
    }
  };

  return { config, configPath: chosenFile };
}
