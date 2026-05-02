import { useState } from 'react';
import { PipelineLinearBuilder } from './components/PipelineLinearBuilder';
import { TrainingStudio } from './components/TrainingStudio';
import { BrowserSessionLearning } from './components/BrowserSessionLearning';
import { Workflow, PlaySquare, Clapperboard } from 'lucide-react';
import { cn } from './utils';

function App() {
  const [activeTab, setActiveTab] = useState<'pipeline' | 'training' | 'session'>('pipeline');

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-950">
      {/* Global Navigation Header */}
      <header className="h-12 border-b border-slate-800 flex items-center justify-center shrink-0 bg-slate-900 shadow-sm relative z-50">
        <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 shadow-inner">
          <button
            onClick={() => setActiveTab('pipeline')}
            className={cn(
              "px-6 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all",
              activeTab === 'pipeline' 
                ? "bg-slate-800 text-slate-200 shadow" 
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-900"
            )}
          >
            <Workflow size={16} />
            Workflow Studio
          </button>
          <button
            onClick={() => setActiveTab('training')}
            className={cn(
              "px-6 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all",
              activeTab === 'training' 
                ? "bg-slate-800 text-slate-200 shadow" 
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-900"
            )}
          >
            <PlaySquare size={16} />
            Train Custom Model
          </button>
          <button
            onClick={() => setActiveTab('session')}
            className={cn(
              "px-6 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all",
              activeTab === 'session'
                ? "bg-slate-800 text-slate-200 shadow"
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-900"
            )}
          >
            <Clapperboard size={16} />
            Session learning
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 relative">
        {activeTab === 'pipeline' ? (
          <PipelineLinearBuilder />
        ) : activeTab === 'training' ? (
          <TrainingStudio />
        ) : (
          <BrowserSessionLearning />
        )}
      </div>
    </div>
  );
}

export default App;
