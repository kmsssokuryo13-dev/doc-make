import React from 'react';
import { toFullWidthDigits } from '../../utils.js';

export function FormField({ label, value, onChange, placeholder, type = "text", readOnly = false }) {
  return (
    <div className="flex-1 min-w-[120px]">
      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 font-sans">{label}</label>
      <input
        type={type}
        className={`w-full px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm transition-all font-sans ${readOnly ? 'bg-gray-100 text-gray-400 cursor-not-allowed border-dashed' : 'bg-white hover:border-gray-400 text-black'}`}
        value={toFullWidthDigits(value || '')}
        onChange={(e) => !readOnly && onChange(toFullWidthDigits(e.target.value))}
        placeholder={placeholder}
        readOnly={readOnly}
      />
    </div>
  );
}
