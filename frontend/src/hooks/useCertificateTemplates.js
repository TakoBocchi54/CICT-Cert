import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export const useCertificateTemplates = () => useQuery({
  queryKey: ['certificate-templates'], queryFn: () => api('/api/faculty/certificate-templates'), retry: false,
});
