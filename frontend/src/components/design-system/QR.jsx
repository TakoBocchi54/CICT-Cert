import qrcode from 'qrcode-generator';

export const QR = ({ value, size = 64, color = '#16231d' }) => {
  const code = qrcode(0, 'M');
  code.addData(value);
  code.make();
  const count = code.getModuleCount();
  let path = '';
  for (let row = 0; row < count; row++) {
    for (let column = 0; column < count; column++) {
      if (code.isDark(row, column)) path += `M${column + 4},${row + 4}h1v1h-1z`;
    }
  }
  return <svg viewBox={`0 0 ${count + 8} ${count + 8}`} width={size} height={size} role="img"
    aria-label="QR code linking to certificate verification" shapeRendering="crispEdges" className="block">
    <rect width={count + 8} height={count + 8} fill="#fff" />
    <path d={path} fill={color} />
  </svg>;
};
