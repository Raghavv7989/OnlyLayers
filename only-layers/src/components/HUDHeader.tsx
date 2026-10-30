import React, { useState } from 'react';
import { ShieldCheck, ShieldAlert, Eye, EyeOff, MousePointer, Power, Settings, ChevronUp, ChevronDown, Minus } from 'lucide-react';

interface HUDHeaderProps {
  isClickThrough: boolean;
  opacity: number;
  onToggleClickThrough: () => void;
  onOpacityChange: (val: number) => void;
  onOpenSettings: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const HUDHeader: React.FC<HUDHeaderProps> = ({
  isClickThrough,
  opacity,
  onToggleClickThrough,
  onOpacityChange,
  onOpenSettings,
  isCollapsed,
  onToggleCollapse,
}) => {
  const [stealthProtected, setStealthProtected] = useState(true);

  const handleQuit = () => {
    if (window.electronAPI?.quitApp) {
      window.electronAPI.quitApp();
    } else {
      window.close();
    }
  };

  const handleHideOverlay = () => {
    if (window.electronAPI?.toggleWindowVisibility) {
      window.electronAPI.toggleWindowVisibility();
    }
  };

  const handleToggleStealth = () => {
    const nextState = !stealthProtected;
    setStealthProtected(nextState);
    if (window.electronAPI?.setStealthProtection) {
      window.electronAPI.setStealthProtection(nextState);
    }
  };

  return (
    <div
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-black/60 select-none cursor-move"
    >
      <div className="flex items-center space-x-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="font-semibold text-xs tracking-wider uppercase text-slate-200">
          Only Layers
        </span>
        <button
          onClick={handleToggleStealth}
          title={stealthProtected ? 'Screenshare Protected (Hidden from recording). Click to toggle.' : 'Stealth Protection OFF (Visible in recording). Click to toggle.'}
          className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-mono border transition-colors ${
            stealthProtected
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
              : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
          }`}
        >
          {stealthProtected ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
          <span>{stealthProtected ? 'Stealth ON' : 'Stealth OFF'}</span>
        </button>
      </div>

      <div className="flex items-center space-x-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* Click-Through Toggle */}
        <button
          onClick={onToggleClickThrough}
          title="Toggle Click-Through (Cmd/Ctrl + M)"
          className={`p-1 rounded text-xs transition-colors flex items-center gap-1 px-1.5 ${
            isClickThrough
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              : 'hover:bg-white/10 text-slate-300'
          }`}
        >
          <MousePointer className="w-3 h-3" />
          <span className="text-[10px] font-mono">{isClickThrough ? 'Locked' : 'Clickable'}</span>
        </button>

        {/* Opacity Slider */}
        <div className="flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded border border-white/10" title="Overlay Opacity">
          {opacity < 0.5 ? <EyeOff className="w-3 h-3 text-slate-400" /> : <Eye className="w-3 h-3 text-slate-300" />}
          <input
            type="range"
            min="0.2"
            max="1.0"
            step="0.05"
            value={opacity}
            onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
            className="w-12 h-1 accent-indigo-500 cursor-pointer"
          />
          <span className="text-[10px] text-slate-400 font-mono w-5">
            {Math.round(opacity * 100)}%
          </span>
        </div>

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          title="Settings (API Key & Shortcuts)"
          className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        {/* Hide Overlay */}
        <button
          onClick={handleHideOverlay}
          title="Hide Overlay into Background (Cmd/Ctrl + B)"
          className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        {/* Collapse */}
        <button
          onClick={onToggleCollapse}
          title={isCollapsed ? 'Expand' : 'Collapse'}
          className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
        >
          {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>

        {/* Close/Quit */}
        <button
          onClick={handleQuit}
          title="Quit Application"
          className="p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition-colors"
        >
          <Power className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
