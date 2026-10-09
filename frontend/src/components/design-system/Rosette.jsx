export const Rosette = ({ color = '#0e3b2c', className = '', style }) => (
  <svg viewBox="-100 -100 200 200" className={className} style={style} fill="none" stroke={color} strokeWidth=".55">
    {Array.from({ length: 18 }).map((_, i) => (
      <ellipse key={i} rx="92" ry="34" transform={`rotate(${i * 10})`} />
    ))}
    {Array.from({ length: 6 }).map((_, i) => (
      <circle key={i} r={92 - i * 13} opacity={.6} />
    ))}
  </svg>
);
