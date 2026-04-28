import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import apiCaller from '../services/apiCaller';
import GuidedLabPanel from '../components/GuidedLab/GuidedLabPanel';
import { FaArrowLeft, FaExpand, FaCompress, FaBookOpen, FaTimes, FaSpinner } from 'react-icons/fa';

/**
 * LabView — Full-screen lab page: Desktop (iframe) + Lab Guide overlay panel.
 * The iframe is always full-area so Kasm VNC renders at full resolution.
 * The guide panel overlays from the right as a solid panel with shadow.
 *
 * URL: /lab-view?url=<desktopUrl>&training=<trainingName>&instance=<instanceName>
 */
export default function LabView() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const iframeRef = useRef(null);

  const desktopUrl = searchParams.get('url') || '';
  const trainingName = searchParams.get('training') || '';
  const instanceName = searchParams.get('instance') || '';

  const [guidedLab, setGuidedLab] = useState(null);
  const [labLoading, setLabLoading] = useState(!!trainingName);
  const [userEmail, setUserEmail] = useState('');
  const [guideOpen, setGuideOpen] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(420);
  const [isDragging, setIsDragging] = useState(false);

  // Enhance Kasm URL with resize=remote for auto-resolution
  const enhancedUrl = useMemo(() => {
    if (!desktopUrl) return '';
    try {
      const url = new URL(desktopUrl);
      url.searchParams.set('resize', 'remote');
      return url.toString();
    } catch {
      return desktopUrl;
    }
  }, [desktopUrl]);

  useEffect(() => {
    try { setUserEmail(localStorage.getItem('email') || ''); } catch {}
  }, []);

  useEffect(() => {
    if (!trainingName) return;
    setLabLoading(true);
    apiCaller.get(`/guided-labs/by-training/${encodeURIComponent(trainingName)}`)
      .then(res => { if (res.data) setGuidedLab(res.data); })
      .catch(() => {})
      .finally(() => setLabLoading(false));
  }, [trainingName]);

  const vms = instanceName ? [{ name: instanceName, isRunning: true }] : [];

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setFullscreen(false);
    }
  };

  // Resize drag
  const onDragStart = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e) => setPanelWidth(Math.max(320, Math.min(700, window.innerWidth - e.clientX)));
    const onUp = () => setIsDragging(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [isDragging]);

  // Listen for clipboard events from guide panel → set clipboard inside container
  useEffect(() => {
    const handler = (e) => {
      const text = e.detail?.text;
      if (!text || !instanceName) return;
      // Call backend to set X11 clipboard inside the container via Docker exec
      apiCaller.post('/guided-labs/paste-to-lab', { instanceName, text }).catch(() => {});
    };
    window.addEventListener('lab-clipboard', handler);
    return () => window.removeEventListener('lab-clipboard', handler);
  }, [instanceName]);

  const showPanel = guideOpen && (guidedLab || labLoading);

  return (
    <div className="h-screen flex flex-col bg-slate-900 select-none overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800 border-b border-slate-700 flex-shrink-0 relative z-20">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-700 rounded-md transition-colors flex-shrink-0"
          >
            <FaArrowLeft className="w-3 h-3" /> Back to Console
          </button>
          <span className="text-xs text-slate-400 flex-shrink-0">|</span>
          <span className="text-xs text-slate-300 font-medium truncate">{trainingName}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {(guidedLab || labLoading) && (
            <button
              onClick={() => setGuideOpen(!guideOpen)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                guideOpen
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              <FaBookOpen className="w-3 h-3" />
              {guideOpen ? 'Hide Guide' : 'Show Guide'}
            </button>
          )}
          <button
            onClick={toggleFullscreen}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-md transition-colors"
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? <FaCompress className="w-3 h-3" /> : <FaExpand className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Main content: iframe + side panel (side-by-side) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop iframe — shrinks when guide panel is open */}
        <div className="flex-1 relative min-w-0">
          {enhancedUrl ? (
            <iframe
              ref={iframeRef}
              src={enhancedUrl}
              className="absolute inset-0 w-full h-full border-0"
              allow="clipboard-read; clipboard-write; fullscreen"
              title="Lab Desktop"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">
              No desktop URL provided
            </div>
          )}
        </div>

        {/* Guide panel — side-by-side with iframe, not overlaying */}
        {showPanel && (
          <div
            className="relative bg-white flex flex-col flex-shrink-0 border-l border-slate-300"
            style={{ width: panelWidth }}
          >
            {/* Drag handle on left edge */}
            <div
              className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize bg-slate-300 hover:bg-blue-400 active:bg-blue-500 transition-colors flex items-center justify-center"
              onMouseDown={onDragStart}
              style={{ zIndex: 15 }}
            >
              <div className="w-0.5 h-8 bg-slate-500 rounded-full" />
            </div>

            {/* Panel header */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex-shrink-0 ml-1.5">
              <span className="text-[11px] font-semibold text-slate-600">Lab Guide</span>
              <button
                onClick={() => setGuideOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded"
                title="Close guide"
              >
                <FaTimes className="w-2.5 h-2.5" />
              </button>
            </div>

            {/* Scrollable guide content */}
            <div className="flex-1 overflow-y-auto ml-1.5">
              {guidedLab ? (
                <GuidedLabPanel
                  lab={guidedLab}
                  trainingName={trainingName}
                  userEmail={userEmail}
                  vms={vms}
                  embedded
                />
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400">
                  <FaSpinner className="w-4 h-4 animate-spin mr-2" />
                  <span className="text-xs">Loading guide...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Full-screen overlay during drag to capture mouse events */}
        {isDragging && (
          <div className="fixed inset-0 z-30 cursor-col-resize" />
        )}
      </div>
    </div>
  );
}
