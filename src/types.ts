export interface ReviewProviderConfig {
  base_url?: string;
  api_key_env?: string;
}

export interface ReviewConcern {
  severity: "low" | "medium" | "high";
  file?: string;
  description: string;
  suggested_checks?: string[];
}

export interface ReviewResult {
  clean: boolean;
  summary: string;
  concerns: ReviewConcern[];
}

export interface ReviewConfig {
  provider?: ReviewProviderConfig;
  model?: string;
  models?: string[];
  prompt?: string;
  enabled?: boolean;
  timeout?: number;
  retries?: number;
  cache?: boolean;
}

export interface AgentScopeConfig {
  version: string;
  mode?: "strict" | "warn";
  task: {
    id: string;
    title: string;
    description?: string;
  };
  scope: {
    read?: string[];
    write?: string[];
    protected?: string[];
    approval_required?: string[];
  };
  checks?: {
    before_done?: string[];
    review?: ReviewConfig;
  };
  escalation?: {
    mode?: string;
    allowed_actions?: string[];
  };
}

export interface ApprovalEntry {
  path: string;
  task_id: string;
  approved_by: string;
  created_at: string;
}

export interface ApprovalsFile {
  approved?: ApprovalEntry[];
}

export interface ScopeDecision {
  file: string;
  status: "allowed" | "blocked" | "approval_required" | "approved" | "warning";
  reason: string;
  matchedRule?: string;
}

export interface CheckResult {
  taskId: string;
  taskTitle: string;
  allowed: ScopeDecision[];
  warnings: ScopeDecision[];
  violations: ScopeDecision[];
  approvalRequired: ScopeDecision[];
}

export interface ScopeRequest {
  task_id: string;
  requested_paths: string[];
  reason: string;
  required_by?: string;
  agent_summary?: string;
  risk?: {
    level: string;
    why: string;
  };
  suggested_checks?: string[];
  created_at: string;
}
