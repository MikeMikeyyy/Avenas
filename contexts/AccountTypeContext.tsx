import { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const ACCOUNT_TYPE_KEY = "@avenas/account_type";

export type AccountType = "gym_user" | "pt";

interface AccountTypeContextValue {
  accountType: AccountType;
  setAccountType: (t: AccountType) => void;
  loaded: boolean;
}

const AccountTypeContext = createContext<AccountTypeContextValue>({
  accountType: "gym_user",
  setAccountType: () => {},
  loaded: false,
});

export function AccountTypeProvider({ children }: { children: React.ReactNode }) {
  const [accountType, setAccountTypeState] = useState<AccountType>("gym_user");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(ACCOUNT_TYPE_KEY);
        if (saved === "pt" || saved === "gym_user") setAccountTypeState(saved);
      } catch {}
      setLoaded(true);
    })();
  }, []);

  const setAccountType = useCallback((t: AccountType) => {
    setAccountTypeState(t);
    AsyncStorage.setItem(ACCOUNT_TYPE_KEY, t).catch(() => {});
  }, []);

  const value = useMemo(() => ({ accountType, setAccountType, loaded }), [accountType, setAccountType, loaded]);

  return <AccountTypeContext.Provider value={value}>{children}</AccountTypeContext.Provider>;
}

export function useAccountType() {
  return useContext(AccountTypeContext);
}
