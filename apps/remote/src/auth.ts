/**
 * Authentication Module
 *
 * Handles Forge Invocation Token (FIT) verification and authentication.
 */

import type { NextFunction, Request, Response } from "express";
import {
  type ForgeInvocationTokenPayload,
  validateAuthHeader,
} from "forge-ahead";

/**
 * Extend Express Request to include FIT payload from auth middleware
 */
export interface AuthenticatedRequest extends Request {
  fitPayload?: ForgeInvocationTokenPayload;
}

/**
 * Middleware for authenticating requests using Forge Invocation Token (FIT)
 * Validates the Bearer token and attaches the parsed payload to the request
 */
export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    console.error("Auth failed: Missing or invalid authorization header", {
      hasAuthHeader: !!authHeader,
      method: req.method,
      path: req.path,
    });
    res.status(401).json({
      error: "Missing or invalid authorization header",
    });
    return;
  }

  const result = await validateAuthHeader(authHeader);
  if (result.isErr()) {
    const error = result.error;

    // Check if this is a TLS/network error (should be 502 Bad Gateway, not 401)
    const isTlsError =
      error.detail?.includes("TLS") ||
      error.detail?.includes("secure") ||
      error.detail?.includes("socket");

    const statusCode = isTlsError ? 502 : error.status;

    // Update error object to match the status code we're returning
    const responseError = isTlsError
      ? {
          ...error,
          status: 502,
          type: "https://httpstatuses.io/502",
          title: "Bad Gateway",
        }
      : error;

    console.error("Auth failed: FIT verification failed", {
      error: responseError,
      statusCode,
      method: req.method,
      path: req.path,
    });
    res.status(statusCode).json(responseError);
    return;
  }

  console.log("Auth succeeded", {
    method: req.method,
    path: req.path,
  });

  // Attach verified payload to request for downstream handlers
  // Cast to ForgeInvocationTokenPayload since the auth library returns JwtPayload
  req.fitPayload = result.value as unknown as ForgeInvocationTokenPayload;
  next();
}
