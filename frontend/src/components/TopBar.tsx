import { Play, Save, FolderOpen, RotateCcw, LayoutTemplate, Settings } from "lucide-react"

interface TopBarProps {
  onRun: () => void;
  isRunning: boolean;
  onOpenTemplates: () => void;
}

export function TopBar({ onRun, isRunning, onOpenTemplates }: TopBarProps) {
  return (
    <div className="h-16 border-b border-ink-650 bg-ink-950 flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-4">
        <h1 className="font-black text-slate-100 tracking-tight text-lg flex items-center gap-3">
          <div className="w-8 h-8 bg-cyan-precision/10 rounded-lg flex items-center justify-center border border-cyan-precision/40">
            <span className="text-cyan-precision text-xs font-black">CV</span>
          </div>
          Workflow Studio
        </h1>
        <div className="hidden md:flex items-center gap-2 bg-ink-850 border border-ink-650 rounded-md px-3 py-1">
          <span className="w-2 h-2 rounded-full bg-cyan-precision animate-pulse" />
          <span className="font-mono text-[11px] text-cyan-precision">VISUAL_GRAPH_RUNTIME</span>
        </div>
        <div className="h-4 w-[1px] bg-ink-650" />
        <button 
          onClick={onOpenTemplates}
          className="text-sm font-medium text-slate-400 hover:text-cyan-precision flex items-center gap-1.5 transition-colors"
        >
          <LayoutTemplate size={16} />
          Templates
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button className="p-2 text-slate-400 hover:text-slate-200 hover:bg-ink-850 rounded-md transition-colors" title="Reset">
          <RotateCcw size={18} />
        </button>
        <button className="p-2 text-slate-400 hover:text-slate-200 hover:bg-ink-850 rounded-md transition-colors" title="Save Workflow">
          <Save size={18} />
        </button>
        <button className="p-2 text-slate-400 hover:text-slate-200 hover:bg-ink-850 rounded-md transition-colors" title="Load Workflow">
          <FolderOpen size={18} />
        </button>
        <button className="p-2 text-slate-400 hover:text-slate-200 hover:bg-ink-850 rounded-md transition-colors" title="Settings">
          <Settings size={18} />
        </button>
        <div className="h-4 w-[1px] bg-ink-650 mx-2" />
        <button
          onClick={onRun}
          disabled={isRunning}
          className="flex items-center gap-2 bg-cyan-precision hover:bg-cyan-200 disabled:bg-ink-700 disabled:text-slate-500 text-ink-950 px-5 py-2 rounded-md font-bold transition-colors text-sm shadow-sm"
        >
          {isRunning ? (
             <div className="w-4 h-4 border-2 border-ink-950 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Play size={16} fill="currentColor" />
          )}
          {isRunning ? 'Running...' : 'Run Pipeline'}
        </button>
      </div>
    </div>
  )
}
