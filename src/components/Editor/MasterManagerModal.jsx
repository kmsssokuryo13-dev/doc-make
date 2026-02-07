import React, { useState } from 'react';
import { Plus, Trash2, Briefcase, BookOpen } from 'lucide-react';
import { generateId } from '../../utils.js';
import { Modal } from '../ui/Modal.jsx';
import { FormField } from '../ui/FormField.jsx';

export const MasterManagerModal = ({ isOpen, onClose, contractors, setContractors, scriveners, setScriveners }) => {
  const [activeMasterTab, setActiveMasterTab] = useState('contractor');

  const addContractor = () => setContractors([...contractors, { id: generateId(), address: '', tradeName: '', representative: '' }]);
  const updateContractor = (id, field, val) => setContractors(prev => prev.map(c => c.id === id ? { ...c, [field]: val } : c));
  const deleteContractor = (id) => setContractors(prev => prev.filter(c => c.id !== id));

  const addScrivener = () => setScriveners([...scriveners, { id: generateId(), address: '', name: '' }]);
  const updateScrivener = (id, field, val) => setScriveners(prev => prev.map(s => s.id === id ? { ...s, [field]: val } : s));
  const deleteScrivener = (id) => setScriveners(prev => prev.filter(s => s.id !== id));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="マスタ管理設定" maxWidth="max-w-4xl" footer={<button onClick={onClose} className="px-6 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold">閉じる</button>}>
      <div className="flex flex-col gap-4 text-black">
        <div className="flex border-b border-gray-200">
          <button onClick={() => setActiveMasterTab('contractor')} className={`px-6 py-3 text-sm font-bold border-b-2 transition-all ${activeMasterTab === 'contractor' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            <div className="flex items-center gap-2"><Briefcase size={16} /> 工事人マスタ</div>
          </button>
          <button onClick={() => setActiveMasterTab('scrivener')} className={`px-6 py-3 text-sm font-bold border-b-2 transition-all ${activeMasterTab === 'scrivener' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            <div className="flex items-center gap-2"><BookOpen size={16} /> 司法書士マスタ</div>
          </button>
        </div>

        <div className="min-h-[400px]">
          {activeMasterTab === 'contractor' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-xs text-gray-500 font-bold">工事完了引渡証明書等に使用する工事会社を登録します。</p>
                <button onClick={addContractor} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-blue-700 shadow-sm transition-all"><Plus size={14} /> 新規登録</button>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {contractors.map(c => (
                  <div key={c.id} className="p-4 border border-gray-200 rounded-xl bg-white shadow-sm flex items-start gap-4 hover:border-blue-200 transition-colors">
                    <div className="flex-1 grid grid-cols-1 gap-3">
                      <FormField label="住所" value={c.address} onChange={v => updateContractor(c.id, 'address', v)} />
                      <div className="flex gap-3">
                        <FormField label="商号又は名称" value={c.tradeName} onChange={v => updateContractor(c.id, 'tradeName', v)} />
                        <FormField label="代表者" value={c.representative} onChange={v => updateContractor(c.id, 'representative', v)} />
                      </div>
                    </div>
                    <button onClick={() => deleteContractor(c.id)} className="text-gray-300 hover:text-red-500 p-2"><Trash2 size={18} /></button>
                  </div>
                ))}
                {contractors.length === 0 && <div className="text-center py-12 text-gray-400 italic">工事会社が登録されていません</div>}
              </div>
            </div>
          )}

          {activeMasterTab === 'scrivener' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-xs text-gray-500 font-bold">保存登記等の書類作成先・連携先を登録します。</p>
                <button onClick={addScrivener} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 hover:bg-blue-700 shadow-sm transition-all"><Plus size={14} /> 新規登録</button>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {scriveners.map(s => (
                  <div key={s.id} className="p-4 border border-gray-200 rounded-xl bg-white shadow-sm flex items-start gap-4 hover:border-blue-200 transition-colors">
                    <div className="flex-1 grid grid-cols-1 gap-3">
                      <FormField label="住所" value={s.address} onChange={v => updateScrivener(s.id, 'address', v)} />
                      <FormField label="氏名" value={s.name} onChange={v => updateScrivener(s.id, 'name', v)} />
                    </div>
                    <button onClick={() => deleteScrivener(s.id)} className="text-gray-300 hover:text-red-500 p-2"><Trash2 size={18} /></button>
                  </div>
                ))}
                {scriveners.length === 0 && <div className="text-center py-12 text-gray-400 italic">司法書士が登録されていません</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
