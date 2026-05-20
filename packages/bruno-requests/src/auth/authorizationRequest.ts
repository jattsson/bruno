// OAuth 2.0 / OpenID Connect authorization request builder.
//
// Combines:
//   - The standard OAuth 2.0 authorization-endpoint parameters (RFC 6749 §4.1.1)
//   - OpenID Connect parameters (OIDC Core 1.0 §3.1.2.1)
//   - JWT-Secured Authorization Request — JAR (RFC 9101)
//   - Pushed Authorization Request — PAR (RFC 9126)
//
// JAR (signed Request Object): when `useRequestObject` is true, the authorization parameters are
// packed into a JWT, signed using the same key material the client uses for `client_secret_jwt` /
// `private_key_jwt` at the token endpoint, and either appended to the authorization URL as the
// `request` parameter (by-value) or POSTed to the OP's `pushed_authorization_request_endpoint` to
// obtain a `request_uri` (by-reference). The protected header carries `typ: oauth-authz-req+jwt`
// per RFC 9101 §10.8.

import crypto from 'node:crypto';
import qs from 'qs';
import axios, { AxiosInstance } from 'axios';

import {
  signJwt,
  resolveJwtSigningKey,
  applyTokenEndpointAuth,
  parseClaimValue,
  type TokenEndpointAuthMethod,
  type TokenEndpointAuthSigningAlg,
  type TokenEndpointAuthOptions
} from './tokenEndpointAuth';

export interface AuthorizationRequestAdditionalParam {
  name?: string;
  value?: string;
  enabled?: boolean;
  sendIn?: 'queryparams' | 'headers' | 'body';
}

export interface AuthorizationRequestAdditionalClaim {
  name?: string;
  value?: string;
  enabled?: boolean;
}

export interface AuthorizationRequestOptions {
  // Standard authorization-endpoint params
  clientId: string;
  redirectUri: string;
  scope?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256';
  responseType?: string; // defaults to 'code'
  responseMode?: string; // 'query' | 'fragment' (form_post is unsupported by Bruno's callback handler)

  // OIDC params (OIDC Core 1.0 §3.1.2.1)
  nonce?: string; // auto-generated if empty
  prompt?: string;
  loginHint?: string;
  maxAge?: number;
  acrValues?: string;

  // User's additional authorization-request rows (existing OAuth2 feature; only `queryparams` rows
  // are honoured at the authorization endpoint).
  additionalAuthorizationParams?: AuthorizationRequestAdditionalParam[];

  // JAR — RFC 9101
  useRequestObject?: boolean;
  requestObjectSigningAlg?: TokenEndpointAuthSigningAlg;
  // JWT `typ` header for the Request Object. Defaults to `oauth-authz-req+jwt` (RFC 9101 §10.8);
  // can be overridden to `JWT` for pre-RFC-9101 OPs (e.g. Keycloak in some configurations).
  requestObjectTyp?: string;
  requestObjectAdditionalClaims?: AuthorizationRequestAdditionalClaim[];

  // Token-endpoint client-auth signing material — used as a fallback when no dedicated JAR key is
  // configured (the common case: one key for both purposes in private_key_jwt deployments).
  clientSecret?: string;
  privateKey?: string;
  privateKeyType?: 'text' | 'file' | '';
  privateKeyFormat?: 'pem' | 'jwk' | '';
  keyId?: string;
  // Dedicated JAR signing material. When set, these win over the client-auth fields. Required when
  // the client uses a non-JWT client-auth method (mTLS, client_secret_basic/post) but still wants
  // to sign authorization requests.
  requestObjectPrivateKey?: string;
  requestObjectPrivateKeyType?: 'text' | 'file' | '';
  requestObjectPrivateKeyFormat?: 'pem' | 'jwk' | '';
  requestObjectKeyId?: string;
  collectionPath?: string;

  // `aud` of the Request Object (OIDC OP issuer). Falls back to `accessTokenUrl`.
  issuer?: string;
  accessTokenUrl?: string;
}

export interface AuthorizationRequestResult {
  params: Record<string, string>; // flat form-encoded params — for the authorization URL or PAR body
  signedRequest?: string; // the JWT when useRequestObject; undefined otherwise
  effectiveNonce: string; // the nonce ultimately used (user-supplied or auto-generated)
}

const generateNonce = (): string => {
  // 32 random bytes, base64url-encoded — strong enough for replay protection.
  return crypto.randomBytes(32).toString('base64url');
};

/**
 * Builds the flat authorization-request params object and (when JAR is enabled) the signed
 * Request Object JWT. The caller appends `params` to the authorization URL — or POSTs them to the
 * PAR endpoint via `pushAuthorizationRequest`.
 */
