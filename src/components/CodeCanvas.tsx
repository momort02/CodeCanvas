import React, { useState, useEffect, useRef, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import { 
  Play, Save, Download, Smartphone, Tablet, Monitor, 
  MonitorUp, FileCode2, Palette, Terminal, Trash2, 
  RotateCcw, CheckCircle2, ChevronRight, XCircle, Layout
} from 'lucide-react';

const DEFAULT_HTML = `
<div class="card">
  <h1>Welcome to CodeCanvas</h1>
  <p>Edit HTML, CSS, or JS and see changes instantly.</p>
  <div class="actions">
    <button id="btn-log">Log Message</button>
    <button id="btn-error" class="error-btn">Throw Error</button>
  </div>
</div>
`;

const DEFAULT_CSS = `
:root {
  --primary: #6366f1;
  --primary-hover: #4f46e5;
  --bg-color: #0f172a;
  --text-color: #ffffff;
  --card-bg: #1e293b;
  --danger: #ef4444;
}

body {
  background-color: var(--bg-color);
  color: var(--text-color);
  font-family: 'Inter', system-ui, sans-serif;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  margin: 0;
}

.card {
  background: var(--card-bg);
  padding: 2.5rem;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  text-align: center;
  max-width: 400px;
}

h1 { margin-top: 0; font-size: 1.5rem; }
p { color: #94a3b8; margin-bottom: 2rem; }

.actions { display: flex; gap: 1rem; justify-content: center; }

button {
  background-color: var(--primary);
  color: #ffffff;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.2s;
}

button:hover { background-color: var(--primary-hover); }

.error-btn { background-color: var(--danger); }
.error-btn:hover { background-color: #dc2626; }
`;

const DEFAULT_JS = `
const logBtn = document.getElementById('btn-log');
const errBtn = document.getElementById('btn-error');

logBtn.addEventListener('click', () => {
  console.log('Button clicked! The current time is:', new Date().toLocaleTimeString());
});

errBtn.addEventListener('click', () => {
  console.error('Oops! Something went wrong.');
  console.warn('This is a warning just in case.');
});
`;

type FileType = 'index.html' | 'style.css' | 'script.js';
type TabType = 'files' | 'colors';
type ResponsiveSize = 'mobile' | 'tablet' | 'laptop' | 'desktop' | 'full';

interface Dimensions { width: string; height: string; label: string; icon: React.FC<any> }
const SIZES: Record<ResponsiveSize, Dimensions> = {
  mobile: { width: '375px', height: '667px', label: 'Mobile', icon: Smartphone },
  tablet: { width: '768px', height: '1024px', label: 'Tablet', icon: Tablet },
  laptop: { width: '1366px', height: '768px', label: 'Laptop', icon: Monitor },
  desktop: { width: '1920px', height: '1080px', label: 'Desktop', icon: MonitorUp },
  full: { width: '100%', height: '100%', label: 'Full', icon: Layout }
};

interface LogEntry { id: string; type: 'log' | 'warn' | 'error'; message: string; timestamp: string; }
interface ParsedColor { original: string; hex: string; count: number; }

// Uses standard canvas to parse any valid CSS color into a HEX code for the color picker
const colorToHex = (colorStr: string): string => {
  if (typeof document === 'undefined') return '#000000';
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return '#000000';
  ctx.fillStyle = colorStr;
  return ctx.fillStyle; // Native browser conversion to #RRGGBB
};

const extractColors = (cssText: string): ParsedColor[] => {
  // Regex to match Hex, rgb(), rgba(), hsl(), hsla()
  const colorRegex = /(#([0-9a-fA-F]{3,8})\b|(rgb|rgba|hsl|hsla)\([^)]+\))/gi;
  const matches = cssText.match(colorRegex) || [];
  
  const colorMap = new Map<string, ParsedColor>();
  
  matches.forEach(match => {
    const key = match.toLowerCase();
    if (colorMap.has(key)) {
      const existing = colorMap.get(key)!;
      existing.count += 1;
    } else {
      colorMap.set(key, { original: match, hex: colorToHex(match), count: 1 });
    }
  });

  return Array.from(colorMap.values()).sort((a, b) => b.count - a.count);
};

export default function CodeCanvas() {
  // File State
  const [files, setFiles] = useState<Record<FileType, string>>({
    'index.html': DEFAULT_HTML,
    'style.css': DEFAULT_CSS,
    'script.js': DEFAULT_JS,
  });
  
  const [activeFile, setActiveFile] = useState<FileType>('index.html');
  const [sidebarTab, setSidebarTab] = useState<TabType>('files');
  const [activeSize, setActiveSize] = useState<ResponsiveSize>('full');
  
  // Execution & Logs
  const [iframeSrcDoc, setIframeSrcDoc] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  // UX State
  const [toast, setToast] = useState<string | null>(null);
  const [autoRun, setAutoRun] = useState(true);
  
  // Colors State
  const [detectedColors, setDetectedColors] = useState<ParsedColor[]>([]);

  // Load from local storage
  useEffect(() => {
    const saved = localStorage.getItem('codecanvas_files');
    if (saved) {
      try { setFiles(JSON.parse(saved)); } catch(e) { console.error("Failed to parse saved files"); }
    }
  }, []);

  // Show toast notification
  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  };

  // Run the code by compiling into a single HTML document
  const runCode = useCallback(() => {
    const consoleInterceptor = `
      <script>
        const originalConsole = { ...console };
        const sendLog = (type, args) => {
          parent.postMessage({ 
            source: 'codecanvas-sandbox', 
            type, 
            args: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)) 
          }, '*');
        };
        console.log = (...args) => { sendLog('log', args); originalConsole.log(...args); };
        console.warn = (...args) => { sendLog('warn', args); originalConsole.warn(...args); };
        console.error = (...args) => { sendLog('error', args); originalConsole.error(...args); };
        window.onerror = (msg, url, line) => { sendLog('error', [\`\${msg} (Line \${line})\`]); return false; };
      </script>
    `;

    const doc = `
      <!DOCTYPE html>
      <html>
        <head>
          \${consoleInterceptor}
          <style>\${files['style.css']}</style>
        </head>
        <body>
          \${files['index.html']}
          <script>\${files['script.js']}</script>
        </body>
      </html>
    \`;
    
    setIframeSrcDoc(doc);
  }, [files]);

  // Debounced auto-run
  useEffect(() => {
    if (!autoRun) return;
    const timer = setTimeout(() => { runCode(); }, 800);
    return () => clearTimeout(timer);
  }, [files, autoRun, runCode]);

  // Update parsed colors whenever CSS changes
  useEffect(() => {
    setDetectedColors(extractColors(files['style.css']));
  }, [files['style.css']]);

  // Handle global keyboard shortcuts (Ctrl + Enter)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runCode();
        showToast('Code Executed');
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [runCode]);

  // Listen to postMessage from the iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.source === 'codecanvas-sandbox') {
        setLogs(prev => [...prev, {
          id: Math.random().toString(36).substr(2, 9),
          type: e.data.type,
          message: e.data.args.join(' '),
          timestamp: new Date().toLocaleTimeString([], { hour12: false })
        }]);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleSave = () => {
    localStorage.setItem('codecanvas_files', JSON.stringify(files));
    showToast('Project Saved');
  };

  const handleReset = () => {
    if(window.confirm('Are you sure you want to reset all files to default?')) {
      setFiles({ 'index.html': DEFAULT_HTML, 'style.css': DEFAULT_CSS, 'script.js': DEFAULT_JS });
      setLogs([]);
      showToast('Project Reset');
    }
  };

  const handleExport = () => {
    const zipSimulation = \`/* Downloaded from CodeCanvas */\\n\\n=== index.html ===\\n\${files['index.html']}\\n\\n=== style.css ===\\n\${files['style.css']}\\n\\n=== script.js ===\\n\${files['script.js']}\`;
    const blob = new Blob([zipSimulation], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'codecanvas_export.txt';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Files Exported');
  };

  const replaceColor = (oldColorOriginal: string, newHex: string) => {
    setFiles(prev => {
      let currentCss = prev['style.css'];
      // Global string replacement for exact matches, case-insensitive logic
      // Note: we replace exactly what was matched in the original code
      const regex = new RegExp(oldColorOriginal.replace(/[.*+?^$\{}()|[\\]\\\\]/g, '\\\\$&'), 'gi');
      
      return {
        ...prev,
        'style.css': currentCss.replace(regex, newHex)
      };
    });
  };

  const getLanguageExtension = (file: FileType) => {
    if (file === 'index.html') return [html()];
    if (file === 'style.css') return [css()];
    return [javascript()];
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0b0d12] text-[#e6edf3] font-sans overflow-hidden">
      
      {/* TOAST NOTIFICATION */}
      {toast && (
        <div className="absolute top-16 right-4 z-50 bg-[#1e2330] border border-[#222836] text-[#6366f1] px-4 py-2 rounded shadow-lg flex items-center gap-2 animate-bounce">
          <CheckCircle2 size={16} />
          {toast}
        </div>
      )}

      {/* TOP TOOLBAR */}
      <header className="h-14 bg-[#13161f] border-b border-[#222836] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-[#6366f1] to-[#a855f7] flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Layout size={18} className="text-white" />
          </div>
          <h1 className="font-bold text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-gray-100 to-gray-400">CodeCanvas</h1>
        </div>
        
        <div className="flex items-center gap-2 bg-[#0b0d12] p-1 rounded-lg border border-[#222836]">
          {(Object.keys(SIZES) as ResponsiveSize[]).map((size) => {
            const SizeIcon = SIZES[size].icon;
            return (
              <button
                key={size}
                onClick={() => setActiveSize(size)}
                title={SIZES[size].label}
                className={\`p-2 rounded-md transition-colors \${activeSize === size ? 'bg-[#222836] text-[#6366f1]' : 'text-gray-500 hover:text-gray-300 hover:bg-[#1e2330]'}\`}
              >
                <SizeIcon size={16} />
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer mr-2">
            <input 
              type="checkbox" 
              checked={autoRun} 
              onChange={(e) => setAutoRun(e.target.checked)}
              className="accent-[#6366f1]"
            />
            Auto-Run
          </label>
          <button onClick={runCode} className="flex items-center gap-2 px-3 py-1.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-md text-sm font-medium transition-colors shadow-lg shadow-indigo-500/20">
            <Play size={14} fill="currentColor" /> Run (Ctrl+Enter)
          </button>
          <button onClick={handleSave} className="flex items-center gap-2 px-3 py-1.5 bg-[#1e2330] hover:bg-[#222836] border border-[#303645] text-gray-300 rounded-md text-sm font-medium transition-colors">
            <Save size={14} /> Save
          </button>
          <button onClick={handleExport} className="flex items-center gap-2 px-3 py-1.5 bg-[#1e2330] hover:bg-[#222836] border border-[#303645] text-gray-300 rounded-md text-sm font-medium transition-colors">
            <Download size={14} /> Export
          </button>
          <button onClick={handleReset} title="Reset Project" className="p-1.5 text-gray-500 hover:text-[#ef4444] transition-colors ml-2">
            <RotateCcw size={18} />
          </button>
        </div>
      </header>

      {/* MAIN WORKSPACE */}
      <main className="flex-1 flex overflow-hidden">
        
        {/* SIDEBAR */}
        <aside className="w-64 bg-[#0b0d12] border-r border-[#222836] flex flex-col shrink-0">
          <div className="flex border-b border-[#222836]">
            <button 
              className={\`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors \${sidebarTab === 'files' ? 'text-gray-100 border-b-2 border-[#6366f1]' : 'text-gray-500 hover:text-gray-300'}\`}
              onClick={() => setSidebarTab('files')}
            >
              <FileCode2 size={16} /> Files
            </button>
            <button 
              className={\`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors \${sidebarTab === 'colors' ? 'text-gray-100 border-b-2 border-[#6366f1]' : 'text-gray-500 hover:text-gray-300'}\`}
              onClick={() => setSidebarTab('colors')}
            >
              <Palette size={16} /> Colors
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
            {sidebarTab === 'files' ? (
              <div className="space-y-1">
                {(Object.keys(files) as FileType[]).map(file => (
                  <button
                    key={file}
                    onClick={() => setActiveFile(file)}
                    className={\`w-full text-left px-3 py-2 rounded-md flex items-center gap-2 text-sm transition-colors \${activeFile === file ? 'bg-[#1e2330] text-[#6366f1] font-medium' : 'text-gray-400 hover:bg-[#13161f] hover:text-gray-200'}\`}
                  >
                    <ChevronRight size={14} className={\`transition-transform \${activeFile === file ? 'rotate-90' : ''}\`} />
                    {file}
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {detectedColors.length === 0 ? (
                  <div className="text-center text-gray-500 mt-6 text-sm">
                    No colors detected in CSS.<br/>Write some CSS to see them here.
                  </div>
                ) : (
                  detectedColors.map((color, idx) => (
                    <div key={idx} className="bg-[#13161f] border border-[#222836] rounded-lg p-3 flex flex-col gap-2 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs text-gray-300 truncate max-w-[120px]" title={color.original}>
                          {color.original}
                        </span>
                        <span className="text-[10px] bg-[#222836] px-1.5 py-0.5 rounded text-gray-400 font-mono">
                          {color.count}x
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="relative w-8 h-8 rounded-md overflow-hidden border border-[#303645] shrink-0">
                          <input
                            type="color"
                            value={color.hex}
                            onChange={(e) => replaceColor(color.original, e.target.value)}
                            className="absolute -top-2 -left-2 w-16 h-16 cursor-pointer"
                            title="Click to change all occurrences"
                          />
                        </div>
                        <span className="text-xs text-gray-500 uppercase flex-1">{color.hex}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </aside>

        {/* EDITOR */}
        <section className="flex-1 flex flex-col min-w-0 bg-[#0b0d12]">
          <div className="h-10 bg-[#13161f] border-b border-[#222836] flex items-center px-4 shrink-0 gap-2">
             <span className="text-xs font-mono text-gray-400">Editing: </span>
             <span className="text-sm font-medium text-[#6366f1]">{activeFile}</span>
          </div>
          <div className="flex-1 overflow-hidden relative">
            <CodeMirror
              value={files[activeFile]}
              height="100%"
              theme={vscodeDark}
              extensions={getLanguageExtension(activeFile)}
              onChange={(value) => setFiles(prev => ({ ...prev, [activeFile]: value }))}
              className="absolute inset-0 text-sm font-mono"
            />
          </div>
        </section>

        {/* PREVIEW & CONSOLE */}
        <section className="w-[45%] min-w-[300px] border-l border-[#222836] flex flex-col bg-[#13161f]">
          
          {/* Responsive Preview Area */}
          <div className="flex-1 relative overflow-auto custom-scrollbar flex items-center justify-center p-4 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9IiMzMDM2NDUiLz48L3N2Zz4=')]">
            <div 
              className={\`transition-all duration-300 ease-in-out bg-white overflow-hidden shadow-2xl \${activeSize !== 'full' ? 'border border-[#303645] rounded-lg' : ''}\`}
              style={{
                width: SIZES[activeSize].width,
                height: SIZES[activeSize].height,
                maxWidth: activeSize === 'full' ? '100%' : undefined,
                maxHeight: activeSize === 'full' ? '100%' : undefined,
              }}
            >
              <iframe
                title="preview"
                srcDoc={iframeSrcDoc}
                sandbox="allow-scripts allow-same-origin"
                className="w-full h-full border-none bg-white"
              />
            </div>
          </div>

          {/* Console */}
          <div className="h-64 border-t border-[#222836] bg-[#0b0d12] flex flex-col shrink-0 shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.5)]">
            <div className="h-9 bg-[#1e2330] border-b border-[#222836] flex items-center justify-between px-3 shrink-0">
              <div className="flex items-center gap-2 text-gray-300 text-sm font-medium">
                <Terminal size={14} /> Console
              </div>
              <button 
                onClick={() => setLogs([])}
                className="text-gray-500 hover:text-gray-300 transition-colors"
                title="Clear Console"
              >
                <Trash2 size={14} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 font-mono text-xs space-y-1 custom-scrollbar">
              {logs.length === 0 ? (
                <div className="text-gray-600 italic px-2 py-1">No output yet...</div>
              ) : (
                logs.map((log) => (
                  <div 
                    key={log.id} 
                    className={\`px-2 py-1.5 rounded flex items-start gap-3 border-l-2 \${
                      log.type === 'error' ? 'bg-[#ef4444]/10 border-[#ef4444] text-[#ef4444]' :
                      log.type === 'warn' ? 'bg-[#f59e0b]/10 border-[#f59e0b] text-[#f59e0b]' :
                      'border-gray-500 text-gray-300 hover:bg-[#13161f]'
                    }\`}
                  >
                    <span className="text-gray-500 shrink-0 select-none">[{log.timestamp}]</span>
                    <span className="whitespace-pre-wrap break-all">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>

        </section>
      </main>

      {}
      {/* GLOBAL STYLES FOR CUSTOM SCROLLBARS */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2); 
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #303645; 
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #4f46e5; 
        }
        /* Override CodeMirror defaults to fit the dark theme seamlessly */
        .cm-editor {
          background-color: transparent !important;
        }
        .cm-scroller {
          background-color: #0b0d12 !important;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        }
      `}</style>
    </div>
  );
}