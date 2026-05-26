const {
  registerOauth2AuthorizationRequest,
  handleOauth2ProtocolUrl,
  isOauth2AuthorizationRequestInProgress
} = require('../../src/utils/oauth2-protocol-handler');

// handleOauth2ProtocolUrl is the entry point for callback URLs delivered via the bruno://
// protocol. It used to know only two shapes (code-in-query or implicit-tokens-in-fragment)
// which broke OIDC Hybrid Flow: the OP returns ?code=… for code flow but #code=…&id_token=…
// for Hybrid with response_mode=fragment, and the code-in-fragment case was never matched.
// The resolved payload is now a single structured object the caller reshapes per grantType.

describe('handleOauth2ProtocolUrl', () => {
  let pendingResolve;
  let pendingReject;
  let resolvedValue;
  let rejectedError;

  beforeEach(() => {
    resolvedValue = undefined;
    rejectedError = undefined;
    pendingResolve = jest.fn((v) => { resolvedValue = v; });
    pendingReject = jest.fn((e) => { rejectedError = e; });
    registerOauth2AuthorizationRequest(pendingResolve, pendingReject, null);
  });

  test('resolves with code when callback has ?code= (authorization_code in query)', () => {
    handleOauth2ProtocolUrl('bruno://callback?code=AUTHCODE&state=xyz');
    expect(pendingResolve).toHaveBeenCalledTimes(1);
    expect(resolvedValue.code).toBe('AUTHCODE');
    expect(resolvedValue.state).toBe('xyz');
    expect(resolvedValue.id_token).toBeNull();
    expect(resolvedValue.access_token).toBeNull();
  });

  test('resolves with access_token + scope when callback has #access_token= (implicit)', () => {
    handleOauth2ProtocolUrl('bruno://callback#access_token=ATOK&token_type=Bearer&expires_in=3600&state=xyz&scope=openid');
    expect(pendingResolve).toHaveBeenCalledTimes(1);
    expect(resolvedValue.access_token).toBe('ATOK');
    expect(resolvedValue.token_type).toBe('Bearer');
    expect(resolvedValue.expires_in).toBe('3600');
    expect(resolvedValue.state).toBe('xyz');
    expect(resolvedValue.scope).toBe('openid');
    expect(resolvedValue.code).toBeNull();
  });

  test('resolves with code + id_token when callback has #code=&id_token= (OIDC Hybrid Flow, response_mode=fragment)', () => {
    // OIDC Core §3.3.2.5 — Hybrid response_type=code id_token with the OIDC default fragment.
    handleOauth2ProtocolUrl('bruno://callback#code=HYBRIDCODE&id_token=eyJ.eyJ.sig&state=xyz');
    expect(pendingResolve).toHaveBeenCalledTimes(1);
    expect(resolvedValue.code).toBe('HYBRIDCODE');
    expect(resolvedValue.id_token).toBe('eyJ.eyJ.sig');
    expect(resolvedValue.state).toBe('xyz');
    expect(resolvedValue.access_token).toBeNull();
  });

  test('resolves with code + id_token + access_token when callback has all three in fragment (Hybrid with token)', () => {
    handleOauth2ProtocolUrl('bruno://callback#code=HC&id_token=eyJ.eyJ.sig&access_token=AT&token_type=Bearer&expires_in=600&state=xyz');
    expect(pendingResolve).toHaveBeenCalledTimes(1);
    expect(resolvedValue.code).toBe('HC');
    expect(resolvedValue.id_token).toBe('eyJ.eyJ.sig');
    expect(resolvedValue.access_token).toBe('AT');
    expect(resolvedValue.token_type).toBe('Bearer');
    expect(resolvedValue.expires_in).toBe('600');
    expect(resolvedValue.state).toBe('xyz');
  });

  test('rejects with error data when OP returns ?error= in query', () => {
    handleOauth2ProtocolUrl('bruno://callback?error=access_denied&error_description=user_cancelled');
    expect(pendingReject).toHaveBeenCalledTimes(1);
    const data = JSON.parse(rejectedError.message);
    expect(data.error).toBe('access_denied');
    expect(data.errorDescription).toBe('user_cancelled');
  });

  test('rejects with error data when OP returns #error= in fragment', () => {
    handleOauth2ProtocolUrl('bruno://callback#error=invalid_request&error_description=bad_scope');
    expect(pendingReject).toHaveBeenCalledTimes(1);
    const data = JSON.parse(rejectedError.message);
    expect(data.error).toBe('invalid_request');
    expect(data.errorDescription).toBe('bad_scope');
  });

  test('rejects when neither code nor access_token is present', () => {
    handleOauth2ProtocolUrl('bruno://callback?state=onlystate');
    expect(pendingReject).toHaveBeenCalledTimes(1);
    expect(rejectedError.message).toMatch(/missing code or access_token/);
  });

  test('consumes the pending request on resolve', () => {
    expect(isOauth2AuthorizationRequestInProgress()).toBe(true);
    handleOauth2ProtocolUrl('bruno://callback?code=ABC');
    expect(isOauth2AuthorizationRequestInProgress()).toBe(false);
  });
});
