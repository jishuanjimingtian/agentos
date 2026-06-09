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
  schemaGate: boolean;
  riskGate: {
    autoApprove: number;
    notify: number;
    confirm: number;
    deny: number;
  };
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

export interface SemanticMemory {
  userPreferences: Record<string, unknown>;
  userFacts: string[];
  projectContext: Record<
    string,
    {
      description: string;
      techStack: string[];
      conventions: string[];
      architecture: string;
      knownIssues: string[];
    }
  >;
  learnedRules: LearnedRule[];
  glossary: Record<string, string>;
}

export interface LearnedRule {
  rule: string;
  confidence: number;
  source: string[];
}

// === Evaluator Types ===

export type SignalType =
  | 'user_immediate_reply'
  | 'user_deleted_agent_code'
  | 'user_modified_agent_output'
  | 'user_repeated_instruction'
  | 'user_paused_agent'
  | 'user_continued_session';

export interface ImplicitFeedback {
  signal: SignalType;
  strength: number;
  context: string;
  timestamp: number;
}

export interface PreExecMetrics {
  schemaPassRate: number;
  riskDistribution: Record<string, number>;
  paramQuality: number;
}

export interface RuntimeMetrics {
  retryRate: number;
  selfCorrectionCount: number;
  timeoutRate: number;
  toolSelectionAccuracy: number;
}

export interface PostExecMetrics {
  verifyPassRate: number;
  userAcceptance: number;
  resultUtilization: number;
  taskCompletion: number;
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
  guard: GuardConfig;
  memory: {
    working: { maxTokens: number };
    episodic: { maxSizeKb: number };
    semantic: { enabled: boolean };
  };
  evaluator?: {
    implicitFeedbackEnabled: boolean;
  };
}
