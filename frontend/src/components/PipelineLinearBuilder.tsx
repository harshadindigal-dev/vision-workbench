import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import axios from 'axios';
import { TopBar } from './TopBar';
import { StepCard } from './StepCard';
import { RightPanel } from './RightPanel';
import { TemplateModal } from './TemplateModal';
import type { StepConfig, StepType, WorkflowConnection } from '../types';
import { Boxes, BrainCircuit, CircuitBoard, FileJson, Image as ImageIcon, Plus, UploadCloud, Workflow } from 'lucide-react';

const generateId = () => Math.random().toString(36).substring(2, 9);

const moduleDefaults: Record<StepType, Omit<StepConfig, 'id' | 'status' | 'isAdvancedOpen' | 'isSchemaOpen'>> = {
  ingest: { type: 'ingest', title: 'Image Ingest', scope: 'entire_image' },
  decompose: { type: 'decompose', title: 'Detector', scope: 'entire_image', model: 'yolov8n.pt', confidence: 0.5 },
  context: { type: 'context', title: 'Context Bundle', scope: 'entire_image' },
  llm: { type: 'llm', title: 'OpenAI Vision', scope: 'per_region', prompt: 'Identify the object in this crop.' },
  output: { type: 'output', title: 'Graph Output', scope: 'entire_image' },
};

const modulePalette: Array<{ type: StepType; title: string; detail: string; icon: any }> = [
  { type: 'ingest', title: 'Image Ingest', detail: 'Source media entrypoint', icon: ImageIcon },
  { type: 'decompose', title: 'Detector', detail: 'YOLO boxes, confidence gates', icon: Boxes },
  { type: 'context', title: 'Context', detail: 'Crop + spatial bundle', icon: CircuitBoard },
  { type: 'llm', title: 'OpenAI Vision', detail: 'Schema-aware semantic pass', icon: BrainCircuit },
  { type: 'output', title: 'Output', detail: 'Graph + JSON aggregation', icon: FileJson },
];

function createsCycle(steps: StepConfig[], connections: WorkflowConnection[], from: string, to: string) {
  const adjacency = new Map<string, string[]>();
  for (const step of steps) adjacency.set(step.id, []);
  for (const connection of connections) {
    adjacency.get(connection.from)?.push(connection.to);
  }
  adjacency.get(from)?.push(to);

  const seen = new Set<string>();
  const stack = [to];
  while (stack.length) {
    const node = stack.pop();
    if (!node || seen.has(node)) continue;
    if (node === from) return true;
    seen.add(node);
    stack.push(...(adjacency.get(node) ?? []));
  }
  return false;
}

function topoSort(steps: StepConfig[], connections: WorkflowConnection[]) {
  const byId = new Map(steps.map(step => [step.id, step]));
  const indegree = new Map(steps.map(step => [step.id, 0]));
  const adjacency = new Map(steps.map(step => [step.id, [] as string[]]));

  for (const connection of connections) {
    if (!byId.has(connection.from) || !byId.has(connection.to)) continue;
    adjacency.get(connection.from)?.push(connection.to);
    indegree.set(connection.to, (indegree.get(connection.to) ?? 0) + 1);
  }

  const displayOrder = new Map(steps.map((step, index) => [step.id, index]));
  const queue = steps.filter(step => (indegree.get(step.id) ?? 0) === 0);
  const sorted: StepConfig[] = [];

  while (queue.length) {
    queue.sort((a, b) => (displayOrder.get(a.id) ?? 0) - (displayOrder.get(b.id) ?? 0));
    const current = queue.shift()!;
    sorted.push(current);
    for (const target of adjacency.get(current.id) ?? []) {
      indegree.set(target, (indegree.get(target) ?? 0) - 1);
      if ((indegree.get(target) ?? 0) === 0) {
        const next = byId.get(target);
        if (next) queue.push(next);
      }
    }
  }

  if (sorted.length !== steps.length) {
    throw new Error('Workflow contains a cycle. Remove one connection before running.');
  }
  return sorted;
}

