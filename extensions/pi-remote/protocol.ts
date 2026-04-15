// Server -> Client messages
export type ServerMessage = 
  | InitMessage
  | EventMessage
  | ResponseMessage
  | ShutdownMessage
  | UIRequestMessage;

export interface InitMessage {
  type: 'init';
  state: {
    model: any;
    thinkingLevel: string;
    isStreaming: boolean;
    messages: any[];
    sessionFile: string | null;
    sessionName: string | null;
  };
}

export interface EventMessage {
  type: 'event';
  event: any;
}

export interface ResponseMessage {
  type: 'response';
  command: string;
  success: boolean;
  id?: string;
  data?: any;
  error?: string;
}

export interface ShutdownMessage {
  type: 'shutdown';
}

export interface UIRequestMessage {
  type: 'ui_request';
  id: string;
  method: 'select' | 'confirm' | 'input' | 'notify';
  title: string;
  message?: string;
  options?: string[];
}

// Client -> Server messages
export type ClientMessage =
  | AuthMessage
  | ConnectMessage
  | PromptMessage
  | AbortMessage
  | SetModelMessage
  | CycleModelMessage
  | CycleThinkingMessage
  | CompactMessage
  | NewSessionMessage
  | ForkMessage
  | ListSessionsMessage
  | SwitchModeMessage
  | UIResponseMessage;

export interface AuthMessage {
  type: 'auth';
  token: string;
}

export interface ConnectMessage {
  type: 'connect';
  mode: 'mirror' | 'independent';
  session?: 'new' | 'resume';
  sessionFile?: string;
}

export interface PromptMessage {
  type: 'prompt';
  message: string;
  id?: string;
  streamingBehavior?: 'steer' | 'followUp';
}

export interface AbortMessage {
  type: 'abort';
  id?: string;
}

export interface SetModelMessage {
  type: 'set_model';
  provider: string;
  modelId: string;
  id?: string;
}

export interface CycleModelMessage {
  type: 'cycle_model';
  id?: string;
}

export interface CycleThinkingMessage {
  type: 'cycle_thinking_level';
  id?: string;
}

export interface CompactMessage {
  type: 'compact';
  id?: string;
}

export interface NewSessionMessage {
  type: 'new_session';
  id?: string;
}

export interface ForkMessage {
  type: 'fork';
  entryId: string;
  id?: string;
}

export interface ListSessionsMessage {
  type: 'list_sessions';
  id?: string;
}

export interface SwitchModeMessage {
  type: 'switch_mode';
  mode: 'mirror' | 'independent';
  session?: 'new' | 'resume';
  sessionFile?: string;
  id?: string;
}

export interface UIResponseMessage {
  type: 'ui_response';
  id: string;
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

// Helper functions
export function parseClientMessage(data: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
      return parsed as ClientMessage;
    }
    return null;
  } catch {
    return null;
  }
}

export function serializeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}
