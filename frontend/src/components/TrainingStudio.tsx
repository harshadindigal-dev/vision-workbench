import { useState, useRef, useEffect } from 'react';
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent } from 'react';
import axios from 'axios';
import { Upload, Save, Play, Loader2, Image as ImageIcon, Trash2, CheckCircle2, Circle, Sparkles, Pencil, ScanSearch } from 'lucide-react';
import { cn } from '../utils';

interface Box {
  id: string;
  x_center: number;
  y_center: number;
  width: number;
  height: number;
  class_name: string;
  isLoading?: boolean;
  isEditing?: boolean;
  confidence?: number;
  source?: string;
}

interface ImageStatus {
  filename: string;
  annotated: boolean;
}

const AUTO_LABEL_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const PALETTE_COLORS = [
  '#ef4444', // red
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
];

export function TrainingStudio() {
  const [images, setImages] = useState<ImageStatus[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [hoveredBoxId, setHoveredBoxId] = useState<string | null>(null);
  
  const [classes, setClasses] = useState<string[]>(['object']);
  const [currentClass, setCurrentClass] = useState("object");
  const [newClassInput, setNewClassInput] = useState("");
  
  const [modelName, setModelName] = useState("my_custom_model");
  const [epochs, setEpochs] = useState(50);
  const [status, setStatus] = useState<any>({ status: 'idle' });
  const [isPreLabeling, setIsPreLabeling] = useState(false);
  const [isAutoLabeling, setIsAutoLabeling] = useState(false);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentMousePos, setCurrentMousePos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchImages();
    fetchClasses();
    pollStatus();
    const interval = setInterval(pollStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch annotations when selected image changes
  useEffect(() => {
    if (selectedImage) {
      axios.get(`http://localhost:8000/api/training/dataset/annotations/${selectedImage}`)
        .then(res => {
          setBoxes(res.data.boxes || []);
        })
        .catch(err => console.error("Failed to load annotations", err));
    } else {
      setBoxes([]);
    }
  }, [selectedImage]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (document.activeElement?.tagName === 'INPUT') return;

      if ((e.key === 'Backspace' || e.key === 'Delete') && hoveredBoxId) {
        setBoxes(prev => prev.filter(b => b.id !== hoveredBoxId));
        setHoveredBoxId(null);
      }
      
      // Numbers 1-9 to select class
      const num = parseInt(e.key);
      if (!isNaN(num) && num >= 1 && num <= 9) {
        if (num - 1 < classes.length) {
          setCurrentClass(classes[num - 1]);
        }
      }
      
      // Arrows to switch image
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        const idx = images.findIndex(img => img.filename === selectedImage);
        if (idx !== -1 && idx < images.length - 1) setSelectedImage(images[idx + 1].filename);
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        const idx = images.findIndex(img => img.filename === selectedImage);
        if (idx > 0) setSelectedImage(images[idx - 1].filename);
      }
      
      // Save
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveAnnotations();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hoveredBoxId, classes, images, selectedImage, boxes]);

  const fetchImages = async () => {
    try {
      const res = await axios.get('http://localhost:8000/api/training/dataset/images');
      setImages(res.data);
      if (res.data.length > 0 && !selectedImage) {
        setSelectedImage(res.data[0].filename);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchClasses = async () => {
    try {
      const res = await axios.get('http://localhost:8000/api/training/dataset/classes');
      const classNames = Object.keys(res.data);
      if (classNames.length > 0) {
        setClasses(classNames);
        if (!classNames.includes(currentClass)) setCurrentClass(classNames[0]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const pollStatus = async () => {
    try {
      const res = await axios.get('http://localhost:8000/api/training/status');
      setStatus(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    for (let i = 0; i < e.target.files.length; i++) {
      const file = e.target.files[i];
      const formData = new FormData();
      formData.append('file', file);
      await axios.post('http://localhost:8000/api/training/dataset/upload', formData);
    }
    fetchImages();
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (!containerRef.current || hoveredBoxId) return; // Don't draw if hovering over an existing box's controls
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setStartPos({ x, y });
    setCurrentMousePos({ x, y });
    setIsDrawing(true);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setCurrentMousePos({ x, y });
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    
    const x_min = Math.min(startPos.x, currentMousePos.x);
    const y_min = Math.min(startPos.y, currentMousePos.y);
    const x_max = Math.max(startPos.x, currentMousePos.x);
    const y_max = Math.max(startPos.y, currentMousePos.y);
    
    const width = x_max - x_min;
    const height = y_max - y_min;
    
    if (width > 0.01 && height > 0.01) {
      const newBox: Box = {
        id: Math.random().toString(),
        x_center: x_min + width / 2,
        y_center: y_min + height / 2,
        width,
        height,
        class_name: currentClass,
        source: 'human'
      };
      setBoxes([...boxes, newBox]);
    }
  };

  const saveAnnotations = async () => {
    if (!selectedImage) return;
    try {
      const res = await axios.post('http://localhost:8000/api/training/dataset/annotate', {
        image_filename: selectedImage,
        boxes: boxes
      });
      if (res.data.classes) {
        setClasses(Object.keys(res.data.classes));
      }
      
      // Update local status so UI shows checkmark
      setImages(prev => prev.map(img => 
        img.filename === selectedImage ? { ...img, annotated: true } : img
      ));
      
    } catch (e) {
      alert('Failed to save annotations.');
    }
  };

  const preLabelImage = async () => {
    if (!selectedImage || isPreLabeling) return;
    if (boxes.length > 0 && !window.confirm('Replace current boxes with model pre-labels?')) return;

    setIsPreLabeling(true);
    try {
      const res = await axios.post('http://localhost:8000/api/training/dataset/pre-annotate', {
        image_filename: selectedImage,
        confidence: 0.25
      });
      const predictedBoxes = (res.data.boxes || []) as Box[];
      setBoxes(predictedBoxes.map(box => ({ ...box, source: 'model' })));
      const predictedClasses = Array.from(new Set(predictedBoxes.map(box => box.class_name).filter(Boolean)));
      setClasses(prev => Array.from(new Set([...prev, ...predictedClasses])));
      if (predictedBoxes.length === 0) {
        alert('No model pre-labels found. Try drawing boxes manually or lowering the detector threshold later.');
      }
    } catch (e: any) {
      alert('Pre-labeling failed: ' + (e.response?.data?.detail || e.message));
    } finally {
      setIsPreLabeling(false);
    }
  };

  const autoAnnotate = async (boxId: string, showAlert = true) => {
    if (!selectedImage) return false;
    
    const box = boxes.find(b => b.id === boxId);
    if (!box) return false;

    setBoxes(prev => prev.map(b => b.id === boxId ? { ...b, isLoading: true } : b));

    try {
      const res = await axios.post('http://localhost:8000/api/training/dataset/auto-annotate', {
        image_filename: selectedImage,
        box: {
          x_center: box.x_center,
          y_center: box.y_center,
          width: box.width,
          height: box.height,
          class_name: box.class_name
        }
      });

      const newLabel = res.data.label;
      if (newLabel && !classes.includes(newLabel)) {
        setClasses(prev => [...prev, newLabel]);
      }

      setBoxes(prev => prev.map(b => 
        b.id === boxId ? { ...b, class_name: newLabel || b.class_name, isLoading: false, source: 'vlm' } : b
      ));
      return true;
    } catch (e: any) {
      if (showAlert) alert("Auto-annotate failed: " + (e.response?.data?.detail || e.message));
      setBoxes(prev => prev.map(b => b.id === boxId ? { ...b, isLoading: false } : b));
      return false;
    }
  };

  const autoAnnotateAll = async () => {
    if (!selectedImage || boxes.length === 0 || isAutoLabeling) return;
    setIsAutoLabeling(true);
    try {
      const pendingBoxes = boxes.filter(box => !box.isLoading);
      for (let i = 0; i < pendingBoxes.length; i++) {
        await autoAnnotate(pendingBoxes[i].id, false);
        if (i < pendingBoxes.length - 1) {
          await sleep(AUTO_LABEL_DELAY_MS);
        }
      }
    } finally {
      setIsAutoLabeling(false);
    }
  };

  const startTraining = async () => {
    if (status.status === 'running') return;
    try {
      const formData = new FormData();
      formData.append('model_name', modelName);
      formData.append('epochs', epochs.toString());
      await axios.post('http://localhost:8000/api/training/start', formData);
      pollStatus();
    } catch (e: any) {
      alert("Failed to start training: " + e.message);
    }
  };

  const addNewClass = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newClassInput.trim()) {
      const name = newClassInput.trim().toLowerCase();
      if (!classes.includes(name)) {
        setClasses([...classes, name]);
      }
      setCurrentClass(name);
      setNewClassInput("");
    }
  };

  const getClassColor = (className: string) => {
    const idx = classes.indexOf(className);
    if (idx === -1) return '#ffffff';
    return PALETTE_COLORS[idx % PALETTE_COLORS.length];
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] bg-slate-950 text-slate-200 overflow-hidden">
      {/* Left Sidebar - Images */}
      <div className="w-64 border-r border-slate-800 bg-slate-900 flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-800">
           <h2 className="font-semibold flex items-center gap-2 mb-4"><ImageIcon size={18} /> Dataset</h2>
           <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 w-full py-2 rounded-md flex justify-center items-center gap-2 text-sm transition-colors shadow-sm">
              <Upload size={16} /> Upload Images
              <input type="file" multiple accept="image/*" className="hidden" onChange={handleUpload} />
           </label>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
          {images.map(img => (
            <button
              key={img.filename}
              onClick={() => setSelectedImage(img.filename)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm rounded-md truncate transition-colors flex items-center gap-2",
                selectedImage === img.filename ? "bg-blue-500/20 text-blue-400" : "text-slate-400 hover:bg-slate-800"
              )}
            >
              {img.annotated ? <CheckCircle2 size={14} className="text-green-500 shrink-0" /> : <Circle size={14} className="text-slate-600 shrink-0" />}
              <span className="truncate">{img.filename}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Annotation Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="h-14 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900 shrink-0">
          <div className="flex items-center gap-4 flex-1 overflow-x-auto custom-scrollbar">
            <span className="text-xs font-semibold text-slate-500 uppercase shrink-0">Palette:</span>
            <div className="flex gap-2 items-center">
              {classes.map((cls, i) => (
                <button
                  key={cls}
                  onClick={() => setCurrentClass(cls)}
                  className={cn(
                    "px-3 py-1 text-xs rounded-full border flex items-center gap-2 transition-all shrink-0",
                    currentClass === cls ? "border-slate-400 bg-slate-800 shadow-sm" : "border-transparent bg-slate-950 hover:bg-slate-800 text-slate-400"
                  )}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getClassColor(cls) }} />
                  <span className="font-mono opacity-50 mr-1">{i + 1}</span> {cls}
                </button>
              ))}
              <input 
                value={newClassInput}
                onChange={e => setNewClassInput(e.target.value)}
                onKeyDown={addNewClass}
                placeholder="+ Add class (Enter)"
                className="bg-transparent border border-slate-700 rounded-full px-3 py-1 text-xs w-32 focus:outline-none focus:border-blue-500 shrink-0"
              />
            </div>
          </div>
          
          <div className="flex items-center gap-4 ml-4 border-l border-slate-800 pl-4">
             <button 
               onClick={preLabelImage}
               disabled={!selectedImage || isPreLabeling}
               className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800 disabled:text-slate-600 text-slate-100 px-4 py-1.5 rounded-md text-sm transition-colors shadow-sm whitespace-nowrap border border-slate-700"
               title="Use the current detector to pre-label boxes"
             >
               {isPreLabeling ? <Loader2 size={16} className="animate-spin" /> : <ScanSearch size={16} />} Pre-Label
             </button>
             <button 
               onClick={autoAnnotateAll}
               disabled={!selectedImage || boxes.length === 0 || isAutoLabeling}
               className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white px-4 py-1.5 rounded-md text-sm transition-colors shadow-sm whitespace-nowrap"
               title="Auto-label all boxes using OpenAI at a controlled request rate"
             >
               {isAutoLabeling ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Auto-Label All
             </button>
             <button 
               onClick={saveAnnotations}
               disabled={!selectedImage}
               className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 text-white px-4 py-1.5 rounded-md text-sm transition-colors shadow-sm whitespace-nowrap"
               title="Save (Cmd/Ctrl + S)"
             >
               <Save size={16} /> Save
             </button>
          </div>
        </div>

        {/* Canvas Area */}
        <div className="flex-1 p-6 flex items-center justify-center bg-slate-950 overflow-hidden relative">
          {!selectedImage ? (
             <p className="text-slate-500">Upload and select an image to start annotating</p>
          ) : (
            <div 
              ref={containerRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className="relative select-none cursor-crosshair border border-slate-800 max-h-full max-w-full inline-block group"
            >
              <img 
                src={`http://localhost:8000/datasets/images/train/${selectedImage}`} 
                alt="Annotation" 
                className="max-h-[80vh] w-auto pointer-events-none block"
                draggable={false}
              />
              
              {/* Precision Crosshairs (only visible when hovering container) */}
              <div 
                className="absolute bg-white/20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ top: `${currentMousePos.y * 100}%`, left: 0, right: 0, height: '1px' }} 
              />
              <div 
                className="absolute bg-white/20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `${currentMousePos.x * 100}%`, top: 0, bottom: 0, width: '1px' }} 
              />
              
              {/* Existing Boxes */}
              {boxes.map(b => {
                const color = getClassColor(b.class_name);
                const isHovered = hoveredBoxId === b.id;
                return (
                  <div
                    key={b.id}
                    onMouseEnter={() => setHoveredBoxId(b.id)}
                    onMouseLeave={() => setHoveredBoxId(null)}
                    className="absolute border-2 transition-all cursor-pointer"
                    style={{
                      left: `${(b.x_center - b.width/2) * 100}%`,
                      top: `${(b.y_center - b.height/2) * 100}%`,
                      width: `${b.width * 100}%`,
                      height: `${b.height * 100}%`,
                      borderColor: color,
                      backgroundColor: isHovered ? `${color}40` : `${color}20`,
                      zIndex: isHovered ? 10 : 1
                    }}
                  >
                    {b.isEditing ? (
                      <input
                        autoFocus
                        defaultValue={b.class_name}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const newName = e.currentTarget.value.trim().toLowerCase();
                            if (newName && !classes.includes(newName)) {
                              setClasses(prev => [...prev, newName]);
                            }
                            setBoxes(prev => prev.map(x => x.id === b.id ? { ...x, class_name: newName || x.class_name, isEditing: false } : x));
                          }
                          if (e.key === 'Escape') {
                            setBoxes(prev => prev.map(x => x.id === b.id ? { ...x, isEditing: false } : x));
                          }
                        }}
                        onBlur={(e) => {
                          const newName = e.currentTarget.value.trim().toLowerCase();
                          if (newName && !classes.includes(newName)) {
                            setClasses(prev => [...prev, newName]);
                          }
                          setBoxes(prev => prev.map(x => x.id === b.id ? { ...x, class_name: newName || x.class_name, isEditing: false } : x));
                        }}
                        className="absolute -top-6 left-0 text-[10px] px-1.5 py-0.5 shadow-sm rounded font-medium text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        style={{ width: '100px' }}
                      />
                    ) : (
                      <span 
                        className="absolute -top-5 left-0 text-white text-[10px] px-1.5 py-0.5 shadow-sm whitespace-nowrap rounded-t font-medium flex items-center gap-1"
                        style={{ backgroundColor: color }}
                        onDoubleClick={() => setBoxes(prev => prev.map(x => x.id === b.id ? { ...x, isEditing: true } : x))}
                      >
                        {b.isLoading && <Loader2 size={10} className="animate-spin" />}
                        {b.class_name}
                        {b.confidence !== undefined && <span className="opacity-70">{Math.round(b.confidence * 100)}%</span>}
                      </span>
                    )}
                    
                    {isHovered && !b.isLoading && !b.isEditing && (
                      <div className="absolute -top-6 -right-6 flex gap-1 z-20">
                        <button 
                          onClick={(e) => { e.stopPropagation(); setBoxes(prev => prev.map(x => x.id === b.id ? { ...x, isEditing: true } : x)); }}
                          className="p-1.5 bg-slate-700 text-white rounded-full hover:bg-slate-600 shadow shadow-black/50 transition-transform hover:scale-110"
                          title="Edit Label"
                        >
                          <Pencil size={12} />
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); autoAnnotate(b.id); }}
                          className="p-1.5 bg-indigo-500 text-white rounded-full hover:bg-indigo-400 shadow shadow-black/50 transition-transform hover:scale-110"
                          title="Auto-Label with OpenAI"
                        >
                          <Sparkles size={12} />
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); setBoxes(boxes.filter(x => x.id !== b.id)); }}
                          className="p-1.5 bg-red-500 text-white rounded-full hover:bg-red-400 shadow shadow-black/50 transition-transform hover:scale-110"
                          title="Delete (Backspace/Del)"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Box currently being drawn */}
              {isDrawing && (
                <div
                  className="absolute border-2 pointer-events-none"
                  style={{
                    left: `${Math.min(startPos.x, currentMousePos.x) * 100}%`,
                    top: `${Math.min(startPos.y, currentMousePos.y) * 100}%`,
                    width: `${Math.abs(startPos.x - currentMousePos.x) * 100}%`,
                    height: `${Math.abs(startPos.y - currentMousePos.y) * 100}%`,
                    borderColor: getClassColor(currentClass),
                    backgroundColor: `${getClassColor(currentClass)}30`
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Sidebar - Training Controls */}
      <div className="w-80 border-l border-slate-800 bg-slate-900 shrink-0 flex flex-col z-10 shadow-xl">
        <div className="p-4 border-b border-slate-800">
           <h2 className="font-semibold flex items-center gap-2"><Play size={18} className="text-blue-500" /> Model Training</h2>
        </div>
        
        <div className="p-4 space-y-6">
           <div>
             <label className="block text-xs font-medium text-slate-400 mb-1">Custom Model Name</label>
             <input 
               value={modelName}
               onChange={e => setModelName(e.target.value)}
               className="w-full bg-slate-950 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
             />
           </div>
           
           <div>
             <label className="block text-xs font-medium text-slate-400 mb-2 flex justify-between">
               <span>Training Epochs</span>
               <span>{epochs}</span>
             </label>
             <input 
               type="range" min="10" max="300" step="10"
               value={epochs}
               onChange={e => setEpochs(parseInt(e.target.value))}
               className="w-full accent-blue-500"
             />
             <p className="text-[10px] text-slate-500 mt-1 leading-tight">Higher epochs = better accuracy but takes longer.</p>
           </div>
           
           <button 
             onClick={startTraining}
             disabled={status.status === 'running'}
             className="w-full bg-slate-200 hover:bg-white disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold py-2 rounded-md transition-colors flex justify-center items-center gap-2 shadow"
           >
             {status.status === 'running' ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
             {status.status === 'running' ? 'Training...' : 'Start Training'}
           </button>
           
           {/* Status Readout */}
           <div className="bg-slate-950 rounded-lg p-3 border border-slate-800 mt-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase mb-2">Training Status</h3>
              <div className="flex items-center gap-2 mb-2">
                 {status.status === 'idle' && <span className="w-2 h-2 rounded-full bg-slate-500" />}
                 {status.status === 'running' && <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />}
                 {status.status === 'completed' && <span className="w-2 h-2 rounded-full bg-green-500" />}
                 {status.status === 'error' && <span className="w-2 h-2 rounded-full bg-red-500" />}
                 <span className="text-sm capitalize">{status.status}</span>
              </div>
              <p className="text-xs text-slate-400 whitespace-pre-wrap font-mono">{status.message || "No active jobs."}</p>
           </div>
        </div>
      </div>
    </div>
  );
}
