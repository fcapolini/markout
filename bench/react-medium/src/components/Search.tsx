import { useId } from 'react';

interface Props {
  value: string;
  hits: number;
  onChange: (value: string) => void;
}

export default function Search({ value, hits, onChange }: Props) {
  const id = useId();
  return (
    <label className="search">
      <span className="facet-label" id={id}>Search</span>
      <input
        type="search"
        placeholder="Filter by name or brand"
        value={value}
        aria-labelledby={id}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="search-hits">{hits} matching</span>
    </label>
  );
}
