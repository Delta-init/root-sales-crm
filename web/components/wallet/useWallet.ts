import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/axios";
import type { Wallet } from "@/lib/wallet";

/*
 * My Wallet (2026-11-04): your month from the HRMS — salary a day at a time, what came off and why, commission, what
 * finance has paid. The server asks the HRMS as whoever is signed in; never somebody else's.
 */
export const useWallet = (month: string) =>
  useQuery({
    queryKey: ["wallet", month],
    queryFn: async () => (await api.get("/wallet", { params: { month } })).data.data as Wallet,
    // Finance is asked behind it on every load; a minute keeps flicking between months cheap.
    staleTime: 60_000,
    retry: false,
  });
