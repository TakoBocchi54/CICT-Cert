import { Mark } from './Mark';

export const Lockup = ({ light = false, small = false }) => (
  <div className="flex items-center gap-2.5">
    <Mark size={small ? 28 : 36} light={light} />
    <div className="leading-none">
      <div className={"font-serif font-semibold " + (small ? 'text-[17px]' : 'text-[21px]') + (light ? ' text-white' : ' text-ink')}>CICT-Cert</div>
      <div className={"text-[9px] font-semibold tracking-[.2em] uppercase mt-1 " + (light ? 'text-white/60' : 'text-ink-muted')}>University of Batangas</div>
    </div>
  </div>
);
