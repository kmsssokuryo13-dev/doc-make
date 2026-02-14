import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toFullWidthDigits } from '../../utils.js';

const DIRECT_KEYS = /^[0-9.]$/;
const toFullWidth = (ch) => {
  if (ch === '.') return '\uFF0E';
  return toFullWidthDigits(ch);
};

export function DateInput({ value, onChange, className, placeholder }) {
  const displayed = toFullWidthDigits(value || '');
  const [localVal, setLocalVal] = useState(displayed);
  const composingRef = useRef(false);
  const focusedRef = useRef(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!focusedRef.current) {
      setLocalVal(displayed);
    }
  }, [displayed]);

  const handleKeyDown = useCallback((e) => {
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
  }, [onChange]);

  const handleChange = useCallback((e) => {
    const raw = e.target.value;
    if (composingRef.current) {
      setLocalVal(raw);
      return;
    }
    const val = toFullWidthDigits(raw);
    setLocalVal(val);
    onChange(val);
  }, [onChange]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback((e) => {
    composingRef.current = false;
    const val = toFullWidthDigits(e.target.value);
    setLocalVal(val);
    onChange(val);
  }, [onChange]);

  const handleFocus = useCallback(() => {
    focusedRef.current = true;
  }, []);

  const handleBlur = useCallback((e) => {
    focusedRef.current = false;
    const val = toFullWidthDigits(e.target.value);
    setLocalVal(val);
    if (val !== displayed) onChange(val);
  }, [onChange, displayed]);

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      style={{ imeMode: 'disabled' }}
      className={className}
      value={localVal}
      onKeyDown={handleKeyDown}
      onChange={handleChange}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
    />
  );
}
