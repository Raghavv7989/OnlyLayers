import React, { useState, useEffect } from 'react';
import { HUDHeader } from './components/HUDHeader';
import { WorkspaceTabs } from './components/WorkspaceTabs';
import { SettingsModal } from './components/SettingsModal';
import { getStoredApiKey } from './services/geminiLive';

export const App: React.FC = () => {
  const [isClickThrough, setIsClickThrough] = useState(false);
  const [opacity, setOpacity] = useState(0.92);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    // Check if API key is set on initial launch; if not, suggest opening settings
    const key = getStoredApiKey();
    if (!key) {
      setIsSettingsOpen(true);
    }

    if (window.electronAPI?.onClickThroughToggled) {
      window.electronAPI.onClickThroughToggled((isLocked) => {
        setIsClickThrough(isLocked);
      });
    }
  }, []);

  // Interactive Input Focus Bridge:
  // Dynamically enables window focus when user interacts with an input/textarea,
  // and restores focusable: false on blur to prevent focus loss on active foreground apps.
  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        window.electronAPI?.setFocusable?.(true);
      }
    };
    const handleFocusOut = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        window.electronAPI?.setFocusable?.(false);
      }
    };
    window.addEventListener('focusin', handleFocusIn);
    window.addEventListener('focusout', handleFocusOut);
    return () => {
      window.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  // Renderer-level window shortcut fallback for Cmd/Ctrl + B (Toggle HUD) & Cmd/Ctrl + M (Hide)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        // Request main process to toggle visibility via IPC
        window.electronAPI?.toggleHud?.();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        window.electronAPI?.hideHud?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleToggleClickThrough = () => {
    const nextState = !isClickThrough;
    setIsClickThrough(nextState);
    if (window.electronAPI?.setIgnoreMouseEvents) {
      window.electronAPI.setIgnoreMouseEvents(nextState);
    }
  };

  const handleOpacityChange = (val: number) => {
    setOpacity(val);
    if (window.electronAPI?.setOpacity) {
      window.electronAPI.setOpacity(val);
    }
  };

  return (
    <div
      className={`w-screen h-screen flex flex-col transition-opacity duration-150 ${
        isClickThrough ? 'pointer-events-none opacity-40' : ''
      }`}
      style={{ opacity: isClickThrough ? Math.min(opacity, 0.4) : opacity }}
    >
      <div className="w-full h-full flex flex-col rounded-2xl overflow-hidden hud-glass shadow-2xl border border-white/10">
        {/* HUD Window Header */}
        <HUDHeader
          isClickThrough={isClickThrough}
          opacity={opacity}
          onToggleClickThrough={handleToggleClickThrough}
          onOpacityChange={handleOpacityChange}
          onOpenSettings={() => setIsSettingsOpen(true)}
          isCollapsed={isCollapsed}
          onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
        />

        {/* Collapsible Content Body with Parakeet-speed Workspace */}
        {!isCollapsed && (
          <div className="flex-1 flex flex-col p-3 overflow-hidden">
            <WorkspaceTabs initialTab="copilot" />
          </div>
        )}
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
};
