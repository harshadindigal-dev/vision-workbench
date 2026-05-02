import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import axios from 'axios';
import { Clapperboard, Loader2, Trash2, Sparkles, Info } from 'lucide-react';
import { cn } from '../utils';

const API = 'http://localhost:8000';

export function BrowserSessionLearning() {
  const [file, setFile] = useState<File | null>(null);
  const [intervalSec, setIntervalSec] = useState('0.45');
  const [useVlm, setUseVlm] = useState(false);
  const [maxHints, setMaxHints] = useState('6');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => !!file && !busy, [file, busy]);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFile(f ?? null);
    setResult(null);
    setError(null);
  };

  const analyze = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('sample_interval_seconds', intervalSec);
    fd.append('use_vlm', useVlm ? 'true' : 'false');
    fd.append('max_vlm_hints', maxHints);

    try {
      const res = await axios.post(`${API}/api/browser-session/analyze`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: useVlm ? 600_000 : 120_000,
      });
      setResult(res.data);
    } catch (err: any) {
      const msg =
        err?.response?.data?.detail ??
        err?.response?.data?.message ??
        err?.message ??
        'Request failed';
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setBusy(false);
    }
  };

  const dropSession = async () => {
    const sid = result?.session_id;
    if (!sid) return;
    try {
      await axios.delete(`${API}/api/browser-session/session/${sid}`);
      setResult({ ...result, session_deleted: true });
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200 overflow-hidden">
      <header className="border-b border-slate-800 px-6 py-4 shrink-0 bg-slate-900/80 flex flex-wrap gap-4 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-500/15 border border-violet-500/30">
            <Clapperboard className="text-violet-300" size={22} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Session learning</h1>
            <p className="text-xs text-slate-500 max-w-xl">
              Upload a browser screen recording. We sample frames, run detection, rank visual transitions, and optionally ask a VLM what control likely changed—first step toward learning clicks from demos.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="w-[340px] shrink-0 border-r border-slate-800 p-4 flex flex-col gap-4 bg-slate-900/40 overflow-y-auto">
          <label className="flex flex-col gap-2 text-sm">
            <span className="text-slate-400 font-medium">Recording</span>
            <input
              type="file"
              accept="video/mp4,video/webm,video/quicktime,.mkv,.avi"
              onChange={onFile}
              className="text-xs text-slate-400 file:mr-2 file:rounded file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-slate-200"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Sample interval (seconds)</span>
            <input
              value={intervalSec}
              onChange={(e) => setIntervalSec(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm"
            />
          </label>

          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={useVlm} onChange={(e) => setUseVlm(e.target.checked)} className="accent-violet-500" />
            <span className="flex items-center gap-1">
              <Sparkles size={14} className="text-violet-400" />
              Explain transitions with VLM (uses OPENAI_KEY)
            </span>
          </label>

          {useVlm && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Max transitions to explain</span>
              <input
                value={maxHints}
                onChange={(e) => setMaxHints(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm"
              />
            </label>
          )}

          <button
            type="button"
            disabled={!canSubmit}
            onClick={analyze}
            className={cn(
              'mt-2 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors',
              canSubmit ? 'bg-violet-600 hover:bg-violet-500 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed',
            )}
          >
            {busy ? <Loader2 className="animate-spin" size={18} /> : <Clapperboard size={18} />}
            {busy ? 'Analyzing…' : 'Analyze recording'}
          </button>

          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-500 flex gap-2 leading-relaxed">
            <Info size={16} className="shrink-0 mt-0.5 text-slate-600" />
            <span>
              Detection uses generic YOLO weights (not UI-specialized yet). Diff scores highlight visual change—not guaranteed clicks. Combine with DOM logging later for ground truth.
            </span>
          </div>

          {result?.session_id && (
            <button
              type="button"
              onClick={dropSession}
              className="flex items-center gap-2 text-xs text-rose-400 hover:text-rose-300"
            >
              <Trash2 size={14} /> Delete cached frames ({result.session_id.slice(0, 8)}…)
            </button>
          )}
        </aside>

        <main className="flex-1 min-w-0 flex flex-col bg-slate-950">
          {error && (
            <div className="m-4 rounded-lg border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">{error}</div>
          )}
          {!result && !error && !busy && (
            <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">Upload a screen recording to begin.</div>
          )}
          {busy && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500">
              <Loader2 className="animate-spin text-violet-500" size={32} />
              <span className="text-sm">{useVlm ? 'Sampling frames + calling VLM…' : 'Sampling frames + running detector…'}</span>
            </div>
          )}
          {result?.status === 'success' && (
            <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
              <div className="flex flex-wrap gap-3 text-xs text-slate-400 shrink-0">
                <span>
                  Duration <b className="text-slate-200">{result.duration_seconds}s</b>
                </span>
                <span>
                  FPS <b className="text-slate-200">{result.fps}</b>
                </span>
                <span>
                  Samples <b className="text-slate-200">{result.samples}</b>
                </span>
                <span>
                  Detector <b className="text-slate-200">{result.detector_model}</b>
                </span>
              </div>
              {result.notes && <p className="text-xs text-slate-500 shrink-0">{result.notes}</p>}

              {Array.isArray(result.learned_events) && result.learned_events.length > 0 && (
                <div className="shrink-0 rounded-lg border border-violet-900/40 bg-violet-950/20 p-3">
                  <h2 className="text-xs font-semibold text-violet-300 uppercase tracking-wide mb-2">Learned transition hypotheses</h2>
                  <ul className="space-y-2 max-h-[220px] overflow-y-auto">
                    {result.learned_events.map((ev: any, idx: number) => (
                      <li key={idx} className="text-xs border border-slate-800 rounded-md p-2 bg-slate-900/60">
                        <div className="text-slate-500 mb-1">
                          t {ev.t_before}s → {ev.t_after}s · diff {ev.frame_diff_score}{' '}
                          <span className={ev.vlm_status === 'ok' ? 'text-emerald-500' : 'text-rose-400'}>({ev.vlm_status})</span>
                        </div>
                        <div className="text-slate-200">{ev.vlm?.likely_clicked_description ?? JSON.stringify(ev.vlm)}</div>
                        {ev.vlm?.change_summary && <div className="text-slate-500 mt-1">{ev.vlm.change_summary}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex-1 min-h-0 rounded-lg border border-slate-800 bg-slate-900/40 overflow-hidden flex flex-col">
                <div className="px-3 py-2 border-b border-slate-800 text-xs font-medium text-slate-400 shrink-0">Raw JSON</div>
                <pre className="flex-1 overflow-auto p-3 text-[11px] leading-relaxed text-slate-300 font-mono">{JSON.stringify(result, null, 2)}</pre>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
