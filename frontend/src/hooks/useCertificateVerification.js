import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useCertificateVerification(certHash) {
    return useQuery({
        queryKey: ["CertificateVerification", certHash],
        queryFn: ({ signal }) =>
            api(
                `/api/certificates/verify/${encodeURIComponent(certHash)}`,
                { signal }
            ),
            enabled: Boolean(certHash),
            retry: false,     
            refetchOnWindowFocus: false,
    });
}