import { useState, useEffect } from 'react';
import axios from 'axios';
import type { StepConfig, StepType, WorkflowConnection } from '../types';
import { Trash2, Copy, ArrowUp, ArrowDown, CheckCircle2, CircleDashed, Loader2, Image as ImageIcon, BoxSelect, Camera, Sparkles, FileJson, ChevronDown, ChevronRight, Link2, X } from 'lucide-react';
import { cn } from '../utils';

interface StepCardProps {
  step: StepConfig;
  index: number;
  totalSteps: number;
  orderedIndex: number;
  steps: StepConfig[];
  connections: WorkflowConnection[];
  onUpdate: (id: string, updates: Partial<StepConfig>) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onConnect: (from: string, to: string) => void;
  onDisconnect: (id: string) => void;
}

const typeIcons = {
  ingest: ImageIcon,
  decompose: BoxSelect,
  context: Camera,
  llm: Sparkles,
  output: FileJson,
};

const statusColors = {
  idle: 'text-slate-500',
  running: 'text-cyan-precision',
  completed: 'text-cyan-precision',
  error: 'text-red-400'
};

const typeMeta = {
  ingest: { label: 'INGEST', tone: 'text-slate-300', chip: 'bg-slate-500/10 border-slate-500/20' },
  decompose: { label: 'CV', tone: 'text-cyan-precision', chip: 'bg-cyan-precision/10 border-cyan-precision/20' },
  context: { label: 'CONTEXT', tone: 'text-blue-300', chip: 'bg-blue-400/10 border-blue-400/20' },
  llm: { label: 'VLM', tone: 'text-violet-300', chip: 'bg-violet-400/10 border-violet-400/20' },
  output: { label: 'OUTPUT', tone: 'text-emerald-300', chip: 'bg-emerald-400/10 border-emerald-400/20' },
};

