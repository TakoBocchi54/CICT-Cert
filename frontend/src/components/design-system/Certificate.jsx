import { Mark } from './Mark';
import { Seal } from './Seal';
import { Rosette } from './Rosette';

const STATUS_CONFIG = {
  Verified: { color: '#157347', icon: 'ph-seal-check', word: 'VERIFIED' },
  Revoked: { color: '#b3261e', icon: 'ph-seal-warning', word: 'REVOKED' },
  Pending: { color: '#a96a0c', icon: 'ph-hourglass-medium', word: 'PENDING' },
};

const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

const SealCq = ({ status }) => (
  <div style={{ width: '12.5cqw', height: '12.5cqw' }}>
    <Seal status={status} size="100%" />
  </div>
);

export const Certificate = ({ cert, theme = 'classic', tilt = true, className = '' }) => {
  const ac = theme === 'modern' ? '#16231d' : theme === 'formal' ? '#7a5a1a' : '#0e3b2c';
  
  return (
    <div className={'cert ' + (tilt ? 'tilt ' : '') + className} data-theme={theme} data-status={cert.status}>
      <Rosette color={ac} className="absolute" style={{ width: '46cqw', left: '-14cqw', bottom: '-20cqw', opacity: .22, zIndex: 1 }} />
      <Rosette color={ac} className="absolute" style={{ width: '38cqw', right: '-12cqw', top: '-16cqw', opacity: .16, zIndex: 1 }} />
      <div className="cert-in">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-[1.2cqw]">
            <Mark size="4.4cqw" />
            <div style={{ lineHeight: 1 }}>
              <div className="font-serif font-semibold" style={{ fontSize: '2.4cqw' }}>CICT-Cert</div>
              <div style={{ fontSize: '1.05cqw', letterSpacing: '.18em', color: '#6a7a70', marginTop: '.4cqw', fontWeight: 600 }}>UNIVERSITY OF BATANGAS</div>
            </div>
          </div>
          <div className="font-mono text-right" style={{ fontSize: '1.3cqw', color: '#6a7a70' }}>
            <div style={{ letterSpacing: '.16em', fontSize: '1cqw', fontFamily: 'Inter', fontWeight: 600 }}>CREDENTIAL ID</div>
            {cert.id}
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center" style={{ marginTop: '-1cqw' }}>
          <div style={{ fontSize: '1.35cqw', letterSpacing: '.34em', fontWeight: 600, color: ac }}>CERTIFICATE OF PARTICIPATION</div>
          <div className="font-serif italic" style={{ fontSize: '1.9cqw', color: '#6a7a70', marginTop: '2cqw' }}>This is to certify that</div>
          <div className="font-serif font-medium" style={{ fontSize: '5.6cqw', lineHeight: 1.1, marginTop: '.8cqw' }}>{cert.recipient}</div>
          <div style={{ width: '9cqw', height: '.25cqw', background: ac, margin: '1.8cqw 0' }}></div>
          <div style={{ fontSize: '1.7cqw', color: '#3a4a41' }}>has attended and successfully completed the seminar</div>
          <div className="font-serif font-semibold" style={{ fontSize: '3.5cqw', lineHeight: 1.15, marginTop: '1cqw', maxWidth: '62cqw' }}>{cert.seminar}</div>
          <div style={{ fontSize: '1.5cqw', color: '#6a7a70', marginTop: '1.2cqw' }}>Awarded {fmt(cert.iso)} · College of Information and Communications Technology</div>
        </div>
        <div className="flex items-end justify-between">
          <div style={{ width: '22cqw' }}>
            <div className="font-script" style={{ fontSize: '4.2cqw', lineHeight: 1, color: ac }}>&nbsp;</div>
            <div style={{ borderTop: '1px solid #16231d55', marginTop: '.4cqw', paddingTop: '.6cqw', fontSize: '1.15cqw', letterSpacing: '.14em', fontWeight: 600, color: '#6a7a70' }}>SEMINAR COORDINATOR</div>
          </div>
          <div style={{ marginBottom: '-.6cqw' }}><SealCq status={cert.status} /></div>
        </div>
      </div>
      {cert.status !== 'Verified' && <div className={'cert-stamp ' + cert.status}>{STATUS_CONFIG[cert.status].word}</div>}
      <div className="cert-reveal">
        <span className="flex items-center gap-[.8cqw]" style={{ color: STATUS_CONFIG[cert.status]?.color || '#4b5563' }}>
          <i className={'ph-fill ' + (STATUS_CONFIG[cert.status]?.icon || 'ph-question')} style={{ fontSize: '2.6cqw' }}></i>
          {cert.status === 'Verified' ? 'Verified on Polygon' : cert.status === 'Revoked' ? 'Revoked by issuer' : 'Awaiting block confirmations'}
        </span>
        <span className="font-mono" style={{ color: '#6a7a70', fontWeight: 400 }}>Block #{cert.block?.toLocaleString() || '0'}</span>
      </div>
    </div>
  );
};
