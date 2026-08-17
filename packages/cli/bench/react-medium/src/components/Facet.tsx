interface Props {
  label: string;
  options: string[];
  active: string;
  onPick: (value: string) => void;
}

export default function Facet({ label, options, active, onPick }: Props) {
  return (
    <div className="facet">
      <p className="facet-label">{label}</p>
      <div className="facet-options">
        {options.map((opt) => (
          <button
            key={opt}
            className={'chip' + (opt === active ? ' chip-on' : '')}
            onClick={() => onPick(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
