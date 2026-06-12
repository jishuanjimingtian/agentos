// === Guard Layer Types ===

export interface SchemaCheck {
  pass: boolean;
  errors?: SchemaError[];
}

export interface SchemaError {
  field: string;
  actual: unknown;
  expected: string;
  message: string;
}

export type RiskAction = 'auto' | 'notify' | 'confirm' | 'deny';

export interface RiskScore {
  score: number;
  action: RiskAction;
  dimensions: {
    impact: number;
    reversibility: number;
    sensitivity: number;
    errorRate: number;
  };
}

export interface GuardConfig {
  schema?: { rules: SchemaRule[] };
  riskGate?: {
    autoApprove: number;
    notify: number;
    confirm: number;
    deny: number;
  };
}

export interface SchemaRule {
  tool: string;
  required: string[];
  forbidden?: string[];
}

// === Memory Layer Types ===

export interface WorkingMemory {
  sessionId: string;
  recentMessages: Message[];
  currentTask?: Task;
  recentToolResults: Map<string, ToolResult>;
  openFiles: string[];
  budget: TokenBudget;
}

export interface Message {
  role: 'user' | 'agent' | 'tool';
  content: string;
  timestamp: number;
}

export interface Task {
  description: string;
  steps: Array<{ step: string; status: 'pending' | 'in_progress' | 'done' }>;
}

export interface ToolResult {
  toolName: string;
  result: unknown;
  timestamp: number;
}

export interface TokenBudget {
  used: number;
  limit: number;
}

export type EventType =
  | 'tool_call'
  | 'tool_failure'
  | 'decision'
  | 'correction'
  | 'publish'
  | 'error'
  | 'milestone'
  | 'note'
  | 'user_feedback';

export type CompressionLevel = 'full' | 'summary' | 'one-liner' | 'forgotten';

export interface EpisodicEvent {
  id: string;
  timestamp: number;
  type: EventType;
  importance: number;
  compression: CompressionLevel;
  content: string;
  tags: string[];
  relatedEntities: string[];
}

export interface UserFact {
  fact: string;
  timestamp: number;
  lastReferenced: number;
}

export interface SemanticMemory {
  userPreferences: Record<string, unknown>;
  userFacts: UserFact[];
  projectContext: Record<
    string,
    Partial<{
      description: string;
      techStack: string[];
      conventions: string[];
      architecture: string;
      knownIssues: string[];
    }> & Record<string, unknown>
  >;
  learnedRules: LearnedRule[];
  glossary: Record<string, string>;
}

export interface LearnedRule {
  rule: string;
  confidence: number;
  source: string[];
  lastReferenced: number;
}

// === Evaluator Types ===

export type SignalType =
  | 'user_deleted_code'
  | 'user_interrupted'
  | 'user_provided_correction'
  | 'user_modified_output'
  | 'user_repeated_instruction'
  | 'user_ignored_result'
  | 'user_silence_then_praise'
  | 'user_immediate_continue'
  | 'agent_self_corrected'
  | 'user_explicit_approval'
  | 'user_used_result'
  | 'user_shared_output';

export interface ImplicitFeedback {
  id: string;
  timestamp: number;
  signal: SignalType;
  strength: number;
  confidence: number;
  sessionId: string;
  operationId?: string;
  source: string;
}

export interface PreExecMetrics {
  timestamp: number;
  toolName: string;
  schemaCheck: SchemaCheck;
  riskScore: RiskScore;
  paramQuality: { score: number; observations: string[] };
  contextUtilization: { score: number; patterns: string[] };
}

export interface RuntimeMetrics {
  retryCount: number;
  selfCorrected: boolean;
  hadTimeout: boolean;
  toolSuccess: boolean;
  toolSelectionMatch?: boolean;
  adaptiveScore: number;
  durationMs: number;
}

export interface PostExecMetrics {
  timestamp?: number;
  verifyPassed: boolean;
  verifyScore: number;
  userAccepted: boolean;
  userEditRate: number;
  resultUtilized: boolean;
  outcomeScore: number;
  healthy: boolean;
  diffLinesChanged?: number;
}

// === Audit Types ===

export interface Snapshot {
  id: string;
  toolCallId: string;
  timestamp: number;
  scope: 'file' | 'workspace' | 'full';
  fileHashes: Record<string, string>;
  envVars: Record<string, string>;
  gitHead: string;
  gitDirty: boolean;
}

export type VerifyStatus = 'PASS' | 'WARN' | 'FAIL';

export interface VerifyCheck {
  name: string;
  status: VerifyStatus;
  detail?: string;
}

export interface AuditEntry {
  id: string;
  sessionId: string;
  agentId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  toolName: string;
  toolParameters: Record<string, unknown>;
  toolResult: unknown;
  schemaGate: SchemaCheck;
  riskGate: { score: number; action: RiskAction };
  snapshot: Snapshot | null;
  verifyGate: { status: VerifyStatus; checks: VerifyCheck[] };
  diff: DiffInfo | null;
  rollback?: RollbackInfo;
}

export interface DiffInfo {
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  hashBefore: Record<string, string>;
  hashAfter: Record<string, string>;
}

export interface RollbackInfo {
  rolledBack: boolean;
  rollbackSnapshotId: string;
  success: boolean;
}

// === AgentOS Core Types ===

export interface AgentOSConfig {
  workspaceRoot?: string;
  maxWorkingTokens?: number;
  maxEpisodicSizeKb?: number;
  guardConfig?: GuardConfig;
  evaluatorConfig?: {
    implicitFeedbackEnabled?: boolean;
  };
}
