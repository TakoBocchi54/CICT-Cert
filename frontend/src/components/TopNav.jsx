import { useState } from 'react';
import { Lockup, Btn } from './design-system';

export default function TopNav({ role, view, onNavigate, onSignOut, userName, userTitle }) {
  const [menu, setMenu] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);

  const items =
    role === 'faculty'
      ? [
          ['faculty-dashboard', 'Dashboard'],
          ['faculty-issue', 'Issuance'],
          ['faculty-revocation', 'Revocations'],
        ]
      : [
          ['student-dashboard', 'Portfolio'],
          ['student-certificates', 'Collection'],
        ];

  const userInitials = userName
    ? userName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : 'U';

  return (
    <div className="sticky top-0 z-30 px-4 pt-4">
      <header className="glass max-w-[1280px] mx-auto rounded-2xl h-16 flex items-center justify-between px-5">
        <button onClick={() => onNavigate(items[0][0])}>
          <Lockup small />
        </button>

        <nav className="hidden md:flex items-center gap-1">
          {items.map(([id, label]) => {
            const active = view === id || (view === 'certificate' && id.endsWith('certificates'));
            return (
              <button
                key={id}
                onClick={() => onNavigate(id)}
                className={
                  'px-4 py-2 rounded-xl text-sm font-semibold transition-all ' +
                  (active ? 'bg-forest text-white shadow' : 'text-ink-soft hover:bg-black/5')
                }
              >
                {label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onNavigate('verify')}
            className="hidden sm:flex btn btn-line btn-sm"
          >
            <i className="ph-bold ph-seal-check text-verified"></i>
            Public verifier
          </button>

          <div className="hidden lg:block text-right leading-tight">
            <div className="text-sm font-semibold">{userName || 'User'}</div>
            <div className="text-xs text-ink-muted">{userTitle || (role === 'faculty' ? 'Faculty' : 'Student')}</div>
          </div>

          <button
            onClick={() => setConfirmOut(true)}
            className="hidden lg:flex btn btn-ghost btn-sm"
            title="Sign out"
          >
            <i className="ph-bold ph-sign-out"></i>
            Sign out
          </button>

          <div className="relative">
            <button
              onClick={() => setMenu(m => !m)}
              aria-haspopup="menu"
              aria-expanded={menu}
              title="Account"
              className="w-10 h-10 rounded-xl bg-forest text-white font-semibold text-sm hover:bg-forest-700 transition-colors"
            >
              {userInitials}
            </button>

            {menu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenu(false)}></div>
                <div
                  role="menu"
                  className="pop absolute right-0 top-[52px] z-50 w-64 sheet p-2"
                  style={{ transformOrigin: 'top right' }}
                >
                  <div className="px-3 py-3">
                    <div className="font-semibold text-sm">{userName || 'User'}</div>
                    <div className="text-xs text-ink-muted">{userTitle || (role === 'faculty' ? 'Faculty' : 'Student')}</div>
                  </div>
                  <div className="md:hidden hair py-1">
                    {items.map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => {
                          setMenu(false);
                          onNavigate(id);
                        }}
                        className={
                          'w-full text-left px-3 py-2 rounded-lg text-sm font-medium hover:bg-paper-2 ' +
                          (view === id ? 'text-forest-600' : '')
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="hair py-1">
                    <button
                      onClick={() => {
                        setMenu(false);
                        onNavigate('verify');
                      }}
                      className="w-full flex items-center gap-2.5 text-left px-3 py-2 rounded-lg text-sm font-medium hover:bg-paper-2"
                    >
                      <i className="ph-bold ph-seal-check text-verified"></i>
                      Public verifier
                    </button>
                    <button
                      onClick={() => {
                        setMenu(false);
                        setConfirmOut(true);
                      }}
                      className="w-full flex items-center gap-2.5 text-left px-3 py-2 rounded-lg text-sm font-semibold text-revoked hover:bg-[#fbeae8]"
                    >
                      <i className="ph-bold ph-sign-out"></i>
                      Sign out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Sign Out Confirmation Modal */}
      {confirmOut && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(22,35,29,.45)', backdropFilter: 'blur(4px)' }}
          onClick={() => setConfirmOut(false)}
        >
          <div className="sheet pop w-full max-w-lg p-8 relative" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setConfirmOut(false)}
              className="absolute top-4 right-4 w-9 h-9 rounded-full hover:bg-paper-2 flex items-center justify-center text-ink-muted"
            >
              <i className="ph-bold ph-x"></i>
            </button>
            <div className="eyebrow mb-2">Account</div>
            <h3 className="font-serif text-3xl font-medium">Sign out of CICT-Cert?</h3>
            <p className="text-ink-soft text-sm mt-2 mb-7">
              You'll return to the sign-in page. Any issuance in progress will not be saved.
            </p>
            <div className="flex gap-3">
              <Btn variant="line" className="flex-1" onClick={() => setConfirmOut(false)}>
                Stay signed in
              </Btn>
              <Btn
                className="flex-1"
                icon="ph-sign-out"
                onClick={() => {
                  setConfirmOut(false);
                  onSignOut();
                }}
              >
                Sign out
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
