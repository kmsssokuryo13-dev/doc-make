import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toFullWidthDigits } from '../../utils.js';

const DIRECT_KEYS = /^[0-9.]$/;
const toFullWidth = (ch) => {
  if (ch === '.') return '\uFF0E';
  return toFullWidthDigits(ch);
};

export function FormField({ label, value, onChange, placeholder, type = "text", readOnly = false, autoConfirm = false }) {
  const converted = toFullWidthDigits(value || '');
  const [localVal, setLocalVal] = useState(converted);
  const composingRef = useRef(false);
  const focusedRef = useRef(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!focusedRef.current) {
      setLocalVal(converted);
    }
  }, [converted]);

  const handleKeyDown = useCallback((e) => {
    if (readOnly || !autoConfirm) return;
    if (DIRECT_KEYS.test(e.key)) {
      e.preventDefault();
      const el = inputRef.current;
      if (!el) return;
      const fw = toFullWidth(e.key);
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      const cur = el.value;
      const next = cur.slice(0, start) + fw + cur.slice(end);
      setLocalVal(next);
      onChange(next);
      requestAnimationFrame(() => {
        const pos = start + fw.length;
        el.setSelectionRange(pos, pos);
      });
    }
  }, [readOnly, autoConfirm, onChange]);

  const handleChange = useCallback((e) => {
    if (readOnly) return;
    const raw = e.target.value;
    if (composingRef.current) {
      setLocalVal(raw);
      return;
    }
    const val = toFullWidthDigits(raw);
    setLocalVal(val);
    onChange(val);
  }, [readOnly, onChange]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback((e) => {
    composingRef.current = false;
    if (!readOnly) {
      const val = toFullWidthDigits(e.target.value);
      setLocalVal(val);
      onChange(val);
    }
  }, [readOnly, onChange]);

  const handleFocus = useCallback(() => {
    focusedRef.current = true;
  }, []);

  const handleBlur = useCallback((e) => {
    focusedRef.current = false;
    if (!readOnly) {
      const val = toFullWidthDigits(e.target.value);
      setLocalVal(val);
      if (val !== converted) onChange(val);
    }
  }, [readOnly, onChange, converted]);

  return (
    <div className="flex-1 min-w-[120px]">
      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1 font-sans">{label}</label>
      <input
        ref={inputRef}
        type={type}
        className={`w-full px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm transition-all font-sans ${readOnly ? 'bg-gray-100 text-gray-400 cursor-not-allowed border-dashed' : 'bg-white hover:border-gray-400 text-black'}`}
        value={localVal}
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        readOnly={readOnly}
      />
    </div>
  );
}