export function StepCard({
  step,
  index,
  totalSteps,
  orderedIndex,
  steps,
  connections,
  onUpdate,
  onDuplicate,
  onDelete,
  onMove,
  onConnect,
  onDisconnect,
}: StepCardProps) {
  const Icon = typeIcons[step.type];
  const meta = typeMeta[step.type];
  const [customModels, setCustomModels] = useState<{id: string, path: string}[]>([]);
  const [selectedSource, setSelectedSource] = useState('');

  const incoming = connections.filter(connection => connection.to === step.id);
  const outgoing = connections.filter(connection => connection.from === step.id);
  const connectableSources = steps.filter(candidate =>
    candidate.id !== step.id &&
    !incoming.some(connection => connection.from === candidate.id)
  );

  useEffect(() => {
    if (step.type === 'decompose') {
      axios.get('http://localhost:8000/api/training/models')
        .then(res => setCustomModels(res.data))
        .catch(err => console.error(err));
    }
  }, [step.type]);

  return (
    <div className={cn(
      "technical-panel rounded-lg overflow-hidden mb-4 group relative shadow-xl",
      step.status === 'running' && "border-cyan-precision/70",
      step.status === 'completed' && "border-cyan-precision/40"
    )}>
      <div className="px-4 py-3 bg-ink-800 border-b border-ink-650 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn("w-9 h-9 rounded-md flex items-center justify-center border", meta.chip, meta.tone)}>
            <Icon size={17} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="technical-label">
                {String(index + 1).padStart(2, '0')} / {meta.label}
                {orderedIndex >= 0 ? ` / RUN ${String(orderedIndex + 1).padStart(2, '0')}` : ''}
              </span>
              <span className={cn("w-1.5 h-1.5 rounded-full", step.status === 'completed' ? 'bg-cyan-precision' : step.status === 'running' ? 'bg-cyan-precision animate-pulse' : step.status === 'error' ? 'bg-red-400' : 'bg-slate-600')} />
            </div>
            <input
              type="text"
              value={step.title}
              onChange={(e) => onUpdate(step.id, { title: e.target.value })}
              className="bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-cyan-precision/70 rounded px-0.5 font-semibold text-slate-100 text-sm w-full"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onMove(step.id, 'up')} disabled={index === 0} className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-ink-700 disabled:opacity-30"><ArrowUp size={14} /></button>
            <button onClick={() => onMove(step.id, 'down')} disabled={index === totalSteps - 1} className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-ink-700 disabled:opacity-30"><ArrowDown size={14} /></button>
            <div className="w-[1px] h-4 bg-ink-650 mx-1" />
            <button onClick={() => onDuplicate(step.id)} className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-ink-700"><Copy size={14} /></button>
            <button onClick={() => onDelete(step.id)} className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10"><Trash2 size={14} /></button>
          </div>
          <div className="w-[1px] h-4 bg-ink-650 mx-1" />
          {step.status === 'idle' && <CircleDashed size={16} className={statusColors.idle} />}
          {step.status === 'running' && <Loader2 size={16} className={cn(statusColors.running, "animate-spin")} />}
          {step.status === 'completed' && <CheckCircle2 size={16} className={statusColors.completed} />}
        </div>
      </div>

      <div className="px-4 py-3 border-b border-ink-650 bg-ink-900/60">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <div className="technical-label mb-1">Inputs</div>
            <div className="flex flex-wrap gap-1.5 min-h-7">
              {incoming.length === 0 ? (
                <span className="text-xs text-slate-600 font-mono">NO_UPSTREAM</span>
              ) : incoming.map(connection => {
                const source = steps.find(candidate => candidate.id === connection.from);
                return (
                  <button
                    key={connection.id}
                    onClick={() => onDisconnect(connection.id)}
                    className="inline-flex items-center gap-1 rounded bg-cyan-precision/10 border border-cyan-precision/20 text-cyan-precision px-2 py-1 text-[11px] font-mono hover:bg-red-500/10 hover:text-red-300 hover:border-red-400/30"
                  >
                    <Link2 size={11} />
                    {source?.title ?? connection.from}
                    <X size={11} />
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <div className="technical-label mb-1">Connect Input</div>
            <div className="flex gap-2">
              <select
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
                className="min-w-0 flex-1 bg-ink-950 border border-ink-650 rounded-md px-2 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-precision font-mono text-xs"
              >
                <option value="">Select upstream...</option>
                {connectableSources.map(candidate => (
                  <option key={candidate.id} value={candidate.id}>{candidate.title}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  if (!selectedSource) return;
                  onConnect(selectedSource, step.id);
                  setSelectedSource('');
                }}
                disabled={!selectedSource}
                className="px-3 py-1.5 rounded-md bg-cyan-precision disabled:bg-ink-700 disabled:text-slate-500 text-ink-950 font-bold text-xs"
              >
                Link
              </button>
            </div>
          </div>
        </div>
        {outgoing.length > 0 && (
          <div className="mt-3 border-t border-ink-650 pt-3">
            <div className="technical-label mb-1">Outputs</div>
            <div className="flex flex-wrap gap-1.5">
              {outgoing.map(connection => {
                const target = steps.find(candidate => candidate.id === connection.to);
                return (
                  <span key={connection.id} className="inline-flex items-center gap-1 rounded bg-ink-800 border border-ink-650 px-2 py-1 text-[11px] font-mono text-slate-400">
                    {target?.title ?? connection.to}
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="p-4 flex gap-4 text-sm bg-ink-850">
        <div className="flex-1 space-y-4">
          <div className="grid grid-cols-2 gap-4">
             <div>
               <label className="technical-label block mb-1">Task Type</label>
               <select 
                 value={step.type}
                 onChange={(e) => onUpdate(step.id, { type: e.target.value as StepType })}
                 className="w-full bg-ink-950 border border-ink-650 rounded-md px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-precision font-mono text-xs"
               >
                 <option value="ingest">Image Ingest</option>
                 <option value="decompose">Decompose (YOLO)</option>
                 <option value="context">Context Injection</option>
                 <option value="llm">VLM Reasoning</option>
                 <option value="output">Output Aggregation</option>
               </select>
             </div>
             
             {step.type !== 'ingest' && step.type !== 'output' && (
               <div>
                 <label className="technical-label block mb-1">Execution Scope</label>
                 <select 
                   value={step.scope}
                   onChange={(e) => onUpdate(step.id, { scope: e.target.value as StepConfig['scope'] })}
                   className="w-full bg-ink-950 border border-ink-650 rounded-md px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-precision font-mono text-xs"
                 >
                   <option value="entire_image">Entire Image</option>
                   <option value="per_region">Per Region (Loop)</option>
                   <option value="per_object">Per Object (Loop)</option>
                 </select>
               </div>
             )}
          </div>

          {step.type === 'decompose' && (
            <div>
               <label className="technical-label block mb-1">Model</label>
               <select 
                 value={step.model || 'yolov8n.pt'}
                 onChange={(e) => onUpdate(step.id, { model: e.target.value })}
                 className="w-full bg-ink-950 border border-ink-650 rounded-md px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-precision font-mono text-xs"
               >
                 <optgroup label="Pretrained Models">
                   <option value="yolov8n.pt">YOLOv8 Nano (Fastest)</option>
                   <option value="yolov8s.pt">YOLOv8 Small</option>
                 </optgroup>
                 {customModels.length > 0 && (
                   <optgroup label="Custom Models">
                     {customModels.map(m => (
                       <option key={m.id} value={m.path}>{m.id} (Custom)</option>
                     ))}
                   </optgroup>
                 )}
               </select>
            </div>
          )}

          {step.type === 'llm' && (
             <div>
               <label className="technical-label block mb-1">VLM Prompt</label>
               <div className="border border-ink-650 rounded-md overflow-hidden focus-within:border-cyan-precision">
                  <textarea 
                    value={step.prompt}
                    onChange={(e) => onUpdate(step.id, { prompt: e.target.value })}
                    placeholder="Describe the object... Use {image_crop} or {spatial_context}"
                    className="w-full bg-ink-950 p-3 text-slate-200 focus:outline-none min-h-[80px] resize-y font-mono text-xs"
                  />
                  <div className="bg-ink-800 px-2 py-1.5 border-t border-ink-650 flex gap-2">
                    <span className="text-[10px] text-slate-500 uppercase font-semibold">Variables:</span>
                    <button className="text-[10px] bg-ink-700 hover:bg-ink-650 text-slate-300 px-1.5 rounded cursor-pointer transition-colors font-mono">{`{image_crop}`}</button>
                    <button className="text-[10px] bg-ink-700 hover:bg-ink-650 text-slate-300 px-1.5 rounded cursor-pointer transition-colors font-mono">{`{spatial_context}`}</button>
                  </div>
               </div>
             </div>
          )}
        </div>
      </div>

      {/* Advanced Settings Toggle */}
      {(step.type === 'decompose' || step.type === 'llm') && (
        <div className="bg-ink-850 border-t border-ink-650">
           <button 
             onClick={() => onUpdate(step.id, { isAdvancedOpen: !step.isAdvancedOpen })}
             className="w-full px-4 py-2 flex items-center gap-2 technical-label hover:text-slate-200 hover:bg-ink-800 transition-colors"
           >
             {step.isAdvancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
             Advanced Settings
           </button>
           
           {step.isAdvancedOpen && (
             <div className="p-4 pt-0 bg-ink-800/40 text-sm grid grid-cols-2 gap-4">
                {step.type === 'decompose' && (
                  <div>
                    <label className="block text-xs text-slate-400 mb-2 flex justify-between">
                      <span>Confidence Threshold</span>
                      <span className="technical-value">{step.confidence || 0.5}</span>
                    </label>
                    <input 
                      type="range" min="0" max="1" step="0.05"
                      value={step.confidence || 0.5}
                      onChange={(e) => onUpdate(step.id, { confidence: parseFloat(e.target.value) })}
                      className="w-full accent-cyan-precision"
                    />
                  </div>
                )}
                {step.type === 'llm' && (
                  <div className="col-span-2">
                    <label className="technical-label block mb-1">Output Schema (JSON Schema)</label>
                    <textarea 
                      value={step.schema || ''}
                      onChange={(e) => onUpdate(step.id, { schema: e.target.value })}
                      placeholder='{ "type": "object", "properties": { ... } }'
                      className="w-full bg-ink-950 border border-ink-650 rounded-md p-2 text-slate-300 font-mono text-xs focus:outline-none focus:border-cyan-precision min-h-[100px]"
                    />
                  </div>
                )}
             </div>
           )}
        </div>
      )}
    </div>
  );
}
