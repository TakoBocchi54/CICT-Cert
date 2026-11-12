import { paperLabel } from '../lib/certificateTemplate';
import { useCertificateTemplates } from '../hooks/useCertificateTemplates';

// "Certificate design" for a seminar: '' = built-in design, otherwise a templateID.
export default function TemplatePicker({ id, value, onChange }) {
  const templates = useCertificateTemplates();
  return (
    <div>
      <label htmlFor={id} className="eyebrow mb-2 block">Certificate design</label>
      <div className="relative">
        <select id={id} className="field cursor-pointer appearance-none !pr-11" value={value} onChange={event => onChange(event.target.value)}
          aria-describedby={id + '-hint'}>
          <option value="">Built-in design</option>
          {templates.data?.map(template => <option key={template.templateID} value={template.templateID}>
            {template.name} · {paperLabel(template)}</option>)}
        </select>
        <i className="ph-bold ph-caret-down pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-ink-muted" aria-hidden="true"></i>
      </div>
      <p id={id + '-hint'} className="mt-1.5 text-xs text-ink-muted">
        {templates.error ? 'Templates could not be loaded; the built-in design is still available.' : 'Upload and edit designs in the Templates tab.'}
      </p>
    </div>
  );
}
