import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useFacultyMe() {
  return useQuery({
    queryKey: ["faculty-me"],
    queryFn: () => api("/api/auth/faculty/me"),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
