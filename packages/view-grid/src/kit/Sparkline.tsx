import './kit.css';

/** SVG polyline of `values`, scaled to fit its box (set the size with CSS or `width`/`height`). */
export function Sparkline({ values, width = 100, height = 24, title }: { values: readonly number[]; width?: number; height?: number; title?: string }) {
  const pad = 2;
  const nums = values.filter(Number.isFinite);
  const min = Math.min(...nums);
  const range = Math.max(...nums) - min || 1;
  const step = nums.length > 1 ? (width - pad * 2) / (nums.length - 1) : 0;
  const points = nums
    .map((v, i) => `${(pad + i * step).toFixed(1)},${(height - pad - ((v - min) / range) * (height - pad * 2)).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="kit-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={title}>
      {title && <title>{title}</title>}
      {nums.length > 0 && <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
