import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5100/api/v1";

export const api = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("accessToken");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─── Refresh handling ─────────────────────────────────────────────────────────
// A single in-flight refresh, with everything that 401'd meanwhile queued behind
// it. Without the queue, a dashboard that fires several requests at once would
// kick off several refreshes and race to overwrite each other's tokens.
let isRefreshing = false;
let queue: { resolve: (t: string) => void; reject: (e: unknown) => void }[] = [];

const flush = (error: unknown, token: string | null) => {
  queue.forEach(({ resolve, reject }) => (error || !token ? reject(error) : resolve(token)));
  queue = [];
};

const signOut = () => {
  localStorage.removeItem("accessToken");
  localStorage.removeItem("refreshToken");
  if (window.location.pathname !== "/login") window.location.href = "/login";
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status !== 401 || original?._retry) {
      return Promise.reject(error);
    }

    // A failed refresh returns 401 too. Retrying it would loop forever.
    if (original.url?.includes("/auth/refresh")) {
      signOut();
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        queue.push({
          resolve: (token) => {
            original.headers.Authorization = `Bearer ${token}`;
            resolve(api(original));
          },
          reject,
        });
      });
    }

    original._retry = true;
    isRefreshing = true;

    try {
      const refreshToken = localStorage.getItem("refreshToken");
      if (!refreshToken) throw error;

      const { data } = await axios.post(`${API_URL}/auth/refresh`, { refreshToken });
      const { accessToken, refreshToken: nextRefresh } = data.data;

      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", nextRefresh);

      flush(null, accessToken);
      original.headers.Authorization = `Bearer ${accessToken}`;
      return api(original);
    } catch (refreshError) {
      flush(refreshError, null);
      signOut();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

/** Pull a human-readable message out of the API's error envelope. */
export const apiErrorMessage = (error: unknown, fallback = "Something went wrong") => {
  if (error instanceof AxiosError) {
    return (error.response?.data as { message?: string } | undefined)?.message ?? fallback;
  }
  return fallback;
};
