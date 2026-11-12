import { Mark } from './Mark';
import { Seal } from './Seal';
import { Rosette } from './Rosette';
import { QR } from './QR';

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

const FONT_CLASS = { serif: 'font-serif', sans: 'font-sans', script: 'font-script', mono: 'font-mono' };
const SHIFT_X = { left: '0%', center: '-50%', right: '-100%' };
const longDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

// Uploaded background with fields placed in percent of the page. Sizes use cqw (1% of the certificate width), so the
// layout is identical in thumbnails, the template editor and the exported PDF. fieldProps lets the editor make fields draggable.
function TemplateLayout({ cert, template, verificationUrl, fieldProps }) {
  const { text, qr, signatures = [] } = template.fields;
  const values = { recipientName: cert.recipient, seminarTitle: cert.seminar, seminarDate: longDate(cert.iso), certificateNo: 'No. ' + cert.id };
  const placed = (key, x, y, shiftX, extra = {}) => {
    const { style, ...props } = { ...fieldProps?.(key), ...extra };
    return { ...props, style: { position: 'absolute', left: x + '%', top: y + '%', transform: `translate(${shiftX}, -50%)`, ...style } };
  };
  const images = Object.fromEntries((template.signatures || []).map(signature => [signature.signatureID, signature.imageUrl]));
  return <>
    <img src={template.imageUrl} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none" />
    {Object.entries(text).filter(([, field]) => field.show).map(([key, field]) => (
      <div key={key} {...placed(key, field.x, field.y, SHIFT_X[field.align], { style: {
        width: 'max-content', maxWidth: field.maxWidth + 'cqw', fontSize: field.size + 'cqw', color: field.color, textAlign: field.align,
        fontWeight: field.bold ? 700 : 400, lineHeight: 1.15, overflowWrap: 'anywhere' } })} className={FONT_CLASS[field.font] + ' ' + (fieldProps?.(key)?.className || '')}>
        {values[key]}
      </div>
    ))}
    {signatures.filter(signature => images[signature.signatureID]).map(signature => {
      const key = 'sig:' + signature.signatureID;
      return (
        <div key={key} {...placed(key, signature.x, signature.y, '-50%', { style: { width: signature.width + 'cqw', color: signature.color } })}
          className={'flex flex-col items-center text-center ' + FONT_CLASS[signature.font] + ' ' + (fieldProps?.(key)?.className || '')}>
          <img src={images[signature.signatureID]} alt="" draggable={false} className="pointer-events-none block w-full select-none" />
          {signature.line && <div className="w-full" style={{ borderTop: '1px solid currentColor', opacity: .7 }} />}
          {signature.name && <div style={{ fontSize: signature.size + 'cqw', fontWeight: 600, lineHeight: 1.2, marginTop: '.3cqw' }}>{signature.name}</div>}
          {signature.title && <div style={{ fontSize: signature.size * .85 + 'cqw', lineHeight: 1.2 }}>{signature.title}</div>}
        </div>
      );
    })}
    <div {...placed('qr', qr.x, qr.y, '-50%', { style: { width: qr.size + 'cqw' } })}>
      {verificationUrl
        ? <a href={verificationUrl} className="block" aria-label="Verify this certificate"><QR value={verificationUrl} size="100%" color="#000" /></a>
        : <div className="flex aspect-square w-full flex-col items-center justify-center gap-[.4cqw] rounded-[.6cqw] border border-dashed border-ink-muted bg-white/80 text-ink-muted">
          <i className="ph ph-qr-code" style={{ fontSize: qr.size * .45 + 'cqw' }} aria-hidden="true"></i>
          <span style={{ fontSize: '1cqw' }}>QR code</span>
        </div>}
    </div>
  </>;
}

export const Certificate = ({ cert, theme = 'classic', tilt = true, draft = false, verificationUrl, template = cert.template, fieldProps, className = '' }) => {
  const ac = theme === 'modern' ? '#16231d' : theme === 'formal' ? '#7a5a1a' : '#0e3b2c';
  
  return (
    <div className={'cert ' + (tilt ? 'tilt ' : '') + className} data-theme={theme} data-status={cert.status} data-template={template ? '' : undefined}
      style={template ? { aspectRatio: `${template.width} / ${template.height}` } : undefined}>
      {template ? <TemplateLayout cert={cert} template={template} verificationUrl={verificationUrl} fieldProps={fieldProps} /> : <>
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
          <div className="flex items-end gap-[2cqw]">
            {verificationUrl && <a href={verificationUrl} className="flex flex-col items-center gap-[.4cqw] text-ink" aria-label="Verify this certificate">
              <QR value={verificationUrl} size="12.5cqw" color="#000" />
              <span className="text-[1.1cqw] font-semibold">Scan to verify</span>
            </a>}
            <div style={{ marginBottom: '-.6cqw' }}><SealCq status={cert.status} /></div>
          </div>
        </div>
        {cert.hash && !draft && <p className="mt-[1.2cqw] break-all font-mono text-[1cqw] leading-snug text-ink-muted">
          <span className="font-sans font-semibold">Certificate hash: </span>{cert.hash}
        </p>}
      </div>
      </>}
      {cert.status !== 'Verified' && <div className={'cert-stamp ' + cert.status}>{STATUS_CONFIG[cert.status].word}</div>}
      <div className="cert-reveal px-[3.4cqw] py-[.75cqw] text-[1.3cqw]">
        <span className="flex items-center gap-[.8cqw]" style={{ color: STATUS_CONFIG[cert.status]?.color || '#4b5563' }}>
          <i className={'ph-fill text-[1.8cqw] leading-none ' + (STATUS_CONFIG[cert.status]?.icon || 'ph-question')}></i>
          {draft ? 'Draft - not issued' : cert.status === 'Verified' ? 'Verified on Polygon' : cert.status === 'Revoked' ? 'Revoked by issuer' : 'Awaiting block confirmations'}
        </span>
        {!draft && cert.block != null && <span className="font-mono" style={{ color: '#6a7a70', fontWeight: 400 }}>Block #{cert.block.toLocaleString()}</span>}
      </div>
    </div>
  );
};
