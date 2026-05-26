const { shell } = require('electron');
const { registerOauth2AuthorizationRequest, rejectOauth2AuthorizationRequest } = require('../../utils/oauth2-protocol-handler');

const authorizeUserInSystemBrowser = ({ authorizeUrl, callbackUrl, grantType = 'authorization_code' }) => {
  return new Promise((resolve, reject) => {
    // Replace callback URL in authorization URL
    const authorizationUrlObj = new URL(authorizeUrl);
    authorizationUrlObj.searchParams.set('redirect_uri', callbackUrl);
    const modifiedAuthorizeUrl = authorizationUrlObj.toString();

    // Set timeout for the request (5 minutes)
    const timeout = setTimeout(() => {
      rejectOauth2AuthorizationRequest(new Error('Authorization timeout'));
    }, 5 * 60 * 1000);

    // Wrap resolve/reject to clear timeout and add debugInfo
    const debugInfo = {
      data: []
    };

    const authorizationRequest = {
      request: {
        url: modifiedAuthorizeUrl,
        method: 'GET',
        headers: {},
        error: null
      },
      response: {
        headers: {},
        status: null,
        statusText: null,
        error: null
      },
      fromCache: false,
      completed: false
    };

    debugInfo.data.push(authorizationRequest);

    // Reshape the structured payload from the protocol handler into the result shape the
    // OAuth2 token-fetcher expects per grantType. Mirrors authorize-user-in-window.js so the
    // two browser paths produce identical downstream shapes.
    const wrappedResolve = (payload) => {
      clearTimeout(timeout);
      if (grantType === 'implicit') {
        const implicitTokens = {
          access_token: payload.access_token,
          token_type: payload.token_type,
          expires_in: payload.expires_in,
          state: payload.state,
          scope: payload.scope
        };
        resolve({ implicitTokens, debugInfo });
      } else if (grantType === 'openid_hybrid') {
        const hybridTokens = {
          id_token: payload.id_token,
          access_token: payload.access_token,
          token_type: payload.token_type,
          expires_in: payload.expires_in,
          state: payload.state
        };
        resolve({ authorizationCode: payload.code, hybridTokens, debugInfo });
      } else {
        // authorization_code, openid_code, and any future code-flow variant
        resolve({ authorizationCode: payload.code, debugInfo });
      }
    };

    const wrappedReject = (error) => {
      clearTimeout(timeout);
      reject(error);
    };

    registerOauth2AuthorizationRequest(wrappedResolve, wrappedReject, debugInfo);

    // Open system browser
    shell.openExternal(modifiedAuthorizeUrl).catch((error) => {
      rejectOauth2AuthorizationRequest(error);
    });
  });
};

module.exports = { authorizeUserInSystemBrowser };