export function PipelineLinearBuilder() {
  const [steps, setSteps] = useState<StepConfig[]>([]);
  const [connections, setConnections] = useState<WorkflowConnection[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setImagePreview(URL.createObjectURL(selectedFile));
    }
  };

  const updateStep = (id: string, updates: Partial<StepConfig>) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const duplicateStep = (id: string) => {
    setSteps(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx === -1) return prev;
      const newStep = { ...prev[idx], id: generateId(), title: `${prev[idx].title} Copy`, status: 'idle' as const };
      const newSteps = [...prev];
      newSteps.splice(idx + 1, 0, newStep);
      return newSteps;
    });
  };

  const deleteStep = (id: string) => {
    setSteps(prev => prev.filter(s => s.id !== id));
    setConnections(prev => prev.filter(c => c.from !== id && c.to !== id));
  };

  const moveStep = (id: string, direction: 'up' | 'down') => {
    setSteps(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx === -1) return prev;
      if (direction === 'up' && idx === 0) return prev;
      if (direction === 'down' && idx === prev.length - 1) return prev;

      const newSteps = [...prev];
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      [newSteps[idx], newSteps[swapIdx]] = [newSteps[swapIdx], newSteps[idx]];
      return newSteps;
    });
  };

  const addStep = (type: StepType) => {
    const defaults = moduleDefaults[type];
    const sameTypeCount = steps.filter(step => step.type === type).length + 1;
    const newStep: StepConfig = {
      ...defaults,
      id: generateId(),
      title: sameTypeCount > 1 ? `${defaults.title} ${sameTypeCount}` : defaults.title,
      status: 'idle',
      isAdvancedOpen: false,
      isSchemaOpen: false,
    };
    setSteps(prev => [...prev, newStep]);
  };

  const addConnection = (from: string, to: string) => {
    if (!from || !to || from === to) return;
    if (connections.some(connection => connection.from === from && connection.to === to)) return;
    if (createsCycle(steps, connections, from, to)) {
      alert('That connection would create a cycle. Workflows must stay acyclic.');
      return;
    }
    setConnections(prev => [...prev, { id: generateId(), from, to }]);
  };

  const removeConnection = (id: string) => {
    setConnections(prev => prev.filter(connection => connection.id !== id));
  };

  const orderedSteps = useMemo(() => {
    try {
      return topoSort(steps, connections);
    } catch {
      return steps;
    }
  }, [steps, connections]);

  const validationCount = results?.graph?.nodes?.filter((n: any) => n.validation?.status === 'valid').length ?? 0;

  const runPipeline = async () => {
    if (!file) return alert('Please upload an image first.');
    if (steps.length === 0) return alert('Add at least one module before running.');
    setIsRunning(true);
    setResults(null);
    setSteps(prev => prev.map(s => ({ ...s, status: 'running' })));

    try {
      const executionSteps = topoSort(steps, connections);
      const formData = new FormData();
      formData.append('file', file);

      const config = {
        graph: {
          nodes: steps.map(n => ({ id: n.id, type: n.type, title: n.title })),
          edges: connections.map(c => ({ from: c.from, to: c.to })),
          execution_order: executionSteps.map(step => step.id),
        },
        nodes: executionSteps.map(n => ({
          id: n.id,
          type: n.type,
          model: n.model,
          confidence: n.confidence,
          prompt: n.prompt,
          schema: n.schema,
          scope: n.scope
        }))
      };

      formData.append('pipeline_config', JSON.stringify(config));

      const response = await axios.post('http://localhost:8000/api/pipeline/run', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (response.data?.status === 'error') {
        throw new Error(response.data.message || 'Unknown backend error');
      }

      setResults(response.data);
      setSteps(prev => prev.map(s => ({ ...s, status: 'completed' })));

      if (response.data.regions && response.data.regions.length === 0) {
        alert('Pipeline completed successfully, but YOLO found no objects. Try lowering the detector confidence.');
      }
    } catch (error: any) {
      console.error(error);
      alert('Error running workflow: ' + error.message);
      setSteps(prev => prev.map(s => ({ ...s, status: 'error' })));
    } finally {
      setIsRunning(false);
    }
  };

  const handleSelectTemplate = (templateId: string) => {
    if (templateId === 'blueprint') {
      const ingestId = generateId();
      const detectorId = generateId();
      const contextId = generateId();
      const vlmId = generateId();
      const outputId = generateId();
      setSteps([
        { ...moduleDefaults.ingest, id: ingestId, title: 'Upload Blueprint', status: 'idle', isAdvancedOpen: false, isSchemaOpen: false },
        { ...moduleDefaults.decompose, id: detectorId, title: 'Detect Rooms', confidence: 0.3, status: 'idle', isAdvancedOpen: false, isSchemaOpen: false },
        { ...moduleDefaults.context, id: contextId, title: 'Extract Crops', status: 'idle', isAdvancedOpen: false, isSchemaOpen: false },
        {
          ...moduleDefaults.llm,
          id: vlmId,
          title: 'Analyze Room Features',
          prompt: 'Analyze this room crop. Identify any doors, windows, or text labels.',
          schema: '{"type":"object", "properties":{"roomType":{"type":"string"}, "hasWindows":{"type":"boolean"}}}',
          status: 'idle',
          isAdvancedOpen: false,
          isSchemaOpen: false,
        },
        { ...moduleDefaults.output, id: outputId, title: 'Compile Floorplan JSON', status: 'idle', isAdvancedOpen: false, isSchemaOpen: false }
      ]);
      setConnections([
        { id: generateId(), from: ingestId, to: detectorId },
        { id: generateId(), from: detectorId, to: contextId },
        { id: generateId(), from: contextId, to: vlmId },
        { id: generateId(), from: vlmId, to: outputId },
      ]);
    }
    setIsTemplateModalOpen(false);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-ink-950 overflow-hidden text-slate-200">
      <TopBar
        onRun={runPipeline}
        isRunning={isRunning}
        onOpenTemplates={() => setIsTemplateModalOpen(true)}
      />

      <div className="flex flex-1 overflow-hidden relative flex-col 2xl:flex-row">
        <div className="w-72 hidden xl:flex flex-col border-r border-ink-650 bg-ink-850 shrink-0">
          <div className="p-4 border-b border-ink-650">
            <div className="technical-label mb-1">Module Library</div>
            <h2 className="text-lg font-semibold text-slate-100">Add graph modules</h2>
          </div>
          <div className="p-3 space-y-2 overflow-y-auto custom-scrollbar">
            {modulePalette.map(module => {
              const Icon = module.icon;
              return (
                <button
                  key={module.type}
                  onClick={() => addStep(module.type)}
                  className="w-full text-left flex items-center gap-3 p-3 rounded-lg border border-transparent bg-ink-900 hover:border-cyan-precision/40 hover:bg-ink-800 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-md bg-cyan-precision/10 border border-cyan-precision/20 flex items-center justify-center text-cyan-precision">
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-100 group-hover:text-cyan-precision">{module.title}</div>
                    <div className="text-[11px] text-slate-500 truncate">{module.detail}</div>
                  </div>
                </button>
              )
            })}
          </div>
          <div className="mt-auto p-4 border-t border-ink-650 bg-ink-950/60">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md bg-ink-800 border border-ink-650 p-2">
                <div className="technical-label">Nodes</div>
                <div className="technical-value">{steps.length}</div>
              </div>
              <div className="rounded-md bg-ink-800 border border-ink-650 p-2">
                <div className="technical-label">Edges</div>
                <div className="technical-value">{connections.length}</div>
              </div>
              <div className="rounded-md bg-ink-800 border border-ink-650 p-2">
                <div className="technical-label">Valid</div>
                <div className="technical-value">{validationCount}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto custom-scrollbar relative workflow-canvas-grid">
          <div className="max-w-6xl w-full mx-auto p-5 lg:p-8 pb-32">
            <div className="mb-5 technical-panel rounded-lg p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="technical-label mb-1">DAG Canvas</div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-100">Build a visual intelligence workflow</h2>
                <p className="text-sm text-slate-400 mt-1">Add modules, connect directed edges, and run the topologically sorted execution graph.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {modulePalette.map(module => {
                    const Icon = module.icon;
                    return (
                      <button
                        key={module.type}
                        onClick={() => addStep(module.type)}
                        className="inline-flex items-center gap-2 rounded-md bg-ink-900 border border-ink-650 hover:border-cyan-precision/50 px-3 py-2 text-xs font-semibold text-slate-100 transition-colors"
                      >
                        <Icon size={14} className="text-cyan-precision" />
                        {module.title}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="px-3 py-2 rounded-md bg-ink-900 border border-ink-650">
                  <div className="technical-label">Execution</div>
                  <div className="technical-value">DAG</div>
                </div>
                <div className="px-3 py-2 rounded-md bg-ink-900 border border-ink-650">
                  <div className="technical-label">Provider</div>
                  <div className="technical-value">OPENAI</div>
                </div>
              </div>
            </div>

            <div className="mb-6 technical-panel rounded-lg relative hover:border-cyan-precision/50 transition-colors group cursor-pointer overflow-hidden">
              <input
                type="file"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                accept="image/*"
                onChange={handleFileChange}
              />
              <div className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-12 h-12 rounded-lg bg-cyan-precision/10 flex items-center justify-center border border-cyan-precision/20 group-hover:border-cyan-precision/60 transition-colors">
                    {file ? <ImageIcon size={22} className="text-cyan-precision" /> : <UploadCloud size={22} className="text-cyan-precision" />}
                  </div>
                  <div className="min-w-0">
                    <div className="technical-label">Input Media</div>
                    <h3 className="text-base font-semibold text-slate-100 truncate">
                      {file ? file.name : 'Drop image or click to browse'}
                    </h3>
                  </div>
                </div>
                <div className="hidden md:flex items-center gap-3 text-xs font-mono text-slate-500">
                  <span>{file ? 'SOURCE_READY' : 'AWAITING_SOURCE'}</span>
                  <span className={`w-2 h-2 rounded-full ${file ? 'bg-cyan-precision' : 'bg-slate-600'}`} />
                </div>
              </div>
            </div>

            {steps.length === 0 ? (
              <div className="technical-panel rounded-lg p-8 text-center">
                <div className="mx-auto w-12 h-12 rounded-lg border border-cyan-precision/30 bg-cyan-precision/10 flex items-center justify-center text-cyan-precision mb-4">
                  <Workflow size={22} />
                </div>
                <h3 className="text-xl font-semibold text-slate-100">Empty workflow canvas</h3>
                <p className="text-sm text-slate-400 mt-2 max-w-lg mx-auto">
                  Add modules from the library, then connect each module's inputs to upstream outputs. The workflow must remain acyclic.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {modulePalette.map(module => (
                    <button
                      key={module.type}
                      onClick={() => addStep(module.type)}
                      className="px-3 py-2 rounded-md bg-ink-800 border border-ink-650 hover:border-cyan-precision/50 text-sm font-semibold text-slate-100 transition-colors"
                    >
                      Add {module.title}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {steps.map((step, index) => (
                  <StepCard
                    key={step.id}
                    step={step}
                    index={index}
                    totalSteps={steps.length}
                    steps={steps}
                    connections={connections}
                    orderedIndex={orderedSteps.findIndex(ordered => ordered.id === step.id)}
                    onUpdate={updateStep}
                    onDuplicate={duplicateStep}
                    onDelete={deleteStep}
                    onMove={moveStep}
                    onConnect={addConnection}
                    onDisconnect={removeConnection}
                  />
                ))}
              </div>
            )}

            {steps.length > 0 && (
              <div className="mt-5 technical-panel rounded-lg p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <div className="technical-label">Graph Edges</div>
                    <h3 className="font-semibold text-slate-100">Connection map</h3>
                  </div>
                  <button
                    onClick={() => addStep('llm')}
                    className="flex items-center gap-2 bg-ink-850 hover:bg-ink-800 border border-ink-650 hover:border-cyan-precision/50 text-slate-200 px-3 py-2 rounded-md text-sm font-semibold transition-colors"
                  >
                    <Plus size={15} />
                    Add Module
                  </button>
                </div>
                {connections.length === 0 ? (
                  <p className="text-sm text-slate-500">No edges yet. Use each module's input selector to connect upstream modules.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {connections.map(connection => {
                      const from = steps.find(step => step.id === connection.from);
                      const to = steps.find(step => step.id === connection.to);
                      return (
                        <div key={connection.id} className="rounded-md bg-ink-900 border border-ink-650 px-3 py-2 font-mono text-xs text-slate-300">
                          <span className="text-cyan-precision">{from?.title ?? connection.from}</span>
                          <span className="mx-2 text-slate-600">-&gt;</span>
                          <span>{to?.title ?? connection.to}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <RightPanel imagePreview={imagePreview} results={results} />
      </div>

      <TemplateModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        onSelectTemplate={handleSelectTemplate}
      />
    </div>
  );
}
