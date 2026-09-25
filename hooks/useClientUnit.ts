// The unit a client logs in, for the screens a trainer opens from the client's
// page (a workout, an exercise's history, a program). Read from the copy of
// their training that page cached (loadCachedClientData), like everything else
// those screens show, so it never refetches.
//
// Returns isKg, or undefined when there's no client (your own data), before
// the read lands, or when the unit isn't known (a mock client, or a server
// without migration 0036). Callers fall back to their own unit on undefined
// and pass the value straight to <UnitLens>, which treats undefined the same.

import { useEffect, useState } from "react";
import { loadCachedClientData } from "../utils/trainerStore";

export function useClientUnit(clientId: string | undefined): boolean | undefined {
  const [isKg, setIsKg] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (!clientId) { setIsKg(undefined); return; }
    let cancelled = false;
    loadCachedClientData(clientId)
      .then(d => { if (!cancelled) setIsKg(d.unit ? d.unit === "kg" : undefined); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clientId]);
  return isKg;
}
