import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toFullWidthDigits } from '../../utils.js';

export function DateInput({ value, onChange, className, placeholder, convert = true }) {
  const displayed = convert ? toFullWidthDigits(value || '') : (value || '');
  const [localVal, setLocalVal] = useState(displayed);
  const composingRef = useRef(false);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setLocalVal(displayed);
    }
  }, [displayed]);

  const handleChange = useCallback((e) => {
    const raw = e.target.value;
    if (composingRef.current) {
      setLocalVal(raw);
      return;
    }
    const val = convert ? toFullWidthDigits(raw) : raw;
    setLocalVal(val);
    onChange(val);
  }, [convert, onChange]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback((e) => {
    composingRef.current = false;
    const val = convert ? toFullWidthDigits(e.target.value) : e.target.value;
    setLocalVal(val);
    onChange(val);
  }, [convert, onChange]);

  const handleFocus = useCallback(() => {
    focusedRef.current = true;
  }, []);

  const handleBlur = useCallback((e) => {
    focusedRef.current = false;
    const val = convert ? toFullWidthDigits(e.target.value) : e.target.value;
    setLocalVal(val);
    if (val !== displayed) onChange(val);
  }, [convert, onChange, displayed]);

  return (
    <input
      type="text"
      className={className}
      value={localVal}
      onChange={handleChange}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
    />
  );
}
