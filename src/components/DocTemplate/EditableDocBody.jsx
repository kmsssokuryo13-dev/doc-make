import React, { useState, useEffect, useCallback, useRef } from 'react';

export const EditableDocBody = ({ editable, customHtml, onCustomHtmlChange, children }) => {
  const containerRef = useRef(null);
  const draftRef = useRef(null);
  const focusedRef = useRef(false);
  const isBlankHtml = (html) => {
    if (html === null || html === undefined) return true;
    const s = String(html)
      .replace(/<br\s*\/?>/gi, "")
      .replace(/&nbsp;/gi, "")
      .replace(/<[^>]*>/g, "")
      .replace(/[\s\u3000\u00A0\u2000-\u200B\u202F\u205F\uFEFF]/g, "");
    return s.length === 0;
  };

  const hasCustom = !isBlankHtml(customHtml);

  const flush = useCallback(() => {
    if (!onCustomHtmlChange || draftRef.current == null) return;
    onCustomHtmlChange(draftRef.current);
    draftRef.current = null;
  }, [onCustomHtmlChange]);

  const handleInput = () => {
    if (!containerRef.current) return;
    draftRef.current = containerRef.current.innerHTML;
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
    >
      {children}
    </div>
  );
};
