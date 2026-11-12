import { useEffect, useRef, useState } from 'react';

// Select-only combobox (WAI-ARIA pattern) so the open list can be capped at 7 rows and scroll; a native <select> can't.
// Focus stays on the button; arrow keys move the highlighted option.
export default function SeminarSelect({ id, labelId, seminars, value, onChange, format }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const list = useRef(null);
  const selectedIndex = seminars.findIndex(seminar => seminar.seminarID === value);
  const selected = seminars[selectedIndex];
  const label = seminar => `${seminar.seminarTitle} · ${format(seminar.seminarDate)}`;

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function show() { setActive(Math.max(selectedIndex, 0)); setOpen(true); }
  function choose(index) { setOpen(false); if (seminars[index]) onChange(seminars[index].seminarID); }
  function onKeyDown(event) {
    const last = seminars.length - 1;
    const keys = {
      ArrowDown: () => open ? setActive(Math.min(active + 1, last)) : show(),
      ArrowUp: () => open ? setActive(Math.max(active - 1, 0)) : show(),
      Home: () => open && setActive(0),
      End: () => open && setActive(last),
      Enter: () => open ? choose(active) : show(),
      ' ': () => open ? choose(active) : show(),
      Escape: () => setOpen(false),
    };
    if (event.key === 'Tab') return setOpen(false);
    if (!keys[event.key] || (event.key === 'Escape' && !open)) return;
    event.preventDefault();
    keys[event.key]();
  }

  return (
    <div className="relative">
      <i className="ph ph-calendar-blank pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-lg text-ink-muted" aria-hidden="true"></i>
      <button id={id} type="button" role="combobox" aria-labelledby={labelId} aria-haspopup="listbox" aria-expanded={open}
        aria-controls={id + '-list'} aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        onClick={() => open ? setOpen(false) : show()} onKeyDown={onKeyDown} title={selected ? label(selected) : undefined}
        className={'field relative block cursor-pointer truncate !py-[11px] !pl-11 !pr-11 text-left font-semibold hover:border-[#c9c1ab] ' + (selected ? 'text-ink' : 'text-ink-muted')}>
        {selected ? label(selected) : 'Select a seminar…'}
      </button>
      <i className={'ph-bold ph-caret-down pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-ink-muted transition-transform ' + (open ? 'rotate-180' : '')} aria-hidden="true"></i>

      {open && <>
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true"></div>
        {/* 7 rows of h-11 plus the list padding; more seminars scroll. */}
        <ul ref={list} id={id + '-list'} role="listbox" aria-labelledby={labelId}
          className="pop sheet absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[calc(7*2.75rem+1rem)] overflow-y-auto p-2"
          style={{ transformOrigin: 'top' }}>
          {seminars.map((seminar, index) => {
            const isSelected = seminar.seminarID === value;
            return (
              <li key={seminar.seminarID} id={`${id}-option-${index}`} role="option" aria-selected={isSelected} title={label(seminar)}
                onMouseEnter={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}
                className={'flex h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm ' + (index === active ? 'bg-paper-2' : '')}>
                <span className={'min-w-0 flex-1 truncate ' + (isSelected ? 'font-semibold text-forest' : 'text-ink')}>{seminar.seminarTitle}</span>
                <span className="shrink-0 text-xs text-ink-muted">{format(seminar.seminarDate)}</span>
                <i className={'ph-bold ph-check shrink-0 text-forest ' + (isSelected ? '' : 'invisible')} aria-hidden="true"></i>
              </li>
            );
          })}
        </ul>
      </>}
    </div>
  );
}
