let oauth2AuthorizationRequest = null;

const registerOauth2AuthorizationRequest = (resolve, reject, debugInfo = null) => {
  // Cancel any existing pending request
  if (oauth2AuthorizationRequest) {
    oauth2AuthorizationRequest.reject(new Error('Authorization cancelled: new request started'));
  }

  oauth2AuthorizationRequest = {
    resolve,
    reject,
    debugInfo,
    timestamp: Date.now()
  };
};

const isOauth2AuthorizationRequestInProgress = () => {
  return oauth2AuthorizationRequest !== null;
};

const resolveOauth2AuthorizationRequest = (data) => {
  if (oauth2AuthorizationRequest) {
    oauth2AuthorizationRequest.resolve(data);
    oauth2AuthorizationRequest = null;
    return true;
  }
  return false;
};

const rejectOauth2AuthorizationRequest = (error) => {
  if (oauth2AuthorizationRequest) {
    oauth2AuthorizationRequest.reject(error);
    oauth2AuthorizationRequest = null;
    return true;
  }
  return false;
};

const cancelOAuth2AuthorizationRequest = () => {
  return rejectOauth2AuthorizationRequest(new Error('Authorization cancelled by user'));
};

// Parses the OAuth2/OIDC callback URL Bruno received via the bruno:// protocol and resolves
// a structured payload containing every field the response could carry, regardless of grant
// type. The caller (authorize-user-in-system-browser.js) reshapes this per grantType — same
// shape contract as the in-window flow in authorize-user-in-window.js, so the two browser
// paths behave identically.
//
// Supported response_modes:
//   query   — OAuth 2.0 authorization_code default; `code` lives in ?code=…
//   fragment — OIDC Hybrid default for response_type=code id_token; `code` and `id_token`
//              both live in the fragment alongside any access_token / state
//   form_post — NOT supported (Bruno's protocol handler is GET-only)
const handleOauth2ProtocolUrl = (url) => {
  try {
    const urlObj = new URL(url);

    // Add callback URL details to debugInfo if available
    if (oauth2AuthorizationRequest?.debugInfo) {
      const callbackRequest = {
        request: {
          url: url,
          method: '',
          headers: {},
          error: null
        },
        response: {
          url: url,
          headers: {},
          status: '',
          statusText: 'BRUNO_OAUTH2_PROTOCOL',
          error: null
        },
        fromCache: false,
        completed: true
      };
      oauth2AuthorizationRequest.debugInfo.data.push(callbackRequest);
    }

    const hashParams = urlObj.hash ? new URLSearchParams(urlObj.hash.substring(1)) : new URLSearchParams();
    const fromEither = (name) => urlObj.searchParams.get(name) ?? hashParams.get(name);

    // RFC 6749 §4.1.2.1 / OIDC Core §3.1.2.6: errors may arrive in either query (code flow)
    // or fragment (implicit / hybrid).
    const error = fromEither('error');
    if (error) {
      const errorData = {
        message: 'Authorization Failed!',
        error,
        errorDescription: fromEither('error_description')
      };
      rejectOauth2AuthorizationRequest(new Error(JSON.stringify(errorData)));
      return;
    }

    const payload = {
      code: fromEither('code'),
      id_token: hashParams.get('id_token'),
      access_token: hashParams.get('access_token'),
      token_type: hashParams.get('token_type'),
      expires_in: hashParams.get('expires_in'),
      state: fromEither('state'),
      scope: hashParams.get('scope')
    };

    if (payload.code || payload.access_token) {
      resolveOauth2AuthorizationRequest(payload);
      return;
    }

    rejectOauth2AuthorizationRequest(new Error('Invalid OAuth2 callback: missing code or access_token'));
  } catch (err) {
    console.error('Error handling protocol URL:', err);
    rejectOauth2AuthorizationRequest(err);
  }
};

module.exports = {
  registerOauth2AuthorizationRequest,
  rejectOauth2AuthorizationRequest,
  cancelOAuth2AuthorizationRequest,
  isOauth2AuthorizationRequestInProgress,
  handleOauth2ProtocolUrl
};
