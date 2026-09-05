import { useRef } from 'react';
import type { TransportModeDefinition, TransportMode } from '../../domain/transport';

export function TransportModeTabs({
  definitions,
  available,
  selected,
  onSelect
}: {
  definitions: TransportModeDefinition[];
  available: TransportMode[];
  selected: TransportMode;
  onSelect: (mode: TransportMode) => void;
}) {
  const buttons = useRef(new Map<TransportMode, HTMLButtonElement>());
  const enabledModes = definitions.filter((definition) => available.includes(definition.id)).map((definition) => definition.id);

  const moveFocus = (event: React.KeyboardEvent<HTMLButtonElement>, current: TransportMode) => {
    const index = enabledModes.indexOf(current);
    if (index < 0) return;
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % enabledModes.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + enabledModes.length) % enabledModes.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabledModes.length - 1;
    else return;
    event.preventDefault();
    const mode = enabledModes[next];
    onSelect(mode);
    buttons.current.get(mode)?.focus();
  };

  return (
    <div className="transport-tabs" role="tablist" aria-label="Means of transport">
      {definitions.map((definition) => {
        const enabled = available.includes(definition.id);
        return (
          <button
            role="tab"
            key={definition.id}
            ref={(button) => {
              if (button) buttons.current.set(definition.id, button);
              else buttons.current.delete(definition.id);
            }}
            disabled={!enabled}
            className={selected === definition.id ? 'active' : ''}
            aria-selected={selected === definition.id}
            tabIndex={enabled && selected === definition.id ? 0 : -1}
            onClick={() => onSelect(definition.id)}
            onKeyDown={(event) => moveFocus(event, definition.id)}
          >
            {definition.label}
          </button>
        );
      })}
    </div>
  );
}
