export const Mark = ({ size = 36, light = false }) => (
  <svg style={{ width: size, height: size, flexShrink: 0 }} viewBox="0 0 40 40" fill="none">
    <rect width="40" height="40" rx="11" fill={light ? '#fff' : '#0e3b2c'} />
    <circle cx="20" cy="20" r="12.5" stroke={light ? '#0e3b2c' : '#fff'} strokeOpacity=".5" strokeWidth="1" strokeDasharray="1.6 2.2" />
    <circle cx="20" cy="20" r="9" stroke={light ? '#0e3b2c' : '#fff'} strokeWidth="1.2" />
    <path d="M15.5 20.4l3.2 3.2 6-6.6" stroke={light ? '#0e3b2c' : '#fff'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
