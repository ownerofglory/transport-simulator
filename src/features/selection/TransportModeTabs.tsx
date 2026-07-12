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
  return (
    <div className="transport-tabs" role="tablist" aria-label="Means of transport">
      {definitions.map((definition) => {
        const enabled = available.includes(definition.id);
        return (
          <button
            role="tab"
            key={definition.id}
            disabled={!enabled}
            className={selected === definition.id ? 'active' : ''}
            aria-selected={selected === definition.id}
            onClick={() => onSelect(definition.id)}
          >
            {definition.label}
          </button>
        );
      })}
    </div>
  );
}
