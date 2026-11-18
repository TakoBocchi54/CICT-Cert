import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

// Icon and tone for each kind GET /api/notifications returns.
const LOOKS = {
  issued: ['ph-seal-check', 'bg-verified-bg text-verified'],
  revoked: ['ph-seal-warning', 'bg-revoked-bg text-revoked'],
  registrations: ['ph-user-plus', 'bg-paper-2 text-forest'],
  closed: ['ph-door', 'bg-paper-2 text-ink-soft'],
  failed: ['ph-warning-circle', 'bg-revoked-bg text-revoked'],
  pending: ['ph-hourglass-medium', 'bg-pending-bg text-pending'],
  'low-balance': ['ph-wallet', 'bg-pending-bg text-pending'],
};

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function ago(iso, now) {
  const seconds = (new Date(iso) - now) / 1000;
  for (const [unit, size] of [['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

// The bell in the top bar: unread count, and a list whose rows open where each item is acted on.
// Opening it marks everything read; rows that were unread stay highlighted until it is closed.
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: ({ signal }) => api('/api/notifications', { signal }),
    refetchInterval: 60_000, refetchOnWindowFocus: true, retry: false,
  });
  const markSeen = useMutation({
    mutationFn: () => api('/api/notifications/seen', { method: 'POST' }),
    onSuccess: () => queryClient.setQueryData(['notifications'], old => old && { ...old, unread: 0 }),
  });
  const data = notifications.data;
  const unread = data?.unread ?? 0;
  const seenAt = data?.seenAt ? new Date(data.seenAt) : null;

  useEffect(() => {
    if (!open) return;
    const onKey = event => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function toggle() {
    if (open) { setOpen(false); queryClient.invalidateQueries({ queryKey: ['notifications'] }); return; }
    setOpen(true);
    if (unread && !markSeen.isPending) markSeen.mutate();
  }

  async function follow(item) {
    setOpen(false);
    // Pages read their data when they mount; refresh it so the item's change is there.
    if (item.link.startsWith('/student/')) await queryClient.invalidateQueries({ queryKey: ['student-certificates'] });
    else queryClient.invalidateQueries();
    navigate(item.link, { state: { fromNotification: true } });
  }

  return (
    <div className="relative">
      <span className="sr-only" aria-live="polite">{unread ? `${unread} unread ${unread === 1 ? 'notification' : 'notifications'}` : ''}</span>
      <button type="button" onClick={toggle} aria-expanded={open} aria-controls="notification-panel"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
        <i className={'text-xl ' + (unread ? 'ph-fill ph-bell-ringing text-white' : 'ph-bold ph-bell')} aria-hidden="true"></i>
        {unread > 0 && <span aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-revoked px-1 text-[11px] font-bold leading-none text-white tabular-nums ring-2 ring-forest">
          {unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && <>
        <div className="fixed inset-0 z-40" onClick={toggle} aria-hidden="true"></div>
        <section id="notification-panel" aria-label="Notifications"
          className="pop sheet fixed right-4 top-[84px] z-50 w-[calc(100vw-2rem)] max-w-[20rem] overflow-hidden sm:absolute sm:right-0 sm:top-[52px]"
          style={{ transformOrigin: 'top right' }}>
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
            <h2 className="text-sm font-semibold">Notifications</h2>
            {notifications.isFetching && <i className="ph-bold ph-circle-notch animate-spin text-sm text-ink-muted motion-reduce:animate-none" aria-hidden="true"></i>}
          </div>
          {notifications.isPending ? <p role="status" className="px-4 py-6 text-center text-sm text-ink-muted">Loading notifications...</p>
            : notifications.error ? (
              <div role="alert" className="space-y-2 px-4 py-6 text-center text-sm text-revoked">
                <p>{notifications.error.message}</p>
                <button type="button" onClick={() => notifications.refetch()} className="cursor-pointer text-xs font-semibold underline">Try again</button>
              </div>
            ) : !data.items.length ? (
              <div className="flex flex-col items-center gap-1.5 px-4 py-6 text-center">
                <i className="ph ph-checks text-2xl text-ink-muted" aria-hidden="true"></i>
                <p className="text-sm text-ink-muted">You're all caught up.</p>
              </div>
            ) : (
              <ul className="max-h-[min(50vh,22rem)] overflow-y-auto p-1.5">
                {data.items.map(item => {
                  const [icon, tone] = LOOKS[item.kind] ?? ['ph-bell', 'bg-paper-2 text-ink-soft'];
                  const isNew = !seenAt || new Date(item.at) > seenAt;
                  const external = /^https?:/.test(item.link);
                  const body = <>
                    <span className={'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm ' + tone} aria-hidden="true"><i className={'ph-bold ' + icon}></i></span>
                    <span className="min-w-0 flex-1">
                      <span className={'block break-words text-[13px] leading-snug ' + (isNew ? 'font-semibold text-ink' : 'text-ink-soft')}>
                        {isNew && <span className="sr-only">New: </span>}{item.text}</span>
                      <span className="mt-0.5 block text-xs text-ink-muted">{ago(item.at, notifications.dataUpdatedAt)}{external && ' · opens PolygonScan'}</span>
                    </span>
                    {isNew && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-forest" aria-hidden="true"></span>}
                  </>;
                  const look = 'flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-forest';
                  return (
                    <li key={item.id}>
                      {external ? <a href={item.link} target="_blank" rel="noreferrer" className={look} onClick={() => setOpen(false)}>{body}</a>
                        : <button type="button" className={look} onClick={() => follow(item)}>{body}</button>}
                    </li>
                  );
                })}
              </ul>
            )}
        </section>
      </>}
    </div>
  );
}
