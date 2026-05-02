import { useState } from 'react';
import { Activity, Database, FileJson, Image as ImageIcon, Layers, Terminal } from 'lucide-react';
import { cn } from '../utils';

interface RightPanelProps {
  imagePreview: string | null;
  results: any;
}

export function RightPanel({ imagePreview, results }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<'visual' | 'json' | 'data' | 'logs'>('visual');
  const [layers, setLayers] = useState({ masks: true, bboxes: true, labels: true });
  const graphNodes = results?.graph?.nodes ?? [];
  const validNodes = graphNodes.filter((node: any) => node.validation?.status === 'valid').length;

  const tabs = [
    { id: 'visual', label: 'Inspector', icon: Layers },
    { id: 'json', label: 'JSON', icon: FileJson },
    { id: 'data', label: 'Data', icon: Database },
    { id: 'logs', label: 'Logs', icon: Terminal },
  ] as const;

  return (
    <div className="w-full 2xl:w-[460px] h-[44vh] 2xl:h-auto bg-ink-850 border-t 2xl:border-t-0 2xl:border-l border-ink-650 flex flex-col shrink-0 z-20">
      <div className="p-4 border-b border-ink-650 bg-ink-950">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="technical-label">Inspector</div>
            <h2 className="text-lg font-semibold text-slate-100">Runtime output</h2>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-ink-850 border border-ink-650 px-2 py-1">
            <Activity size={14} className={results ? 'text-cyan-precision' : 'text-slate-500'} />
            <span className="font-mono text-[11px] text-slate-400">{results ? 'READY' : 'IDLE'}</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md bg-ink-850 border border-ink-650 p-2">
            <div className="technical-label">Regions</div>
            <div className="technical-value">{results?.regions?.length ?? 0}</div>
          </div>
          <div className="rounded-md bg-ink-850 border border-ink-650 p-2">
            <div className="technical-label">Graph</div>
            <div className="technical-value">{graphNodes.length}</div>
          </div>
          <div className="rounded-md bg-ink-850 border border-ink-650 p-2">
            <div className="technical-label">Valid</div>
            <div className="technical-value">{validNodes}</div>
          </div>
        </div>
      </div>

      <div className="flex border-b border-ink-650 px-2 pt-2 bg-ink-850">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-4 py-2 text-xs font-medium flex items-center gap-2 border-b-2 transition-colors",
                isActive 
                  ? "border-cyan-precision text-cyan-precision" 
                  : "border-transparent text-slate-400 hover:text-slate-200"
              )}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 bg-ink-950 custom-scrollbar">
        {activeTab === 'visual' && (
          <div className="space-y-4">
            <div className="flex gap-2 bg-ink-850 p-2 rounded-lg border border-ink-650">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input type="checkbox" checked={layers.bboxes} onChange={e => setLayers(l => ({...l, bboxes: e.target.checked}))} className="accent-cyan-precision" />
                Bounding Boxes
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input type="checkbox" checked={layers.labels} onChange={e => setLayers(l => ({...l, labels: e.target.checked}))} className="accent-cyan-precision" />
                Labels
              </label>
            </div>

            <div className="bg-ink-850 border border-ink-650 rounded-lg overflow-hidden relative min-h-[300px] flex items-center justify-center">
              {!imagePreview ? (
                <div className="text-center text-slate-500">
                  <ImageIcon size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No image loaded</p>
                </div>
              ) : (
                <div className="relative w-full h-full">
                  <img src={imagePreview} alt="Preview" className="w-full h-auto block" />
                  
                  {/* Results Overlay */}
                  {results?.regions?.map((r: any, i: number) => {
                    const { x1, y1, x2, y2 } = r.context_bundle?.spatial_coords || {};
                    if (x1 === undefined || !layers.bboxes) return null;
                    return (
                      <div 
                        key={i}
                        className="absolute border-2 border-cyan-precision bg-cyan-precision/10 shadow-sm transition-all"
                        style={{
                          left: `${x1 * 100}%`,
                          top: `${y1 * 100}%`,
                          width: `${(x2 - x1) * 100}%`,
                          height: `${(y2 - y1) * 100}%`,
                        }}
                      >
                        {layers.labels && (
                          <span className="absolute -top-6 left-0 bg-cyan-precision text-ink-950 text-[10px] px-1.5 py-0.5 rounded shadow whitespace-nowrap font-bold">
                            {r.label} ({Math.round(r.confidence * 100)}%)
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'json' && (
          <div className="bg-ink-850 border border-ink-650 rounded-lg p-4 overflow-x-auto h-full">
             {results ? (
                <pre className="text-xs text-cyan-precision font-mono leading-relaxed">
                  {JSON.stringify(results, null, 2)}
                </pre>
             ) : (
                <p className="text-sm text-slate-500 text-center mt-10">Run the pipeline to generate JSON output.</p>
             )}
          </div>
        )}

        {activeTab === 'data' && (
           <div className="space-y-2">
             {graphNodes.length > 0 ? graphNodes.map((node: any) => (
              <div key={node.id} className="rounded-lg border border-ink-650 bg-ink-850 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="technical-label">{node.id}</div>
                    <div className="text-sm font-semibold text-slate-100">{node.label}</div>
                  </div>
                  <div className="technical-value">{Math.round((node.confidence ?? 0) * 100)}%</div>
                </div>
                <div className="mt-2 text-[11px] text-slate-500 font-mono truncate">
                  {node.validation?.status ?? 'unvalidated'} / {node.provenance?.source ?? 'unknown'}
                </div>
              </div>
             )) : (
              <div className="text-sm text-slate-500 text-center mt-10">
                Graph nodes will appear here after execution.
              </div>
             )}
           </div>
        )}

        {activeTab === 'logs' && (
           <div className="bg-ink-850 border border-ink-650 rounded-lg p-4 font-mono text-xs text-slate-400 h-full">
             <p>[System] Ready.</p>
             {results && <p className="text-cyan-precision mt-1">[System] Pipeline executed successfully.</p>}
           </div>
        )}
      </div>
    </div>
  );
}
