const hashOf = (s) => { 
  let h = 2166136261; 
  for (const c of s) { 
    h ^= c.charCodeAt(0); 
    h = Math.imul(h, 16777619) >>> 0; 
  } 
  return h; 
};

export const QR = ({ value, size = 64, color = '#16231d' }) => {
  const n = 21; 
  let h = hashOf(value) || 1;
  const rnd = () => { 
    h ^= h << 13; 
    h >>>= 0; 
    h ^= h >>> 17; 
    h ^= h << 5; 
    h >>>= 0; 
    return h / 4294967296; 
  };
  const inF = (x, y) => (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
  const cells = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!inF(x, y) && rnd() > 0.52) {
        cells.push(<rect key={x + '-' + y} x={x} y={y} width="1" height="1" />);
      }
    }
  }
  const finder = (ox, oy) => (
    <g key={ox + '' + oy}>
      <rect x={ox} y={oy} width="7" height="7" />
      <rect x={ox + 1} y={oy + 1} width="5" height="5" fill="#fff" />
      <rect x={ox + 2} y={oy + 2} width="3" height="3" />
    </g>
  );
  return (
    <svg 
      viewBox={`-1 -1 ${n + 2} ${n + 2}`} 
      fill={color} 
      shapeRendering="crispEdges" 
      style={{ background: '#fff', width: size, height: size, display: 'block' }}
    >
      {cells}
      {finder(0, 0)}
      {finder(n - 7, 0)}
      {finder(0, n - 7)}
    </svg>
  );
};
