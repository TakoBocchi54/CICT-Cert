import { useId } from 'react';

const STATUS_CONFIG = {
  Verified: { color: '#157347', icon: 'ph-seal-check', word: 'VERIFIED' },
  Revoked: { color: '#b3261e', icon: 'ph-seal-warning', word: 'REVOKED' },
  Pending: { color: '#a96a0c', icon: 'ph-hourglass-medium', word: 'PENDING' },
  Invalid: { color: '#4b5563', icon: 'ph-question', word: 'NOT FOUND' },
};

export const Seal = ({ status = 'Verified', size = 96, animate = false }) => {
  const uid = useId().replace(/:/g, '');
  const c = STATUS_CONFIG[status].color;
  const word = status === 'Verified' ? 'CICT-CERT · VERIFIED · ON-CHAIN · ' 
    : status === 'Revoked' ? 'CICT-CERT · REVOKED · INVALIDATED · ' 
    : status === 'Pending' ? 'CICT-CERT · PENDING · CONFIRMING · ' 
    : 'CICT-CERT · NO RECORD · UNVERIFIED · ';
  const scallops = Array.from({ length: 36 });

  return (
    <svg style={{ width: size, height: size, overflow: 'visible' }} viewBox="0 0 120 120" className={animate ? 'stamp-in' : ''}>
      <defs><path id={'arc' + uid} d="M60,60 m-41,0 a41,41 0 1,1 82,0 a41,41 0 1,1 -82,0" /></defs>
      {scallops.map((_, i) => (
        <circle 
          key={i} 
          cx={60 + 55 * Math.cos(i * Math.PI / 18)} 
          cy={60 + 55 * Math.sin(i * Math.PI / 18)} 
          r="4.2" 
          fill={c} 
        />
      ))}
      <circle cx="60" cy="60" r="55" fill={c} />
      <circle cx="60" cy="60" r="50" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth=".8" />
      <circle cx="60" cy="60" r="27" fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth="1" />
      <g className="ring-spin">
        <text fill="#fff" fontSize="8.2" fontWeight="700" letterSpacing="1.2" fontFamily="Inter">
          <textPath href={'#arc' + uid} textLength="250" lengthAdjust="spacing">{word}</textPath>
        </text>
      </g>
      {status === 'Verified' && (
        <path 
          className={animate ? 'draw' : ''} 
          style={animate ? {} : { strokeDasharray: 0 }} 
          d="M47 61l9 9 17-19" 
          fill="none" 
          stroke="#fff" 
          strokeWidth="5" 
          strokeLinecap="round" 
          strokeLinejoin="round" 
        />
      )}
      {status === 'Revoked' && (
        <path d="M49 49l22 22M71 49L49 71" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      )}
      {status === 'Pending' && (
        <g stroke="#fff" strokeWidth="4.5" strokeLinecap="round" fill="none">
          <circle cx="60" cy="60" r="14" strokeWidth="3" />
          <path d="M60 52v9l6 4" />
        </g>
      )}
      {status === 'Invalid' && (
        <text x="60" y="73" textAnchor="middle" fontSize="36" fontWeight="700" fill="#fff" fontFamily="Fraunces">?</text>
      )}
    </svg>
  );
};
