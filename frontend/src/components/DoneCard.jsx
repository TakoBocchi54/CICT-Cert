import { Btn } from './design-system';

// Shown in place of an upload box once a step is complete.
export default function DoneCard({ count, label, action, onAction, disabled, note }) {
  return (
    <div className="rounded-2xl border border-[#bfe0cd] bg-verified-bg p-6 flex flex-wrap items-center justify-between gap-5">
      <div className="flex items-center gap-4">
        <i className="ph-fill ph-check-circle text-4xl text-verified" aria-hidden="true"></i>
        <div>
          <div className="font-serif text-3xl font-medium leading-none text-verified">{count}</div>
          <div className="eyebrow !text-verified mt-1">{label}</div>
          {note && <p className="text-xs text-ink-soft mt-2 max-w-md">{note}</p>}
        </div>
      </div>
      <Btn variant="line" size="sm" disabled={disabled} onClick={onAction}>{action}</Btn>
    </div>
  );
}
