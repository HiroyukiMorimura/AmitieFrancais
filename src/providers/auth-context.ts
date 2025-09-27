import { createContext } from "react";

export type AuthUser = { id: string; email: string; name?: string };

export type AuthCtx = {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

export const AuthContext = createContext<AuthCtx | null>(null);
