import { Search, X } from 'lucide-react';

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  // aria-label; defaults to the placeholder.
  label?: string;
  // Screen-reader announcement of the result ("3 matches"), rendered in a
  // persistent live region so it's announced reliably.
  status?: string;
  className?: string;
}

// Compact filter box at the top of each resources-panel tab. The parent owns
// the value and does the matching (client-side for Directory and Recents, the
// backend's `q` for SWML and SIP). `data-no-autofocus` keeps useDialog from
// focusing it when the panel opens -- that would pop the on-screen keyboard
// over the short panel on phones -- so it's one Tab away instead. Escape isn't
// handled here: useDialog's native listener closes the panel first anyway.
function SearchField({ value, onChange, placeholder, label, status = '', className = 'mb-2' }: SearchFieldProps) {
  return (
    <div className={`relative ${className}`}>
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="search"
        data-no-autofocus
        className="w-full rounded-lg border border-edge-strong bg-surface-2 py-1.5 pl-8 pr-9 text-sm text-ink outline-hidden placeholder:text-faint focus:border-accent-edge focus:ring-2 focus:ring-accent-soft [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
      />
      {value !== '' && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full p-2 text-muted transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <X size={14} />
        </button>
      )}
      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>
    </div>
  );
}

export default SearchField;
