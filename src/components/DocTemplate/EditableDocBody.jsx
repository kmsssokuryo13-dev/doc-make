import React, { useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { isBlankDocumentHtml } from '../../v8Compatibility.js';

export const EditableDocBody = ({ editable, customHtml, onCustomHtmlChange, children }) => {
  const containerRef = useRef(null);
  const captureRef = useRef(null);
  const draftRef = useRef(null);
  const focusedRef = useRef(false);
  const hasCustom = !isBlankDocumentHtml(customHtml);

  const onChangeRef = useRef(onCustomHtmlChange);
  onChangeRef.current = onCustomHtmlChange;

  const flush = useCallback(() => {
    if (!onChangeRef.current || draftRef.current == null) return;
    onChangeRef.current(draftRef.current);
    draftRef.current = null;
  }, []);

  const handleInput = () => {
    if (!containerRef.current) return;
    const clone = containerRef.current.cloneNode(true);
    clone.querySelectorAll('[contenteditable="false"]').forEach(el => el.remove());
    draftRef.current = clone.innerHTML;
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      handleInput();
    }
  };

  const handleFocus = () => { focusedRef.current = true; };
  const handleBlur = () => { focusedRef.current = false; flush(); };

  useEffect(() => {
    return () => { if (focusedRef.current) flush(); };
  }, [flush]);

  if (!editable) {
    if (hasCustom) return <div className="doc-editable" style={{ pointerEvents: 'auto' }} dangerouslySetInnerHTML={{ __html: customHtml }} />;
    return <div className="doc-editable" style={{ pointerEvents: 'auto' }}>{children}</div>;
  }

  useLayoutEffect(() => {
    if (focusedRef.current && containerRef.current &&
        document.activeElement !== containerRef.current) {
      focusedRef.current = false;
    }
    if (editable && !hasCustom && containerRef.current && captureRef.current && !focusedRef.current) {
      containerRef.current.innerHTML = captureRef.current.innerHTML;
    }
  });

  if (hasCustom) {
    return (
      <div
        ref={containerRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className="doc-editable focus:outline-none min-h-[50mm]"
        style={{ pointerEvents: 'auto' }}
        dangerouslySetInnerHTML={{ __html: customHtml || "" }}
      />
    );
  }

  return (
    <>
      <div ref={captureRef} style={{ display: 'none' }}>{children}</div>
      <div
        ref={containerRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className="doc-editable focus:outline-none min-h-[50mm]"
        style={{ pointerEvents: 'auto' }}
      />
    </>
  );
};
