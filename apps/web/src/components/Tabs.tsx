import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem<T extends string> {
  value: T;
  label: string;
}

/** WAI-ARIA tabs: arrow keys, Home and End move between tabs; only the active tab is in the tab order. */
export function Tabs<T extends string>({ label, tabs, value, onChange, children }: { label: string; tabs: Array<TabItem<T>>; value: T; onChange: (value: T) => void; children: ReactNode }) {
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(0, tabs.findIndex((t) => t.value === value));

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const tab = tabs[next];
    if (tab) {
      onChange(tab.value);
      refs.current[next]?.focus();
    }
  }

  return (
    <div className="tabs">
      <div role="tablist" aria-label={label} className="tabs__list">
        {tabs.map((tab, i) => (
          <button
            key={tab.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.value}`}
            aria-selected={tab.value === value}
            aria-controls={`${base}-panel`}
            tabIndex={tab.value === value ? 0 : -1}
            className="tabs__tab"
            onClick={() => onChange(tab.value)}
            onKeyDown={onKeyDown}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`} className="tabs__panel" tabIndex={0}>
        {children}
      </div>
    </div>
  );
}
