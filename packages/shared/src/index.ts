// @avtp/shared — types & contracts shared by apps/web and functions.
// Mirrors the data model in docs/ARCHITECTURE.md §6. Keep this the single
// source of truth for cross-boundary shapes.

export type Role = "superadmin" | "admin" | "trainee";

export const COLLECTIONS = {
  credentials: "credentials",
  users: "users",
  groups: "groups",
  agents: "agents",
  catalogs: "catalogs",
  tracks: "tracks",
  sections: "sections",
  questions: "questions",
  assignments: "assignments",
  sessions: "sessions",
  usageCounters: "usageCounters",
  settings: "settings",
  auditLogs: "auditLogs",
} as const;

export const GROK_VOICES = ["eve", "ara", "rex", "sal", "leo"] as const;
export type GrokVoice = (typeof GROK_VOICES)[number];

export type RetrievalMode = "hybrid" | "semantic" | "keyword";
export type AgentStatus = "draft" | "published" | "archived";

// ---- Users / groups -------------------------------------------------------
export interface UserDoc {
  userid: string;
  displayName: string;
  role: Role;
  status: "active" | "disabled";
  groups: string[];
  assignedAgentIds?: string[];
  catalogScope?: CatalogScope | "all";
  usageLimits?: UsageLimits | null;
  maxSessionMinutes?: number; // per-user override of the global session cap
  mustChangePassword?: boolean;
  createdAt: number;
  createdBy: string;
}

export interface GroupDoc {
  name: string;
  description?: string;
  memberUids: string[];
  assignedAgentIds?: string[];
  catalogScope?: CatalogScope | "all";
  usageLimits?: UsageLimits | null;
  createdAt: number;
  createdBy: string;
}

export interface UsageLimits {
  perDayMin?: number;
  perWeekMin?: number;
  perMonthMin?: number;
}

// Platform-wide settings (superadmin). A limit value of 0 (or unset) = unlimited
// / disabled. Per-user and per-group UsageLimits override these (most-restrictive
// wins). Enforced in-app (Spark: no server cron).
export interface GlobalSettings {
  maxSessionMinutes: number; // hard cap on a single session's length
  maxConcurrentSessionsPerUser: number; // simultaneous live sessions per trainee
  maxConcurrentSessionsTotal: number; // platform-wide live sessions across ALL users
  idleTimeoutSec: number; // auto-end a session after this much inactivity
  defaultUsageLimits: UsageLimits; // applied to all trainees unless overridden
  updatedAt?: number;
  updatedBy?: string;
}

export interface CatalogScope {
  trackIds?: string[];
  sectionIds?: string[];
  questionIds?: string[];
}

// ---- Agents ---------------------------------------------------------------
export interface CustomToolDef {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  parameters: Record<string, unknown>; // JSON Schema
  binding: {
    type: "http";
    url: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    headersRef?: string; // secret reference, never inline secrets
    bodyTemplate?: string;
    timeoutMs?: number;
  };
}

export interface AgentDoc {
  name: string;
  description?: string;
  status: AgentStatus;
  model: string;
  systemPrompt: string;
  promptVersion: number;
  voices: { default: GrokVoice; allowed: GrokVoice[] };
  turnDetection?: Record<string, unknown>;
  audio?: Record<string, unknown>;
  knowledgeBase: {
    enabled: boolean;
    // How retrieval is performed:
    //  - "custom": our search_knowledge_base function tool → proxy /search
    //    (client-executed; full chunk capture, multi-query).
    //  - "xai_file_search": xAI's server-side file_search tool (collections_search);
    //    the model searches during generation, no client round-trip.
    provider?: "custom" | "xai_file_search";
    collectionIds: string[];
    maxNumResults: number;
    retrievalMode: RetrievalMode;
    dedupe: boolean;
    limit: number;
  };
  webSearch: { enabled: boolean };
  xSearch?: { enabled: boolean; allowedHandles?: string[] };
  tools: CustomToolDef[];
  usageLimits?: UsageLimits | null;
  createdAt: number;
  createdBy: string;
  updatedAt?: number;
  updatedBy?: string;
}

// ---- Guided Questions (Learning Tracks → Sections → Questions) -----------
export interface TrackDoc {
  catalogId: string;
  title: string;
  order: number;
  description?: string;
}
export interface SectionDoc {
  trackId: string;
  parentSectionId?: string | null;
  title: string;
  order: number;
}
export interface QuestionDoc {
  sectionId: string;
  trackId: string;
  text: string;
  order: number;
  tags?: string[];
  difficulty?: string;
  conceptHint?: string;
  enabled: boolean;
  createdBy: string;
  updatedAt?: number;
}

// ---- Sessions / traces ----------------------------------------------------
export type SessionStatus = "active" | "ended" | "aborted";
export type EndReason = "user" | "limit" | "disconnect" | "timeout";

export interface SessionDoc {
  userId: string;
  agentId: string;
  agentName: string;
  processTag?: string;
  startedAt: number;
  endedAt?: number | null;
  durationSec?: number;
  status: SessionStatus;
  voiceUsed?: GrokVoice;
  counts?: {
    spoken: number;
    typed: number;
    catalogClicks: number;
    toolCalls: number;
    errors: number;
  };
  endReason?: EndReason;
  conversationId?: string;
}

export type TraceEventType =
  | "user_msg"
  | "assistant_msg"
  | "catalog_click"
  | "tool_call"
  | "tool_result"
  | "error"
  | "system";

export interface TraceEvent {
  ts: number;
  type: TraceEventType;
  role?: Role | "user" | "assistant";
  text?: string;
  questionId?: string;
  trackId?: string;
  tool?: {
    name: string;
    args?: unknown;
    status?: "ok" | "error";
    latencyMs?: number;
    resultPreview?: string;
  };
}

// ---- Function call contracts ---------------------------------------------
export interface LoginRequest {
  userid: string;
  password: string;
}
export interface LoginResponse {
  customToken: string;
  mustChangePassword: boolean;
  role: Role;
}

export interface MintTokenRequest {
  agentId: string;
}
export interface MintTokenResponse {
  token: unknown; // xAI ephemeral token payload
  sessionId: string;
  config: {
    model: string;
    instructions: string;
    voices: { default: GrokVoice; allowed: GrokVoice[] };
    tools: unknown[]; // resolved tool definitions to register in session.update
  };
}

export interface SearchRequest {
  sessionId: string;
  agentId: string;
  query: string;
}
export interface SearchResult {
  content: string;
  score: number;
  fileId?: string;
}
export interface SearchResponse {
  query: string;
  results: SearchResult[];
}
