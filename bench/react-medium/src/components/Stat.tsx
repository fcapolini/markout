interface Props {
  label: string;
  value: string | number;
  hint: string;
}

export default function Stat({ label, value, hint }: Props) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <span className="stat-hint">{hint}</span>
    </div>
  );
}
