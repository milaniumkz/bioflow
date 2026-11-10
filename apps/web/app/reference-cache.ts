import type { QueryClient } from "@tanstack/react-query";

export function refreshReferenceChoices(client: QueryClient) {
  return Promise.all(
    ["workflow-refs", "ledgerReferences", "owner-dashboard"].map((key) =>
      client.invalidateQueries({ queryKey: [key] }),
    ),
  );
}
