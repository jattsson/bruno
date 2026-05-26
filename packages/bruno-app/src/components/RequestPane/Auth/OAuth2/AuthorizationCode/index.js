import React from 'react';
import { useDetectSensitiveField } from 'hooks/useDetectSensitiveField';
import get from 'lodash/get';
import { useTheme } from 'providers/Theme';
import { useDispatch, useSelector } from 'react-redux';
import { IconSettings } from '@tabler/icons';
import SingleLineEditor from 'components/SingleLineEditor';
import StyledWrapper from './StyledWrapper';
import { inputsConfig } from './inputsConfig';
import Oauth2TokenViewer from '../Oauth2TokenViewer/index';
import Oauth2ActionButtons from '../Oauth2ActionButtons/index';
import AdditionalParams from '../AdditionalParams/index';
import ClientAuthMethod from '../ClientAuthMethod/index';
import Oauth2TokenSection from '../Oauth2TokenSection/index';
import Oauth2AdvancedSettings from '../Oauth2AdvancedSettings/index';
import Oauth2UseSystemBrowserToggle from '../Oauth2UseSystemBrowserToggle/index';
import SensitiveFieldWarning from 'components/SensitiveFieldWarning';

const OAuth2AuthorizationCode = ({ save, item = {}, request, handleRun, updateAuth, collection, folder }) => {
  const dispatch = useDispatch();
  const preferences = useSelector((state) => state.app.preferences);
  const { storedTheme } = useTheme();
  const useSystemBrowser = get(preferences, 'request.oauth2.useSystemBrowser', false);
  const { isSensitive } = useDetectSensitiveField(collection);
  const oAuth = get(request, 'auth.oauth2', {});
  const { callbackUrl, accessTokenUrl, credentialsId } = oAuth;

  const handleSave = () => { save(); };

  const patchOAuth = (patch) => {
    dispatch(
      updateAuth({
        mode: 'oauth2',
        collectionUid: collection.uid,
        itemUid: item.uid,
        content: {
          ...oAuth,
          grantType: 'authorization_code',
          ...patch
        }
      })
    );
  };

  const handleChange = (key, value) => patchOAuth({ [key]: value });

  const handlePKCEToggle = () => {
    handleChange('pkce', !Boolean(oAuth?.pkce));
  };

  return (
    <StyledWrapper className="mt-2 flex w-full gap-4 flex-col">
      <Oauth2TokenViewer handleRun={handleRun} collection={collection} item={item} url={accessTokenUrl} credentialsId={credentialsId} />
      <div className="flex items-center gap-2.5 mt-2">
        <div className="flex items-center px-2.5 py-1.5 oauth2-icon-container rounded-md">
          <IconSettings size={14} className="oauth2-icon" />
        </div>
        <span className="oauth2-section-label">
          Configuration
        </span>
      </div>
      <div className="flex items-center gap-4 w-full" key="input-callbackUrl">
        <label className="block min-w-[140px]">Callback URL</label>
        <div className="flex flex-col gap-1 w-full">
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
      </div>
      <Oauth2UseSystemBrowserToggle />
      {inputsConfig
        .filter((input) => input.key !== 'clientSecret')
        .map((input) => {
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
      <div className="flex flex-row w-full gap-4" key="pkce">
        <label className="block">Use PKCE</label>
        <input
          className="cursor-pointer"
          type="checkbox"
          checked={Boolean(oAuth?.['pkce'])}
          onChange={handlePKCEToggle}
        />
      </div>
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
      <AdditionalParams
        item={item}
        request={request}
        collection={collection}
        updateAuth={updateAuth}
        handleSave={handleSave}
      />
      <Oauth2ActionButtons item={item} request={request} collection={collection} url={accessTokenUrl} credentialsId={credentialsId} />
    </StyledWrapper>
  );
};

export default OAuth2AuthorizationCode;
