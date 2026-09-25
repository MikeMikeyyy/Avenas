import { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { UNIT_KEY } from "../utils/units";
import { pushUnit } from "../lib/cloud";

interface UnitContextValue {
  isKg: boolean;
  setIsKg: (val: boolean) => void;
}

const UnitContext = createContext<UnitContextValue>({
  isKg: true,
  setIsKg: () => {},
});

export function UnitProvider({ children }: { children: React.ReactNode }) {
  const [isKg, setIsKgState] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(UNIT_KEY).then(saved => {
      if (saved !== null) setIsKgState(saved === "kg");
    }).catch(() => {});
  }, []);

  const setIsKg = useCallback((val: boolean) => {
    setIsKgState(val);
    AsyncStorage.setItem(UNIT_KEY, val ? "kg" : "lbs").catch(() => {});
    // A trainer reads this to show this person's numbers in their unit.
    void pushUnit(val ? "kg" : "lb");
  }, []);

  const value = useMemo(() => ({ isKg, setIsKg }), [isKg, setIsKg]);

  return <UnitContext.Provider value={value}>{children}</UnitContext.Provider>;
}

/**
 * Show everything below in a fixed unit, whatever this person has chosen. The
 * trainer's client page and the screens opened from it wrap their content in
 * the CLIENT's unit, so the client's logged sets, PRs and charts read exactly as
 * they do on the client's own phone. Every weight on those screens already goes
 * through useUnit(), so nothing inside has to know.
 *
 * `isKg` undefined passes the real preference through, so a screen that is
 * sometimes a client's view and sometimes your own can always render the lens
 * and keep the same tree. Nothing under a lens can change the preference.
 */
export function UnitLens({ isKg, children }: { isKg: boolean | undefined; children: React.ReactNode }) {
  const parent = useContext(UnitContext);
  const value = useMemo(
    () => (isKg === undefined ? parent : { isKg, setIsKg: () => {} }),
    [isKg, parent],
  );
  return <UnitContext.Provider value={value}>{children}</UnitContext.Provider>;
}

export function useUnit() {
  return useContext(UnitContext);
}
