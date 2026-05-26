import React, { useState } from 'react';
import path from 'path';
import { useDetectSensitiveField } from 'hooks/useDetectSensitiveField';
import get from 'lodash/get';
import toast from 'react-hot-toast';
import { useTheme } from 'providers/Theme';
import { useDispatch, useSelector } from 'react-redux';
import { IconCaretDown, IconSettings, IconKey, IconAdjustmentsHorizontal, IconSearch, IconFile, IconUpload, IconX } from '@tabler/icons';
import MenuDropdown from 'ui/MenuDropdown';
import SingleLineEditor from 'components/SingleLineEditor';
import StyledWrapper from './StyledWrapper';
import { inputsConfig } from './inputsConfig';
import Oauth2TokenViewer from '../Oauth2TokenViewer/index';
import Oauth2ActionButtons from '../Oauth2ActionButtons/index';
import AdditionalParams from '../AdditionalParams/index';
import ClientAuthMethod from '../ClientAuthMethod/index';
import RequestObjectClaims from '../RequestObjectClaims/index';
import Oauth2TokenSection from '../Oauth2TokenSection/index';
import Oauth2AdvancedSettings from '../Oauth2AdvancedSettings/index';
import Oauth2UseSystemBrowserToggle from '../Oauth2UseSystemBrowserToggle/index';
import SensitiveFieldWarning from 'components/SensitiveFieldWarning';
import { browseFiles, discoverOidc } from 'providers/ReduxStore/slices/collections/actions';

// Signing algorithms suitable for the JAR Request Object (RFC 9101). FAPI 1/2 require asymmetric
// algorithms; HMAC variants are also allowed for `client_secret_jwt`-style deployments.
const REQUEST_OBJECT_ALGS = [
  'RS256', 'RS384', 'RS512',
  'PS256', 'PS384', 'PS512',
  'ES256', 'ES384', 'ES512',
  'EdDSA',
  'HS256', 'HS384', 'HS512'
];

const PROMPT_OPTIONS = [
  { id: '', label: '(default)' },
  { id: 'none', label: 'none' },
  { id: 'login', label: 'login' },
  { id: 'consent', label: 'consent' },
  { id: 'select_account', label: 'select_account' }
];

const RESPONSE_TYPE_OPTIONS_HYBRID = [
  { id: 'code id_token', label: 'code id_token' },
  { id: 'code id_token token', label: 'code id_token token' }
];

const RESPONSE_MODE_OPTIONS = [
  { id: '', label: '(default)' },
  { id: 'query', label: 'query' },
  { id: 'fragment', label: 'fragment' }
];

// Mirrors cert-utils.js so the "no client certificate" warning agrees with the request runtime.
const hasClientCertForUrl = (brunoConfig, url) => {
  if (!url) return false;
  const certs = brunoConfig?.clientCertificates?.certs;
  if (!Array.isArray(certs) || certs.length === 0) return false;
  return certs.some((cert) => {
    const domain = cert?.domain;
    if (!domain) return false;
    const hostRegex = new RegExp(
      '^(https:\\/\\/|grpc:\\/\\/|grpcs:\\/\\/|ws:\\/\\/|wss:\\/\\/)?'
      + domain.replaceAll('.', '\\.').replaceAll('*', '.*')
    );
    return hostRegex.test(url);
  });
};

