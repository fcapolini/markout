interface Props {
  score: number;
  count: number;
}

export default function Rating({ score, count }: Props) {
  return (
    <span className="rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={'star' + (n <= score ? ' star-on' : '')}>&#9733;</span>
      ))}
      <span className="rating-count">{(score || 0).toFixed(1)} ({count})</span>
    </span>
  );
}