export const buildAuthorizationRequest = async (
  opts: AuthorizationRequestOptions
): Promise<AuthorizationRequestResult> => {
  const responseType = opts.responseType || 'code';
  const effectiveNonce = opts.nonce && opts.nonce.trim() !== '' ? opts.nonce : generateNonce();

  // 1. Assemble the standard params object.
  const params: Record<string, string> = {
    response_type: responseType,
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri
  };
  if (opts.scope) params.scope = opts.scope;
  if (opts.state) params.state = opts.state;
  if (opts.codeChallenge) {
    params.code_challenge = opts.codeChallenge;
    params.code_challenge_method = opts.codeChallengeMethod || 'S256';
  }
  if (opts.responseMode) params.response_mode = opts.responseMode;

  // 2. OIDC params (OIDC Core 1.0 §3.1.2.1). `nonce` is REQUIRED for OIDC implicit/hybrid flows
  // (response_type contains id_token); we always emit it for OIDC.
  params.nonce = effectiveNonce;
  if (opts.prompt) params.prompt = opts.prompt;
  if (opts.loginHint) params.login_hint = opts.loginHint;
  if (typeof opts.maxAge === 'number') params.max_age = String(opts.maxAge);
  if (opts.acrValues) params.acr_values = opts.acrValues;

  // 3. User-defined additional authorization params (only `queryparams` rows).
  for (const p of opts.additionalAuthorizationParams || []) {
    if (p?.enabled && p?.name && (p?.sendIn === 'queryparams' || !p?.sendIn)) {
      params[p.name] = p.value ?? '';
    }
  }

  // 4. JAR — sign the params into a JWT.
  if (opts.useRequestObject) {
    const algorithm = (opts.requestObjectSigningAlg || 'RS256') as TokenEndpointAuthSigningAlg;
    // Prefer the dedicated JAR signing material; fall back to the client-auth key when no
    // dedicated key is configured (so private_key_jwt clients that share one key for both
    // purposes keep working with zero extra config).
    const hasDedicatedKey
      = (opts.requestObjectPrivateKey && opts.requestObjectPrivateKey.trim() !== '')
        || algorithm.startsWith('HS'); // HS algs always use clientSecret; "dedicated" doesn't apply
    const { signingKey, effectiveKeyId } = await resolveJwtSigningKey(
      {
        clientSecret: opts.clientSecret,
        privateKey: hasDedicatedKey ? opts.requestObjectPrivateKey : opts.privateKey,
        privateKeyType: hasDedicatedKey ? opts.requestObjectPrivateKeyType : opts.privateKeyType,
        privateKeyFormat: hasDedicatedKey ? opts.requestObjectPrivateKeyFormat : opts.privateKeyFormat,
        keyId: hasDedicatedKey ? opts.requestObjectKeyId : opts.keyId,
        collectionPath: opts.collectionPath
      },
      algorithm
    );

    const now = Math.floor(Date.now() / 1000);
    const audience = opts.issuer && opts.issuer.trim() !== ''
      ? opts.issuer
      : opts.accessTokenUrl ?? '';

    // RFC 9101 §4 — the JWT claims mirror the authorization parameters, plus iss / aud / iat / exp / jti.
    const claims: Record<string, unknown> = {
      ...params,
      iss: opts.clientId,
      aud: audience,
      iat: now,
      exp: now + 300,
      jti: crypto.randomUUID()
    };

    // User-defined additional claims override above (same semantics as token-endpoint additionalClaims).
    // Values that look like JSON objects/arrays are auto-parsed so callers can carry nested
    // structures — e.g. OIDC Core 1.0 §5.5 `claims` request parameter.
    for (const claim of opts.requestObjectAdditionalClaims || []) {
      if (claim?.enabled && claim?.name) {
        claims[claim.name] = parseClaimValue(claim.value);
      }
    }

    const signedRequest = await signJwt(
      {
        algorithm,
        protectedHeaderType: opts.requestObjectTyp && opts.requestObjectTyp.trim() !== ''
          ? opts.requestObjectTyp
          : 'oauth-authz-req+jwt',
        keyId: effectiveKeyId,
        claims
      },
      signingKey
    );

    return { params, signedRequest, effectiveNonce };
  }

  return { params, effectiveNonce };
};

/**
 * Pushes the authorization request to the OP's PAR endpoint (RFC 9126). When `signedRequest` is
 * provided, the body is `{ client_id, request: <JWT> }`; otherwise it's the flat `params` from
 * `buildAuthorizationRequest`. Client authentication on the PAR call reuses `applyTokenEndpointAuth`.
 *
 * Returns the `request_uri` to use in the final authorization URL.
 */
export interface PushAuthorizationRequestOptions {
  parEndpoint: string;
  clientId: string;
  params: Record<string, string>;
  signedRequest?: string;
  clientAuth: TokenEndpointAuthOptions;
  axiosInstance?: AxiosInstance;
}

export const pushAuthorizationRequest = async (
  opts: PushAuthorizationRequestOptions
): Promise<{ request_uri: string; expires_in: number }> => {
  const requestBody: Record<string, string> = opts.signedRequest
    ? { client_id: opts.clientId, request: opts.signedRequest }
    : { ...opts.params };

  // Client authentication on the PAR request itself.
  const clientAuth = await applyTokenEndpointAuth(opts.clientAuth);
  Object.assign(requestBody, clientAuth.bodyParams);

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
    ...clientAuth.headers
  };

  const http = opts.axiosInstance || axios;
  const response = await http({
    method: 'POST',
    url: opts.parEndpoint,
    headers,
    data: qs.stringify(requestBody),
    responseType: 'json'
  });

  const data = response.data as { request_uri?: string; expires_in?: number };
  if (!data?.request_uri) {
    throw new Error('PAR endpoint did not return a request_uri');
  }
  return { request_uri: data.request_uri, expires_in: data.expires_in ?? 60 };
};
