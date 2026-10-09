export const Btn = ({ children, variant = 'primary', className = '', icon, iconRight, size, ...rest }) => (
  <button className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className}`} {...rest}>
    {icon && <i className={'ph-bold ' + icon}></i>}
    {children}
    {iconRight && <i className={'ph-bold arrow ' + iconRight}></i>}
  </button>
);
