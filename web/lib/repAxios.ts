import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { API_URL } from "./axios";

/**
 * A separate client for the rep portal.
 *
 * Reps and admins have different tokens with different lifetimes and different
 * refresh endpoints, and they can be signed in in the same browser. Sharing one
 * axios instance and one localStorage key would let whichever signed in last
 * silently hijack the other's requests.
 */
export const repApi = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
});

export const REP_ACCESS = "repAccessToken";
export const REP_REFRESH = "repRefreshToken";

repApi.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem(REP_ACCESS);
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshing = false;
let queue: { resolve: (t: string) => void; reject: (e: unknown) => void }[] = [];

const flush = (error: unknown, token: string | null) => {
  queue.forEach(({ resolve, reject }) => (error || !token ? reject(error) : resolve(token)));
  queue = [];
};

const signOut = () => {
  localStorage.removeItem(REP_ACCESS);
  localStorage.removeItem(REP_REFRESH);
  if (!window.location.pathname.startsWith("/my/login")) window.location.href = "/my/login";
};

repApi.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status !== 401 || original?._retry) return Promise.reject(error);

    // A failed refresh also 401s; retrying it would loop.
    if (original.url?.includes("/rep/refresh")) {
      signOut();
      return Promise.reject(error);
    }

    if (refreshing) {
      return new Promise((resolve, reject) => {
        queue.push({
          resolve: (t) => {
            original.headers.Authorization = `Bearer ${t}`;
            resolve(repApi(original));
          },
          reject,
        });
      });
    }

    original._retry = true;
    refreshing = true;
    try {
      const refreshToken = localStorage.getItem(REP_REFRESH);
      if (!refreshToken) throw error;
      const { data } = await axios.post(`${API_URL}/rep/refresh`, { refreshToken });
      localStorage.setItem(REP_ACCESS, data.data.accessToken);
      localStorage.setItem(REP_REFRESH, data.data.refreshToken);
      flush(null, data.data.accessToken);
      original.headers.Authorization = `Bearer ${data.data.accessToken}`;
      return repApi(original);
    } catch (e) {
      flush(e, null);
      signOut();
      return Promise.reject(e);
    } finally {
      refreshing = false;
    }
  }
);
