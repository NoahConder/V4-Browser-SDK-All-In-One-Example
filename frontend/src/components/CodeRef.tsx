import React, { useEffect, useId, useRef, useState } from 'react';
import { Code2, ExternalLink } from 'lucide-react';
import { CODE_MAP, GITHUB_BLOB, type FeatureKey } from '../codeMap';

interface CodeRefProps {
  feature: FeatureKey;
  className?: string;
  // Which edge of the button the popover hangs from.
  align?: 'left' | 'right';
}

const shortPath = (file: string) => file.replace(/^frontend\/src\//, '');

// "Where's the code?": a small </> button beside a feature that opens a
// popover naming the SDK API behind it, the file in this repository (linked
// to GitHub) and the SDK reference page (codeMap.ts). A plain popover, not a
// dialog: it never traps focus or moves it, so the address input keeps
// Enter-to-call, and it closes on Escape, an outside click or focus leaving.
const CodeRef: React.FC<CodeRefProps> = ({ feature, className = '', align = 'right' }) => {
  const entry = CODE_MAP[feature];
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    // Capture phase, and stop there: the screens' own Escape handlers (close
    // panels, close sheets) must not also fire for the popover's Escape.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setIsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [isOpen]);

  const onBlur = (e: React.FocusEvent) => {
    if (!wrapperRef.current?.contains(e.relatedTarget as Node | null)) setIsOpen(false);
  };

  return (
    <span ref={wrapperRef} onBlur={onBlur} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-controls={isOpen ? popoverId : undefined}
        aria-label={`Where's the code: ${entry.title}`}
        title={`Where's the code — ${entry.apis[0]}`}
        className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-surface-hover hover:text-accent-text ${
          isOpen ? 'bg-accent-soft text-accent-text' : 'text-faint'
        }`}
      >
        <Code2 size={14} />
      </button>
      {isOpen && (
        <div
          id={popoverId}
          role="group"
          aria-label={`Code for ${entry.title}`}
          className={`glass-panel absolute top-full z-40 mt-1 w-[min(21rem,calc(100vw-2rem))] rounded-xl p-3 text-left text-xs ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <div className="mb-2 text-sm font-medium text-ink">{entry.title}</div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-faint">Browser SDK</div>
          <ul className="mb-2 flex flex-wrap gap-1">
            {entry.apis.map((api) => (
              <li key={api} className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink select-text">
                {api}
              </li>
            ))}
          </ul>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-faint">In this repository</div>
          <ul className="mb-2 space-y-0.5">
            {entry.files.map((file) => (
              <li key={file}>
                <a
                  href={GITHUB_BLOB + file}
                  target="_blank"
                  rel="noreferrer"
                  title={file}
                  className="inline-flex max-w-full items-center gap-1 font-mono text-[11px] text-accent-text hover:underline"
                >
                  <span className="truncate">{shortPath(file)}</span>
                  <ExternalLink size={10} className="shrink-0" />
                </a>
              </li>
            ))}
          </ul>
          {entry.docs && (
            <a
              href={entry.docs.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent-text hover:underline"
            >
              SDK docs: {entry.docs.label}
              <ExternalLink size={10} />
            </a>
          )}
        </div>
      )}
    </span>
  );
};

export default CodeRef;
