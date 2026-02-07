import React from 'react';

export const StepBadge = ({ num, label, active, completed }) => {
  const base = "flex items-center gap-2 px-3 py-2 rounded-xl border text-[11px] font-bold transition-all";
  const cls = active
    ? "bg-blue-600 text-white border-blue-600 shadow"
    : completed
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-white text-slate-500 border-slate-200";

  return (
    <div className={`${base} ${cls}`}>
      <span
        className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
          active ? "bg-white/20" : completed ? "bg-emerald-100" : "bg-slate-100"
        }`}
      >
        {completed ? "✓" : num}
      </span>
      <span className="leading-none">{label}</span>
    </div>
  );
};
