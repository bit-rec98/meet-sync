import type { ErrorRequestHandler, RequestHandler } from 'express';
import { DomainError } from '../errors.js';
import { HttpError, sendError, statusForDomainError } from './errorResponse.js';
import type { Logger } from './logger.js';

/** Errors raised by body-parser (invalid JSON, body too large, unsupported charset...). */
function bodyParserErrorType(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'type' in error) {
    return typeof error.type === 'string' ? error.type : undefined;
  }
  return undefined;
}

export const handleNotFound: RequestHandler = (_req, res) => {
  sendError(res, 404, 'not_found');
};

export function createErrorHandler(log: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof HttpError) {
      sendError(res, error.status, error.code, error.details);
      return;
    }
    if (error instanceof DomainError) {
      sendError(res, statusForDomainError(error.code), error.code);
      return;
    }

    switch (bodyParserErrorType(error)) {
      case 'entity.too.large':
        sendError(res, 413, 'payload_too_large');
        return;
      case 'charset.unsupported':
      case 'encoding.unsupported':
        sendError(res, 415, 'unsupported_media_type');
        return;
      case 'entity.parse.failed':
      case 'entity.verify.failed':
      case 'request.size.invalid':
      case 'request.aborted':
        sendError(res, 400, 'validation_error');
        return;
      default:
        break;
    }

    // Unexpected failure. Log only the kind of error and its code: messages can contain data
    // (for example a duplicated value), and the client gets nothing beyond a generic message.
    log({
      event: 'unhandled_error',
      requestId: res.locals['requestId'],
      errorName: error instanceof Error ? error.name : 'unknown',
      errorCode:
        typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined,
    });
    sendError(res, 500, 'internal_error');
  };
}