const OpenIDConnect = ({ save, item = {}, request, handleRun, updateAuth, collection, grantType }) => {
  const dispatch = useDispatch();
  const preferences = useSelector((state) => state.app.preferences);
  const { storedTheme } = useTheme();
  const useSystemBrowser = get(preferences, 'request.oauth2.useSystemBrowser', false);
  const { isSensitive } = useDetectSensitiveField(collection);
  const oAuth = get(request, 'auth.oauth2', {});
  const isHybrid = grantType === 'openid_hybrid';
  const [discoveryError, setDiscoveryError] = useState('');
  const [discovering, setDiscovering] = useState(false);

  const {
    callbackUrl,
    accessTokenUrl,
    credentialsId,
    issuer,
    nonce,
    prompt,
    loginHint,
    maxAge,
    acrValues,
    useRequestObject,
    requestObjectSigningAlg,
    usePAR,
    parEndpoint,
    responseType,
    responseMode
  } = oAuth;

  const requestObjectAlg = requestObjectSigningAlg || 'RS256';
  const usesHmacForRequestObject = requestObjectAlg.startsWith('HS');
  const requestObjectKeyFormat = oAuth.requestObjectPrivateKeyFormat || 'pem';
  const requestObjectKeyType = oAuth.requestObjectPrivateKeyType || 'text';
  const requestObjectPrivateKey = oAuth.requestObjectPrivateKey || '';
  const requestObjectKeySensitivity = isSensitive(requestObjectPrivateKey);
  const isRequestObjectFileBacked = requestObjectKeyType === 'file' && requestObjectPrivateKey;
  // For HS* algorithms, JAR signs with clientSecret (the user's existing token-endpoint secret).
  // For asymmetric algorithms, JAR uses the dedicated requestObjectPrivateKey if set, otherwise
  // falls back to the client-auth privateKey for parity with the original behaviour.
  const hasRequestObjectKey
    = (usesHmacForRequestObject && Boolean(oAuth?.clientSecret))
      || (!usesHmacForRequestObject && (Boolean(requestObjectPrivateKey) || Boolean(oAuth?.privateKey)));

  const handleSave = () => { save(); };

  const patchOAuth = (patch) => {
    dispatch(
      updateAuth({
        mode: 'oauth2',
        collectionUid: collection.uid,
        itemUid: item.uid,
        content: {
          ...oAuth,
          grantType,
          ...patch
        }
      })
    );
  };

  const handleChange = (key, value) => patchOAuth({ [key]: value });

  const handlePKCEToggle = () => handleChange('pkce', !Boolean(oAuth?.pkce));
  const handleUseRequestObjectToggle = () => handleChange('useRequestObject', !Boolean(useRequestObject));
  const handleUsePARToggle = () => handleChange('usePAR', !Boolean(usePAR));

  const handleBrowseRequestObjectKey = () => {
    const filters = requestObjectKeyFormat === 'jwk'
      ? [{ name: 'JWK', extensions: ['json', 'jwk'] }, { name: 'All Files', extensions: ['*'] }]
      : [{ name: 'PEM', extensions: ['pem', 'key'] }, { name: 'All Files', extensions: ['*'] }];
    dispatch(browseFiles(filters, []))
      .then((filePaths) => {
        if (filePaths && filePaths.length > 0) {
          patchOAuth({ requestObjectPrivateKey: filePaths[0], requestObjectPrivateKeyType: 'file' });
        }
      })
      .catch((err) => console.error(err));
  };

  const handleClearRequestObjectKey = () => patchOAuth({ requestObjectPrivateKey: '', requestObjectPrivateKeyType: 'text' });

  const handleDiscover = async () => {
    if (!issuer || issuer.trim() === '') {
      setDiscoveryError('Set the Issuer URL first');
      return;
    }
    setDiscoveryError('');
    setDiscovering(true);
    try {
      const metadata = await dispatch(discoverOidc(issuer, collection));
      // Populate the well-known endpoints + supported metadata into the auth state.
      patchOAuth({
        authorizationUrl: metadata.authorization_endpoint || oAuth.authorizationUrl || '',
        accessTokenUrl: metadata.token_endpoint || oAuth.accessTokenUrl || '',
        parEndpoint: metadata.pushed_authorization_request_endpoint || oAuth.parEndpoint || '',
        jwksUri: metadata.jwks_uri || oAuth.jwksUri || '',
        userinfoEndpoint: metadata.userinfo_endpoint || oAuth.userinfoEndpoint || '',
        endSessionEndpoint: metadata.end_session_endpoint || oAuth.endSessionEndpoint || ''
      });
      toast.success('OIDC discovery completed');
    } catch (err) {
      const message = typeof err === 'string' ? err : err?.message || 'OIDC discovery failed';
      setDiscoveryError(message);
      toast.error(message);
    } finally {
      setDiscovering(false);
    }
  };

  return (
    <StyledWrapper className="mt-2 flex w-full gap-4 flex-col">
      <Oauth2TokenViewer handleRun={handleRun} collection={collection} item={item} url={accessTokenUrl} credentialsId={credentialsId} />

      {/* Discovery */}
      <div className="flex items-center gap-2.5 mt-2">
        <div className="flex items-center px-2.5 py-1.5 oauth2-icon-container rounded-md">
          <IconSearch size={14} className="oauth2-icon" />
        </div>
        <span className="oauth2-section-label">Discovery</span>
      </div>
      <div className="flex items-start gap-4 w-full" key="input-issuer">
        <label className="block min-w-[140px] mt-1">Issuer URL</label>
        <div className="flex flex-1 flex-col gap-2">
          <div className="single-line-editor-wrapper flex-1 flex items-center">
            <SingleLineEditor
              value={issuer || ''}
              theme={storedTheme}
              onSave={handleSave}
              onChange={(val) => handleChange('issuer', val)}
              onRun={handleRun}
              collection={collection}
              item={item}
              isCompact
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-1 oauth2-icon cursor-pointer text-link"
              onClick={handleDiscover}
              disabled={discovering}
              type="button"
              title="Fetch /.well-known/openid-configuration"
            >
              <IconSearch size={14} />
              <span className="text-xs">{discovering ? 'Discovering…' : 'Discover endpoints'}</span>
            </button>
            {discoveryError && (
              <span className="text-xs oauth2-mtls-warning">{discoveryError}</span>
            )}
          </div>
        </div>
      </div>

      {/* Configuration (callback + standard OIDC params) */}
      <div className="flex items-center gap-2.5 mt-2">
        <div className="flex items-center px-2.5 py-1.5 oauth2-icon-container rounded-md">
          <IconSettings size={14} className="oauth2-icon" />
        </div>
        <span className="oauth2-section-label">Configuration</span>
      </div>
      <div className="flex items-center gap-4 w-full" key="input-callbackUrl">
        <label className="block min-w-[140px]">Callback URL</label>
        <div className="single-line-editor-wrapper flex-1 flex items-center">
          <SingleLineEditor
            value={callbackUrl}
            theme={storedTheme}
            onSave={handleSave}
            onChange={(val) => handleChange('callbackUrl', val)}
            onRun={handleRun}
            collection={collection}
            item={item}
            placeholder={useSystemBrowser ? 'https://oauth.usebruno.com/callback' : undefined}
            isCompact
          />
        </div>
      </div>
      <Oauth2UseSystemBrowserToggle />

      {inputsConfig.map((input) => {
        const { key, label, isSecret } = input;
        const value = oAuth[key] || '';
        const { showWarning, warningMessage } = isSensitive(value);
        return (
          <div className="flex items-center gap-4 w-full" key={`input-${key}`}>
            <label className="block min-w-[140px]">{label}</label>
            <div className="single-line-editor-wrapper flex-1 flex items-center">
              <SingleLineEditor
                value={value}
                theme={storedTheme}
                onSave={handleSave}
                onChange={(val) => handleChange(key, val)}
                onRun={handleRun}
                collection={collection}
                item={item}
                isSecret={isSecret}
                isCompact
              />
              {isSecret && showWarning && <SensitiveFieldWarning fieldName={key} warningMessage={warningMessage} />}
            </div>
          </div>
        );
      })}

      <ClientAuthMethod
        oAuth={oAuth}
        handleChange={handleChange}
        patchOAuth={patchOAuth}
        handleRun={handleRun}
        handleSave={handleSave}
        collection={collection}
        item={item}
      />

      {/* Hybrid-only response_type / response_mode */}
      {isHybrid && (
        <>
          <div className="flex items-center gap-4 w-full" key="input-response-type">
            <label className="block min-w-[140px]">Response Type</label>
            <div className="inline-flex items-center cursor-pointer token-placement-selector">
              <MenuDropdown
                items={RESPONSE_TYPE_OPTIONS_HYBRID.map((opt) => ({
                  id: opt.id, label: opt.label,
                  onClick: () => handleChange('responseType', opt.id)
                }))}
                selectedItemId={responseType || 'code id_token'}
                placement="bottom-end"
              >
                <div className="flex items-center justify-end token-placement-label select-none">
                  {responseType || 'code id_token'}
                  <IconCaretDown className="caret ml-1 mr-1" size={14} strokeWidth={2} />
                </div>
              </MenuDropdown>
            </div>
          </div>
          <div className="flex items-center gap-4 w-full" key="input-response-mode">
            <label className="block min-w-[140px]">Response Mode</label>
            <div className="inline-flex items-center cursor-pointer token-placement-selector">
              <MenuDropdown
                items={RESPONSE_MODE_OPTIONS.map((opt) => ({
                  id: opt.id, label: opt.label,
                  onClick: () => handleChange('responseMode', opt.id)
                }))}
                selectedItemId={responseMode || ''}
                placement="bottom-end"
              >
                <div className="flex items-center justify-end token-placement-label select-none">
                  {responseMode || '(default)'}
                  <IconCaretDown className="caret ml-1 mr-1" size={14} strokeWidth={2} />
                </div>
              </MenuDropdown>
            </div>
          </div>
        </>
      )}

      {/* PKCE */}
      <div className="flex flex-row w-full gap-4" key="pkce">
        <label className="block">Use PKCE</label>
        <input className="cursor-pointer" type="checkbox" checked={Boolean(oAuth?.pkce)} onChange={handlePKCEToggle} />
      </div>

      {/* OIDC Parameters */}
      <div className="flex items-center gap-2.5 mt-2">
        <div className="flex items-center px-2.5 py-1.5 oauth2-icon-container rounded-md">
          <IconAdjustmentsHorizontal size={14} className="oauth2-icon" />
        </div>
        <span className="oauth2-section-label">OpenID Connect Parameters</span>
      </div>
      <div className="flex items-center gap-4 w-full" key="input-nonce">
        <label className="block min-w-[140px]">Nonce</label>
        <div className="single-line-editor-wrapper flex-1">
          <SingleLineEditor
            value={nonce || ''}
            theme={storedTheme}
            onSave={handleSave}
            onChange={(val) => handleChange('nonce', val)}
            onRun={handleRun}
            collection={collection}
            item={item}
            placeholder="Auto-generated if empty"
            isCompact
          />
        </div>
      </div>
      <div className="flex items-center gap-4 w-full" key="input-prompt">
        <label className="block min-w-[140px]">Prompt</label>
        <div className="inline-flex items-center cursor-pointer token-placement-selector">
          <MenuDropdown
            items={PROMPT_OPTIONS.map((opt) => ({
              id: opt.id, label: opt.label,
              onClick: () => handleChange('prompt', opt.id)
            }))}
            selectedItemId={prompt || ''}
            placement="bottom-end"
          >
            <div className="flex items-center justify-end token-placement-label select-none">
              {prompt || '(default)'}
              <IconCaretDown className="caret ml-1 mr-1" size={14} strokeWidth={2} />
            </div>
          </MenuDropdown>
        </div>
      </div>
      <div className="flex items-center gap-4 w-full" key="input-login-hint">
        <label className="block min-w-[140px]">Login Hint</label>
        <div className="single-line-editor-wrapper flex-1">
          <SingleLineEditor
            value={loginHint || ''}
            theme={storedTheme}
            onSave={handleSave}
            onChange={(val) => handleChange('loginHint', val)}
            onRun={handleRun}
            collection={collection}
            item={item}
            isCompact
          />
        </div>
      </div>
      <div className="flex items-center gap-4 w-full" key="input-max-age">
        <label className="block min-w-[140px]">Max Age (s)</label>
        <div className="single-line-editor-wrapper flex-1">
          <SingleLineEditor
            value={maxAge != null ? String(maxAge) : ''}
            theme={storedTheme}
            onSave={handleSave}
            onChange={(val) => {
              const parsed = parseInt(val, 10);
              handleChange('maxAge', Number.isFinite(parsed) && parsed > 0 ? parsed : null);
            }}
            onRun={handleRun}
            collection={collection}
            item={item}
            isCompact
          />
        </div>
      </div>
      <div className="flex items-center gap-4 w-full" key="input-acr-values">
        <label className="block min-w-[140px]">ACR Values</label>
        <div className="single-line-editor-wrapper flex-1">
          <SingleLineEditor
            value={acrValues || ''}
            theme={storedTheme}
            onSave={handleSave}
            onChange={(val) => handleChange('acrValues', val)}
            onRun={handleRun}
            collection={collection}
            item={item}
            isCompact
          />
        </div>
      </div>

      {/* Signed Request Object (JAR — RFC 9101) */}
      <div className="flex items-center gap-2.5 mt-2">
        <div className="flex items-center px-2.5 py-1.5 oauth2-icon-container rounded-md">
          <IconKey size={14} className="oauth2-icon" />
        </div>
        <span className="oauth2-section-label">Signed Request Object (JAR)</span>
      </div>
      <div className="flex flex-row w-full gap-4" key="input-use-request-object">
        <label className="block">Enable</label>
        <input className="cursor-pointer" type="checkbox" checked={Boolean(useRequestObject)} onChange={handleUseRequestObjectToggle} />
      </div>
      {useRequestObject && (
        <>
          <div className="flex items-center gap-4 w-full" key="input-request-object-alg">
            <label className="block min-w-[140px]">Signing Algorithm</label>
            <div className="inline-flex items-center cursor-pointer token-placement-selector">
              <MenuDropdown
                items={REQUEST_OBJECT_ALGS.map((alg) => ({
                  id: alg, label: alg,
                  onClick: () => handleChange('requestObjectSigningAlg', alg)
                }))}
                selectedItemId={requestObjectAlg}
                placement="bottom-end"
              >
                <div className="flex items-center justify-end token-placement-label select-none">
                  {requestObjectAlg}
                  <IconCaretDown className="caret ml-1 mr-1" size={14} strokeWidth={2} />
                </div>
              </MenuDropdown>
            </div>
          </div>
          <div className="flex items-center gap-4 w-full" key="input-request-object-typ">
            <label className="block min-w-[140px]">JWT typ Header</label>
            <div className="single-line-editor-wrapper flex-1">
              <SingleLineEditor
                value={oAuth.requestObjectTyp || ''}
                theme={storedTheme}
                onSave={handleSave}
                onChange={(val) => handleChange('requestObjectTyp', val)}
                onRun={handleRun}
                collection={collection}
                item={item}
                placeholder="oauth-authz-req+jwt (RFC 9101 §10.8 default — override to 'JWT' for older OPs)"
                isCompact
              />
            </div>
          </div>

          {usesHmacForRequestObject ? (
            <div className="flex items-start gap-4 w-full" key="request-object-hmac-note">
              <label className="block min-w-[140px]"></label>
              <div className="flex-1 text-xs">
                HMAC algorithms sign with the <strong>Client Secret</strong> configured under Client Authentication. No separate key needed.
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4 w-full" key="input-request-object-key-format">
                <label className="block min-w-[140px]">Key Format</label>
                <div className="inline-flex items-center cursor-pointer token-placement-selector">
                  <MenuDropdown
                    items={[
                      { id: 'pem', label: 'PEM', onClick: () => handleChange('requestObjectPrivateKeyFormat', 'pem') },
                      { id: 'jwk', label: 'JWK', onClick: () => handleChange('requestObjectPrivateKeyFormat', 'jwk') }
                    ]}
                    selectedItemId={requestObjectKeyFormat}
                    placement="bottom-end"
                  >
                    <div className="flex items-center justify-end token-placement-label select-none">
                      {requestObjectKeyFormat.toUpperCase()}
                      <IconCaretDown className="caret ml-1 mr-1" size={14} strokeWidth={2} />
                    </div>
                  </MenuDropdown>
                </div>
              </div>
              <div className="flex items-center gap-4 w-full" key="input-request-object-private-key">
                <label className="block min-w-[140px]">Private Key</label>
                {isRequestObjectFileBacked ? (
                  <div className="private-key-editor-wrapper flex-1 flex items-center gap-2">
                    <IconFile size={16} className="oauth2-icon flex-shrink-0" />
                    <span className="truncate flex-1" title={requestObjectPrivateKey}>{path.basename(requestObjectPrivateKey)}</span>
                    <button className="flex-shrink-0 oauth2-icon cursor-pointer" onClick={handleBrowseRequestObjectKey} title="Change file" type="button">
                      <IconUpload size={14} />
                    </button>
                    <button className="flex-shrink-0 oauth2-icon cursor-pointer" onClick={handleClearRequestObjectKey} title="Clear file" type="button">
                      <IconX size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col gap-2">
                    <div className="single-line-editor-wrapper flex-1 flex items-center">
                      <SingleLineEditor
                        value={requestObjectPrivateKey}
                        theme={storedTheme}
                        onSave={handleSave}
                        onChange={(val) => handleChange('requestObjectPrivateKey', val)}
                        onRun={handleRun}
                        collection={collection}
                        item={item}
                        isSecret
                        isCompact
                      />
                      {requestObjectKeySensitivity.showWarning && (
                        <SensitiveFieldWarning fieldName="requestObjectPrivateKey" warningMessage={requestObjectKeySensitivity.warningMessage} />
                      )}
                    </div>
                    <div>
                      <button className="flex items-center gap-1 oauth2-icon cursor-pointer text-link" onClick={handleBrowseRequestObjectKey} title="Select file" type="button">
                        <IconUpload size={14} />
                        <span className="text-xs">Select file…</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4 w-full" key="input-request-object-key-id">
                <label className="block min-w-[140px]">Key ID</label>
                <div className="single-line-editor-wrapper flex-1">
                  <SingleLineEditor
                    value={oAuth.requestObjectKeyId || ''}
                    theme={storedTheme}
                    onSave={handleSave}
                    onChange={(val) => handleChange('requestObjectKeyId', val)}
                    onRun={handleRun}
                    collection={collection}
                    item={item}
                    isCompact
                  />
                </div>
              </div>
              {!hasRequestObjectKey && (
                <div className="flex items-start gap-4 w-full" key="request-object-warning">
                  <label className="block min-w-[140px]"></label>
                  <div className="flex-1 text-xs oauth2-mtls-warning">
                    JAR with {requestObjectAlg} requires a private key — paste one above or pick a file. (If you don't set one here, Bruno falls back to the key configured under Client Authentication for backward compatibility with private_key_jwt clients that share a single key for both purposes.)
                  </div>
                </div>
              )}
            </>
          )}

          <div className="flex items-start gap-4 w-full" key="input-request-object-claims">
            <label className="block min-w-[140px] mt-1">Custom Claims</label>
            <div className="flex-1">
              <RequestObjectClaims
                value={oAuth.requestObjectAdditionalClaims || []}
                onChange={(claims) => handleChange('requestObjectAdditionalClaims', claims)}
                collection={collection}
                handleSave={handleSave}
              />
            </div>
          </div>
        </>
      )}

      {/* PAR (RFC 9126) */}
      <div className="flex items-center gap-2.5 mt-2">
        <div className="flex items-center px-2.5 py-1.5 oauth2-icon-container rounded-md">
          <IconKey size={14} className="oauth2-icon" />
        </div>
        <span className="oauth2-section-label">Pushed Authorization Request (PAR)</span>
      </div>
      <div className="flex flex-row w-full gap-4" key="input-use-par">
        <label className="block">Enable</label>
        <input className="cursor-pointer" type="checkbox" checked={Boolean(usePAR)} onChange={handleUsePARToggle} />
      </div>
      {usePAR && (
        <>
          <div className="flex items-center gap-4 w-full" key="input-par-endpoint">
            <label className="block min-w-[140px]">PAR Endpoint</label>
            <div className="single-line-editor-wrapper flex-1">
              <SingleLineEditor
                value={parEndpoint || ''}
                theme={storedTheme}
                onSave={handleSave}
                onChange={(val) => handleChange('parEndpoint', val)}
                onRun={handleRun}
                collection={collection}
                item={item}
                placeholder="Auto-filled by Discovery"
                isCompact
              />
            </div>
          </div>
          {!parEndpoint && (
            <div className="flex items-start gap-4 w-full" key="par-endpoint-warning">
              <label className="block min-w-[140px]"></label>
              <div className="flex-1 text-xs oauth2-mtls-warning">
                PAR is enabled but no PAR endpoint is set. Run Discovery on the Issuer URL, or paste the endpoint manually.
              </div>
            </div>
          )}
        </>
      )}

      <Oauth2TokenSection
        oAuth={oAuth}
        handleChange={handleChange}
        handleRun={handleRun}
        handleSave={handleSave}
        collection={collection}
        item={item}
      />
      <Oauth2AdvancedSettings
        oAuth={oAuth}
        request={request}
        handleChange={handleChange}
        handleSave={handleSave}
        collection={collection}
        item={item}
      />

      <AdditionalParams item={item} request={request} collection={collection} updateAuth={updateAuth} handleSave={handleSave} />
      <Oauth2ActionButtons item={item} request={request} collection={collection} url={accessTokenUrl} credentialsId={credentialsId} />
    </StyledWrapper>
  );
};

export default OpenIDConnect;
