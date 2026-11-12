import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Btn, Certificate } from '../components/design-system';
import { api } from '../lib/api';
import { paperLabel, SAMPLE_CERTIFICATE } from '../lib/certificateTemplate';
import { useCertificateTemplates } from '../hooks/useCertificateTemplates';
import TemplateEditor from '../components/TemplateEditor';

const MAX_TEMPLATE_MB = 5;
const SIZES = 'A4 (3508×2480 or 1754×1240 px) or US Letter (3300×2550 or 1650×1275 px), landscape or portrait';

// Shared library of certificate designs: an uploaded background with the certificate's fields placed on it.
export default function TemplatesPage() {
  const queryClient = useQueryClient();
  const templates = useCertificateTemplates();
  const [openID, setOpenID] = useState(null);
  const [fileError, setFileError] = useState('');
  const input = useRef(null);
  const open = templates.data?.find(template => template.templateID === openID);

  const upload = useMutation({
    mutationFn: file => api('/api/faculty/certificate-templates?name=' + encodeURIComponent(file.name.replace(/\.[^.]+$/, '').slice(0, 100) || 'Untitled'),
      { method: 'POST', body: file }),
    onSuccess: async template => {
      await queryClient.invalidateQueries({ queryKey: ['certificate-templates'] });
      setOpenID(template.templateID);
    },
  });
  function pick(file) {
    setFileError('');
    upload.reset();
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) return setFileError('Choose a PNG or JPG image.');
    if (file.size > MAX_TEMPLATE_MB * 1024 * 1024) return setFileError(`The image is larger than ${MAX_TEMPLATE_MB} MB. Export it smaller and try again.`);
    upload.mutate(file);
  }

  if (open) return <TemplateEditor key={open.templateID} template={open} onBack={() => setOpenID(null)} />;

  return (
    <div className="pb-16">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="eyebrow mb-3 rise">Templates</div>
          <h1 className="font-serif text-5xl md:text-6xl font-medium leading-[1.02] rise" style={{ '--d': '.05s' }}>Certificate designs</h1>
          <p className="text-ink-soft text-lg mt-4 max-w-2xl rise" style={{ '--d': '.1s' }}>
            Upload a background designed elsewhere (Canva, Photoshop…) and place the student's name, the seminar, the date, the QR code and signatures on it.
            Choose a design for each seminar when you create or edit it.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <input ref={input} type="file" accept="image/png,image/jpeg" className="sr-only" tabIndex={-1} aria-hidden="true"
            onChange={event => { pick(event.target.files[0]); event.target.value = ''; }} />
          <Btn icon="ph-upload-simple" disabled={upload.isPending} onClick={() => input.current.click()}>
            {upload.isPending ? 'Uploading...' : 'New template'}</Btn>
        </div>
      </div>
      <p className="mb-6 text-sm text-ink-muted">PNG or JPG up to {MAX_TEMPLATE_MB} MB, sized {SIZES}.</p>
      {(fileError || upload.error) && <p role="alert" className="mb-6 text-sm text-revoked">{fileError || upload.error.message}</p>}

      {templates.isPending ? <p role="status">Loading templates...</p> : templates.error ? (
        <div role="alert" className="space-y-3">
          <p className="text-sm text-revoked">{templates.error.message}</p>
          <Btn variant="line" onClick={() => templates.refetch()}>Try again</Btn>
        </div>
      ) : !templates.data.length ? (
        <div className="sheet flex flex-col items-center gap-3 p-12 text-center">
          <i className="ph ph-frame-corners text-4xl text-ink-muted" aria-hidden="true"></i>
          <p className="font-serif text-2xl">No templates yet</p>
          <p className="max-w-md text-sm text-ink-soft">Seminars use the built-in design until you add one. Upload your certificate background to start.</p>
        </div>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {templates.data.map(template => (
            <li key={template.templateID}>
              <button type="button" onClick={() => setOpenID(template.templateID)}
                className="sheet group block w-full cursor-pointer p-4 text-left transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
                <div className="flex h-56 items-center justify-center overflow-hidden rounded-lg bg-paper-2 p-3" inert>
                  <div className="h-full" style={{ aspectRatio: `${template.width} / ${template.height}`, maxWidth: '100%' }}>
                    <Certificate cert={SAMPLE_CERTIFICATE} template={template} tilt={false} className="!shadow-none" />
                  </div>
                </div>
                <div className="mt-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold" title={template.name}>{template.name}</div>
                    <div className="mt-0.5 text-xs text-ink-muted">{paperLabel(template)} · by {template.createdByName}</div>
                  </div>
                  {template.locked && <span className="flex shrink-0 items-center gap-1 rounded-full bg-paper-2 px-2.5 py-1 text-xs font-medium text-ink-soft">
                    <i className="ph-fill ph-lock-simple" aria-hidden="true"></i>Locked</span>}
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  {template.seminarCount ? `Used by ${template.seminarCount} ${template.seminarCount === 1 ? 'seminar' : 'seminars'}` : 'Not used by any seminar yet'}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
