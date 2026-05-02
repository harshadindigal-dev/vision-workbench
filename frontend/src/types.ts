export type StepType = 'ingest' | 'decompose' | 'context' | 'llm' | 'output';

export interface StepConfig {
  id: string;
  type: StepType;
  title: string;
  scope: 'entire_image' | 'per_region' | 'per_object';
  model?: string;
  confidence?: number;
  prompt?: string;
  schema?: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  // UI state
  isAdvancedOpen: boolean;
  isSchemaOpen: boolean;
}

export interface WorkflowConnection {
  id: string;
  from: string;
  to: string;
}

export interface PipelineData {
  steps: StepConfig[];
  connections: WorkflowConnection[];
}
