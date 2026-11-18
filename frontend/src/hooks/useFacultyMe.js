import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useFacultyMe({ enabled = true } = {}) {
  return useQuery({
    queryKey: ["faculty-me"],
    queryFn: () => api("/api/auth/faculty/me"),
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
