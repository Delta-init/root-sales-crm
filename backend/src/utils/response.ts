import type { Response } from "express";
import type { ApiResponse } from "../types/index.js";

export const sendSuccess = <T>(
  res: Response,
  message: string,
  data?: T,
  statusCode = 200
): void => {
  const response: ApiResponse<T> = { success: true, message, data };
  res.status(statusCode).json(response);
};

export const sendError = (
  res: Response,
  message: string,
  statusCode = 500,
  errors?: unknown
): void => {
  const response: ApiResponse = { success: false, message, errors };
  res.status(statusCode).json(response);
};
