import { Video } from 'lucide-react';
import type { AddressSuggestion } from '../hooks/useAddressSuggestions';

const KIND_META: Record<AddressSuggestion['kind'], { label: string; className: string }> = {
  recent: { label: 'Recent', className: 'bg-surface-2 text-muted' },
  subscriber: { label: 'Subscriber', className: 'bg-grass-soft text-grass-text' },
  room: { label: 'Room', className: 'bg-accent-soft text-accent-text' },
  app: { label: 'App', className: 'bg-accent-soft text-accent-text' },
  call: { label: 'Call', className: 'bg-warn-soft text-warn-text' },
};

interface AddressSuggestionsProps {
  // The listbox id the address input's aria-controls points at; options are
  // `${id}-${index}` for aria-activedescendant.
  id: string;
  suggestions: AddressSuggestion[];
  highlighted: number;
  onPick: (suggestion: AddressSuggestion) => void;
  onHover: (index: number) => void;
}

// The dropdown under the address field (Dialer.tsx owns the query, the
// keyboard handling and the highlight; this just draws it). Mousedown is
// swallowed so the input keeps focus -- blurring would close the list before
// the click lands.
function AddressSuggestions({ id, suggestions, highlighted, onPick, onHover }: AddressSuggestionsProps) {
  if (suggestions.length === 0) return null;

  return (
    <ul
      id={id}
      role="listbox"
      aria-label="Suggested destinations"
      className="absolute inset-x-0 top-full z-20 mt-2 max-h-72 overflow-y-auto rounded-xl border border-edge-strong bg-surface p-1 shadow-card"
    >
      {suggestions.map((suggestion, index) => {
        const meta = KIND_META[suggestion.kind];
        const isHighlighted = index === highlighted;
        return (
          <li
            key={suggestion.key}
            id={`${id}-${index}`}
            role="option"
            aria-selected={isHighlighted}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onHover(index)}
            onClick={() => onPick(suggestion)}
            className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 ${
              isHighlighted ? 'bg-surface-2' : 'hover:bg-surface-hover'
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">{suggestion.label}</span>
              <span className="block truncate font-mono text-[11px] text-faint">{suggestion.path}</span>
            </span>
            {suggestion.video && <Video size={12} className="shrink-0 text-muted" aria-label="Video call" />}
            <span
              className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
            >
              {meta.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default AddressSuggestions;
