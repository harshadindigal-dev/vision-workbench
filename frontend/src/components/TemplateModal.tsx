import { LayoutTemplate, X, FileSearch, Image, Box, Workflow } from 'lucide-react';

interface TemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (templateId: string) => void;
}

const templates = [
  {
    id: 'blueprint',
    title: 'Blueprint / Floor Plan Analysis',
    description: 'Detect rooms, doors, and generate structured graph JSON from architectural drawings.',
    icon: Workflow,
    color: 'bg-blue-500/10 text-blue-400 border-blue-500/20'
  },
  {
    id: 'document',
    title: 'Document Parsing (OCR + VLM)',
    description: 'Extract text blocks and use a VLM to parse key-value pairs from receipts or forms.',
    icon: FileSearch,
    color: 'bg-purple-500/10 text-purple-400 border-purple-500/20'
  },
  {
    id: 'scene',
    title: 'Scene Understanding',
    description: 'Segment all visible objects and generate a comprehensive descriptive caption.',
    icon: Image,
    color: 'bg-green-500/10 text-green-400 border-green-500/20'
  },
  {
    id: 'inventory',
    title: 'Object Inventory Detection',
    description: 'Find all instances of a specific product and count them.',
    icon: Box,
    color: 'bg-amber-500/10 text-amber-400 border-amber-500/20'
  }
];

export function TemplateModal({ isOpen, onClose, onSelectTemplate }: TemplateModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
          <h2 className="text-xl font-bold text-slate-200 flex items-center gap-2">
            <LayoutTemplate className="text-blue-500" />
            Start from Template
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 transition-colors p-1 rounded-md hover:bg-slate-700">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          <p className="text-slate-400 mb-6">Choose a pre-built linear workflow to get started quickly. You can customize the steps and parameters after loading.</p>
          
          <div className="grid grid-cols-2 gap-4">
            {templates.map(t => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => onSelectTemplate(t.id)}
                  className="text-left bg-slate-950 border border-slate-800 hover:border-slate-600 rounded-xl p-5 transition-all hover:shadow-lg hover:-translate-y-0.5 group"
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 border ${t.color}`}>
                    <Icon size={20} />
                  </div>
                  <h3 className="font-semibold text-slate-200 mb-2 group-hover:text-blue-400 transition-colors">{t.title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{t.description}</p>
                </button>
              )
            })}
          </div>
        </div>
        
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
