const STATUS_CONFIG = {
  Verified: { color: '#157347', icon: 'ph-seal-check' },
  Revoked: { color: '#b3261e', icon: 'ph-seal-warning' },
  Pending: { color: '#a96a0c', icon: 'ph-hourglass-medium' },
  Invalid: { color: '#4b5563', icon: 'ph-question' },
};

export const Pill = ({ status }) => (
  <span className={'pill pill-' + status}>
    <i className={'ph-fill ' + STATUS_CONFIG[status].icon}></i>
    {status === 'Invalid' ? 'Not found' : status}
  </span>
);
