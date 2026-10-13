import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';

export const B2B_TOKEN_HEADER = 'x-b2b-token';

/**
 * The app's B2B Sales access token, from the `x-b2b-token` header —
 * `Authorization` carries the Vistaar partner token.
 *
 * The app signs agents in against B2B Sales and renews the token itself, so
 * there is no long-lived token this server could keep in its env. The token
 * is only passed on to B2B (the catalogue that prices the cart) — this server
 * does not verify it, and never logs it (the header is redacted).
 */
export const B2bToken = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const header = request.headers[B2B_TOKEN_HEADER];
    const token = typeof header === 'string' ? header.trim() : '';
    if (!token) {
      throw new UnauthorizedException(
        'Your session has ended. Please sign in again.',
      );
    }
    return token;
  },
);
