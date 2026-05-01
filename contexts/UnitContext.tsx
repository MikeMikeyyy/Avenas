import { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const UNIT_KEY = "@avenas/unit";

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
  }, []);

  const value = useMemo(() => ({ isKg, setIsKg }), [isKg, setIsKg]);

  return <UnitContext.Provider value={value}>{children}</UnitContext.Provider>;
}

export function useUnit() {
  return useContext(UnitContext);
}
