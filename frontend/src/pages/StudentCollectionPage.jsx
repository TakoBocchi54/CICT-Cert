import { useState } from 'react';
import { Certificate, Pill, Seal, Btn } from '../components/design-system';

export default function StudentCollectionPage({ certificates = [], onCertificateClick, onDownloadClick }) {
  const [filter, setFilter] = useState('All');
  
  const sortedCerts = [...certificates].sort((a, b) => b.iso.localeCompare(a.iso));
  const filteredList = filter === 'All' ? sortedCerts : sortedCerts.filter(c => c.status === filter);

  // Empty state
  if (!certificates.length) {
    return (
      <div>
        <div className="mb-10">
          <h1 className="font-serif text-5xl md:text-6xl font-medium leading-[1.02]">
            Your collection
          </h1>
          <p className="text-ink-soft text-lg mt-4 max-w-xl">
            Your verified seminar certificates will appear here.
          </p>
        </div>
        
        <div className="max-w-2xl mx-auto text-center py-20 sheet p-12">
          <div className="flex justify-center mb-6">
            <Seal status="Verified" size={92} />
          </div>
          <h2 className="font-serif text-3xl font-medium">No credentials yet</h2>
          <p className="text-ink-soft mt-3">
            Attend CICT seminars to start earning blockchain-verified certificates.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Page Header */}
      <div className="mb-10">
        <h1 className="font-serif text-5xl md:text-6xl font-medium leading-[1.02]">
          Your collection
        </h1>
        <p className="text-ink-soft text-lg mt-4 max-w-xl">
          {certificates.length} {certificates.length === 1 ? 'credential' : 'credentials'}. Hover a certificate to see its on-chain status.
        </p>
      </div>

      {/* Filter Pills */}
      <div className="flex gap-2 mb-8">
        {['All', 'Verified', 'Revoked'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              'px-4 py-2 rounded-full text-sm font-semibold border transition-all ' +
              (filter === f
                ? 'bg-forest text-white border-forest'
                : 'bg-white border-[var(--line)] text-ink-soft hover:border-ink-muted')
            }
          >
            {f}
          </button>
        ))}
      </div>

      {/* Certificate Grid */}
      {filteredList.length === 0 ? (
        <div className="text-center py-20 sheet p-12">
          <h3 className="font-serif text-2xl font-medium text-ink-soft">
            No {filter.toLowerCase()} certificates
          </h3>
          <p className="text-ink-muted mt-2">Try a different filter.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-12">
          {filteredList.map(c => (
            <div key={c.id}>
              <div className="cursor-pointer" onClick={() => onCertificateClick(c)}>
                <Certificate cert={c} />
              </div>
              <div className="flex items-center justify-between gap-3 mt-3">
                <Btn variant="line" size="sm" icon="ph-download-simple" onClick={() => onDownloadClick(c)}>Download PDF</Btn>
                <Pill status={c.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
