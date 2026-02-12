import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText, Map as MapIcon, Users, Plus, Trash2, Save, Building,
  Info, Upload, Download, Settings2
} from 'lucide-react';
import { createNewSite } from '../../utils.js';
import { sanitizeSiteData } from '../../sanitize.js';
import { extractTextFromPdf, parseRegistrationPdf } from '../../pdfExtract.js';
import { Modal } from '../ui/Modal.jsx';
import { TabBtn } from '../ui/TabBtn.jsx';
import { LandSection } from './LandSection.jsx';
import { BuildingSection } from './BuildingSection.jsx';
import { PeopleSection } from './PeopleSection.jsx';
import { MasterManagerModal } from './MasterManagerModal.jsx';
import { PdfAutoFillModal } from './PdfAutoFillModal.jsx';
import { PdfViewer } from '../PdfViewer.jsx';

export const Editor = ({ sites, setSites, activeSiteId, setActiveSiteId, contractors, setContractors, scriveners, setScriveners }) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('land_reg');
  const [pdfUrl, setPdfUrl] = useState(null);
  const [isMasterModalOpen, setIsMasterModalOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [isAutoFillModalOpen, setIsAutoFillModalOpen] = useState(false);
  const [extractedData, setExtractedData] = useState(null);

  const handlePdfExtract = useCallback(async (pdfDoc) => {
    if (!pdfDoc || !activeSiteId) return;
    setExtracting(true);
    try {
      const text = await extractTextFromPdf(pdfDoc);
      const data = parseRegistrationPdf(text);
      setExtractedData(data);
      setIsAutoFillModalOpen(true);
    } catch (err) {
      console.error('PDF extraction error:', err);
      alert('PDFの読み取りに失敗しました');
    } finally {
      setExtracting(false);
    }
  }, [activeSiteId]);

  const handleAutoFillApply = useCallback((data) => {
    if (!activeSiteId) return;
    setSites(prev => prev.map(s => {
      if (s.id !== activeSiteId) return s;
      const updated = { ...s };
      if (data.buildings && data.buildings.length > 0) {
        updated.proposedBuildings = [...(s.proposedBuildings || []), ...data.buildings];
      }
      if (data.land && data.land.length > 0) {
        updated.land = [...(s.land || []), ...data.land];
      }
      if (data.people && data.people.length > 0) {
        updated.people = [...(s.people || []), ...data.people];
      }
      return sanitizeSiteData(updated);
    }));
  }, [activeSiteId, setSites]);

  const handlePdfUpload = useCallback((e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPdfUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    e.target.value = "";
  }, []);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [siteToDelete, setSiteToDelete] = useState(null);

  const activeSite = sites.find(s => s.id === activeSiteId);

  const updateActiveSite = useCallback((fields) => {
    if (!activeSiteId) return;
    setSites(prev => prev.map(s => s.id === activeSiteId ? sanitizeSiteData({ ...s, ...fields }) : s));
  }, [activeSiteId, setSites]);

  const exportToJson = () => {
    const data = { schemaVersion: 5, exportedAt: new Date().toISOString(), app: "document-builder-building", activeSiteId, sites };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `survey_docs_${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
  };

  const importFromJson = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (!data || !Array.isArray(data.sites)) throw new Error("JSON形式不正");
        const sanitized = data.sites.map(sanitizeSiteData);
        setSites(sanitized); setActiveSiteId(sanitized.find(x => x.id === data.activeSiteId) ? data.activeSiteId : sanitized[0].id);
      } catch (err) { alert("読込失敗: " + err.message); }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex h-screen bg-gray-100 text-gray-900 overflow-hidden font-sans text-black">
      <aside className="w-64 bg-slate-800 text-white flex flex-col shrink-0 shadow-xl font-sans">
        <div className="p-4 bg-slate-900 border-b border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-blue-400 font-bold"><Building size={18} /><h1 className="text-sm truncate text-white">書類作成アプリ</h1></div>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <button onClick={exportToJson} className="flex items-center justify-center gap-1 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-[10px] font-bold border border-slate-600 transition-colors text-white"><Download size={12} /> JSON保存</button>
            <label className="flex items-center justify-center gap-1 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-[10px] font-bold border border-slate-600 cursor-pointer transition-colors text-white"><Upload size={12} /> JSON読込<input type="file" accept=".json" className="hidden" onChange={importFromJson} /></label>
          </div>
          <button onClick={() => setIsMasterModalOpen(true)} className="w-full mb-2 flex items-center justify-center gap-2 py-2 bg-slate-700 hover:bg-slate-600 rounded text-[10px] font-bold border border-slate-600 transition-all text-white"><Settings2 size={14} /> マスタ管理</button>
          <button onClick={() => { setNewSiteName(''); setIsAddModalOpen(true); }} className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-bold shadow-lg active:scale-95 transition-all text-white"><Plus size={18} /> 新規現場作成</button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {(sites || []).map(site => (
            <div key={site.id} onClick={() => setActiveSiteId(site.id)} className={`group px-4 py-4 cursor-pointer border-b border-slate-700/50 flex flex-col gap-1 transition-all relative ${activeSiteId === site.id ? 'bg-blue-600/20 border-l-4 border-l-blue-500' : 'hover:bg-slate-700/50 border-l-4 border-l-transparent'}`}>
              <div className="flex justify-between items-start text-sm truncate font-bold"><span className={activeSiteId === site.id ? 'text-white' : 'text-slate-300'}>{site.name}</span><button onClick={(e) => { e.stopPropagation(); setSiteToDelete(site); setIsDeleteModalOpen(true); }} className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-opacity"><Trash2 size={14} /></button></div>
              <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                <span>{site.land?.length||0}筆 / {site.proposedBuildings?.length||0}物件</span>
                <button onClick={(e) => { e.stopPropagation(); navigate(`/docs?siteId=${site.id}`); }} className="bg-slate-700 px-2 py-0.5 rounded text-slate-300 hover:text-white transition-colors">作成</button>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex-1 flex overflow-hidden text-black">
        <div className="w-1/2 flex flex-col bg-white border-r border-gray-200">
          {activeSite ? (
            <>
              <div className="bg-white border-b border-gray-200 shadow-sm z-10 px-4 py-1 flex items-center gap-1 overflow-x-auto no-scrollbar font-bold">
                <TabBtn active={activeTab === 'land_reg'} label="土地情報" onClick={() => setActiveTab('land_reg')} icon={<MapIcon size={14}/>} />
                <TabBtn active={activeTab === 'build_reg'} label="既登記建物" onClick={() => setActiveTab('build_reg')} icon={<Building size={14}/>} />
                <TabBtn active={activeTab === 'build_prop'} label="申請建物" onClick={() => setActiveTab('build_prop')} icon={<FileText size={14}/>} />
                <TabBtn active={activeTab === 'people'} label="関係人" onClick={() => setActiveTab('people')} icon={<Users size={14}/>} />
              </div>

              <div className="flex-1 overflow-y-auto p-4 bg-gray-50/30 custom-scrollbar">
                <div className="mb-6 p-4 bg-white border border-gray-200 rounded-xl shadow-sm space-y-4">
                  <h3 className="text-gray-700 text-sm font-bold flex items-center gap-2 border-b pb-2"><Info size={16} className="text-blue-500" /> 案件基本設定</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex-1 col-span-2">
                      <label className="block text-[10px] font-bold text-gray-500 mb-1">連携司法書士</label>
                      <select className="w-full text-sm p-2 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none text-black bg-white" value={activeSite.scrivenerId || ""} onChange={e => updateActiveSite({ scrivenerId: e.target.value })}>
                        <option value="">(未選択)</option>
                        {(scriveners || []).map(s => <option key={s.id} value={s.id}>{s.name || "(未入力)"}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {activeTab === 'land_reg' && <LandSection site={activeSite} update={updateActiveSite} />}
                {activeTab === 'build_reg' && <BuildingSection type="registered" site={activeSite} update={updateActiveSite} />}
                {activeTab === 'build_prop' && <BuildingSection type="proposed" site={activeSite} update={updateActiveSite} />}
                {activeTab === 'people' && <PeopleSection site={activeSite} update={updateActiveSite} contractors={contractors} openMasterModal={() => setIsMasterModalOpen(true)} />}
              </div>
            </>
          ) : <div className="flex-1 flex items-center justify-center text-gray-400 font-bold italic">案件を選択してください</div>}
        </div>
        <div className="w-1/2 bg-gray-200">
          <PdfViewer pdfUrl={pdfUrl} onFileChange={handlePdfUpload} onExtractText={handlePdfExtract} extracting={extracting} />
        </div>
      </div>

      <MasterManagerModal isOpen={isMasterModalOpen} onClose={() => setIsMasterModalOpen(false)} contractors={contractors} setContractors={setContractors} scriveners={scriveners} setScriveners={setScriveners} />
      <PdfAutoFillModal isOpen={isAutoFillModalOpen} onClose={() => setIsAutoFillModalOpen(false)} extractedData={extractedData} onApply={handleAutoFillApply} />

      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="新規現場の追加" footer={<><button onClick={() => setIsAddModalOpen(false)} className="px-4 py-2 text-sm font-medium text-black">キャンセル</button><button onClick={() => { if(!newSiteName.trim()) return; const s = createNewSite(newSiteName); setSites([...sites, s]); setActiveSiteId(s.id); setIsAddModalOpen(false); }} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold">追加</button></>}><input autoFocus type="text" className="w-full px-4 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-black font-bold" placeholder="案件名を入力" value={newSiteName} onChange={(e) => setNewSiteName(e.target.value)} onKeyDown={e => e.key === 'Enter' && newSiteName.trim() && (function(){ const s = createNewSite(newSiteName); setSites([...sites, s]); setActiveSiteId(s.id); setIsAddModalOpen(false); })()} /></Modal>
      <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} title="現場の削除確認" footer={<><button onClick={() => setIsDeleteModalOpen(false)} className="px-4 py-2 text-sm font-medium text-black">キャンセル</button><button onClick={() => { const ns = sites.filter(s => s.id !== siteToDelete.id); setSites(ns); if(activeSiteId === siteToDelete.id) setActiveSiteId(ns[0]?.id || null); setIsDeleteModalOpen(false); }} className="bg-red-500 text-white px-6 py-2 rounded-lg font-bold">削除</button></>}><p className="text-sm font-bold text-black">「{siteToDelete?.name}」を削除しますか？</p></Modal>
    </div>
  );
};
