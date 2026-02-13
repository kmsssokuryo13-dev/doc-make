import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCcw, Maximize, Upload, FileSearch, ScanText, X } from 'lucide-react';
import { PDFJS_CDN, PDFJS_WORKER_CDN } from '../constants.js';

export const PdfViewer = ({ pdfUrl, pdfFiles = [], activePdfIdx = -1, onSelectPdf, onRemovePdf, onFileChange, onExtractText, extracting }) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const [baseFitScale, setBaseFitScale] = useState(1.0);
  const [loading, setLoading] = useState(false);
  const [pdfjsReady, setPdfjsReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  useEffect(() => {
    const loadPdfJs = () => {
      if (typeof window !== 'undefined' && window.pdfjsLib) { setPdfjsReady(true); return; }
      const script = document.createElement('script');
      script.id = 'pdfjs-script'; script.src = PDFJS_CDN;
      script.onload = () => { if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN; setPdfjsReady(true); } };
      document.head.appendChild(script);
    };
    loadPdfJs();
  }, []);

  const calculateBaseScale = useCallback(async () => {
    if (!pdfDoc || !containerRef.current) return;
    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.0, rotation: page.rotate });
      const containerWidth = containerRef.current.clientWidth - 32;
      setBaseFitScale(containerWidth / viewport.width);
    } catch (err) { console.error(err); }
  }, [pdfDoc, pageNum]);

  useEffect(() => {
    if (!containerRef.current || !pdfUrl || !pdfDoc) return;
    const resizeObserver = new ResizeObserver(() => calculateBaseScale());
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [calculateBaseScale, pdfUrl, pdfDoc]);

  useEffect(() => {
    if (!pdfUrl || !pdfjsReady) { setPdfDoc(null); setNumPages(0); setPageNum(1); return; }
    const loadDoc = async () => {
      setLoading(true);
      try {
        const pdf = await window.pdfjsLib.getDocument(pdfUrl).promise;
        setPdfDoc(pdf); setNumPages(pdf.numPages); setPageNum(1); setZoom(1.0);
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    loadDoc();
  }, [pdfUrl, pdfjsReady]);

  const handleZoomChange = (newZoom) => {
    if (!containerRef.current || !pdfUrl) return;
    setZoom(newZoom);
  };

  const renderPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current || baseFitScale === 0 || !pdfUrl) return;
    try {
      setLoading(true);
      const page = await pdfDoc.getPage(pageNum);
      const finalScale = baseFitScale * zoom;
      const viewport = page.getViewport({ scale: finalScale, rotation: page.rotate });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      canvas.height = viewport.height; canvas.width = viewport.width;
      await page.render({ canvasContext: context, viewport: viewport }).promise;
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, [pdfDoc, pageNum, zoom, baseFitScale, pdfUrl]);

  useEffect(() => { renderPage(); }, [renderPage]);

  return (
    <div className="flex flex-col h-full bg-slate-100 overflow-hidden text-black font-sans">
      {pdfFiles.length > 0 && (
        <div className="bg-slate-700 flex items-center gap-0 overflow-x-auto no-scrollbar border-b border-slate-600 shrink-0">
          {pdfFiles.map((f, i) => (
            <div key={i} onClick={() => onSelectPdf && onSelectPdf(i)} className={`flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold cursor-pointer border-r border-slate-600 shrink-0 max-w-[180px] ${i === activePdfIdx ? 'bg-slate-800 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200'}`}>
              <span className="truncate">{f.name}</span>
              <button onClick={(e) => { e.stopPropagation(); onRemovePdf && onRemovePdf(i); }} className="ml-1 p-0.5 rounded hover:bg-slate-500 shrink-0"><X size={10} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="bg-slate-800 text-white p-2 flex items-center justify-between shadow-lg z-20">
        <div className="flex items-center gap-1">
          <button disabled={!pdfUrl || pageNum <= 1} onClick={() => setPageNum(p => Math.max(1, p - 1))} className="p-1.5 hover:bg-slate-700 rounded disabled:opacity-20 text-white"><ChevronLeft size={18} /></button>
          <span className="text-[11px] font-bold w-12 text-center select-none">{pdfUrl ? `${pageNum} / ${numPages}` : "0 / 0"}</span>
          <button disabled={!pdfUrl || pageNum >= numPages} onClick={() => setPageNum(p => Math.min(numPages, p + 1))} className="p-1.5 hover:bg-slate-700 rounded disabled:opacity-20 text-white"><ChevronRight size={18} /></button>
        </div>
        <div className="flex items-center gap-1 border-x border-slate-600 px-2 mx-2">
          <button disabled={!pdfUrl} onClick={() => handleZoomChange(Math.max(0.5, zoom - 0.1))} className="p-1.5 hover:bg-slate-700 rounded disabled:opacity-20 text-white"><ZoomOut size={18} /></button>
          <span className="text-[10px] font-mono w-12 text-center select-none text-white">{pdfUrl ? Math.round(zoom * 100) : 0}%</span>
          <button disabled={!pdfUrl} onClick={() => handleZoomChange(Math.min(3.0, zoom + 0.1))} className="p-1.5 hover:bg-slate-700 rounded disabled:opacity-20 text-white"><ZoomIn size={18} /></button>
          <button disabled={!pdfUrl} onClick={() => handleZoomChange(1.0)} className="p-1.5 hover:bg-slate-700 rounded ml-1 disabled:opacity-20 text-white"><Maximize size={16} /></button>
          <button disabled={!pdfUrl} onClick={() => handleZoomChange(1.0 / baseFitScale)} className="p-1.5 hover:bg-slate-700 rounded disabled:opacity-20 text-white"><RotateCcw size={16} /></button>
        </div>
        <div className="flex items-center gap-2">
          <button disabled={!pdfDoc || extracting} onClick={() => onExtractText && onExtractText(pdfDoc)} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-3 py-1.5 rounded text-xs font-bold cursor-pointer active:scale-95 transition-all"><ScanText size={14} /> <span>{extracting ? '読取中...' : 'PDFから読取'}</span></button>
          <label className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-xs font-bold cursor-pointer active:scale-95 transition-all"><Upload size={14} /> <span>PDF読込</span><input type="file" accept="application/pdf" className="hidden" onChange={onFileChange} /></label>
        </div>
      </div>
      <div ref={containerRef} className={`flex-1 overflow-auto bg-slate-200 shadow-inner relative select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onMouseDown={(e) => { if (!pdfUrl || zoom <= 1.0) return; setDragging(true); dragStart.current = { x: e.clientX, y: e.clientY, scrollLeft: containerRef.current.scrollLeft, scrollTop: containerRef.current.scrollTop }; }}
        onMouseMove={(e) => { if (!dragging) return; e.preventDefault(); const dx = e.clientX - dragStart.current.x; const dy = e.clientY - dragStart.current.y; containerRef.current.scrollLeft = dragStart.current.scrollLeft - dx; containerRef.current.scrollTop = dragStart.current.scrollTop - dy; }}
        onMouseUp={() => setDragging(false)}
        onMouseLeave={() => setDragging(false)}
      >
        {pdfUrl ? (
          <div className="flex min-w-full min-h-full p-4"><div className="m-auto relative shadow-2xl bg-white"><canvas ref={canvasRef} className="block transition-opacity duration-200" style={{ opacity: loading ? 0.6 : 1 }} /></div></div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 p-4 text-center">
            <div className="p-12 border-4 border-dashed border-gray-300 rounded-[2rem] flex flex-col items-center bg-white shadow-inner max-w-sm w-full">
              <FileSearch size={64} className="mb-4 opacity-10" />
              <p className="text-sm font-bold text-gray-500 tracking-tight">PDF プレビュー</p>
              <p className="text-[10px] mt-2 text-gray-400">「PDF読込」から登記情報等を選択してください</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
