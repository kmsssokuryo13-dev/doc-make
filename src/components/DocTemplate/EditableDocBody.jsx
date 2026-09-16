import React, { useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { isBlankDocumentHtml } from '../../v8Compatibility.js';
import { DOC_CAPTURE_ATTR } from '../../signerStampAlignment.js';

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

  // 同一instanceで編集可→不可へ切り替えた時も、未保存の入力を失わない。
  useEffect(() => {
    if (!editable) {
      focusedRef.current = false;
      flush();
    }
  }, [editable, flush]);

  // Hooksは条件returnより前で常に同じ順序で呼ぶ（editableの切替に対応するため）。
  useLayoutEffect(() => {
    if (!editable) return;
    if (focusedRef.current && containerRef.current &&
        document.activeElement !== containerRef.current) {
      focusedRef.current = false;
    }
    if (!hasCustom && containerRef.current && captureRef.current && !focusedRef.current) {
      containerRef.current.innerHTML = captureRef.current.innerHTML;
    }
  });

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
    <>
      {/* 編集用の初期HTMLを取るためだけの非表示DOM。レイアウト計測の対象から除外する目印を付ける。 */}
      <div ref={captureRef} style={{ display: 'none' }} {...{ [DOC_CAPTURE_ATTR]: '1' }}>{children}</div>
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
