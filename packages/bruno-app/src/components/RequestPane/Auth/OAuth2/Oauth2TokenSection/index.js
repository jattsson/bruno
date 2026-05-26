import React from 'react';
import { useTheme } from 'providers/Theme';
import { IconCaretDown, IconKey } from '@tabler/icons';
import MenuDropdown from 'ui/MenuDropdown';
import SingleLineEditor from 'components/SingleLineEditor';

// Token section shared by the browser-based OAuth2 grants (authorization_code, openid_code,
// openid_hybrid): Token Source dropdown, Token ID, Add-token-to placement, plus the conditional
// Header Prefix / Query Param Key row. All five OAuth2 grant forms render essentially the same
// markup here today; this component eliminates that duplication for the grants that adopt it.
const Oauth2TokenSection = ({ oAuth, handleChange, handleRun, handleSave, collection, item }) => {
  const { storedTheme } = useTheme();
  const { tokenSource, tokenPlacement } = oAuth;

  return (
    <>
      <div className="flex items-center gap-2.5 mt-2">
        <div className="flex items-center px-2.5 py-1.5 oauth2-icon-container rounded-md">
          <IconKey size={14} className="oauth2-icon" />
        </div>
        <span className="oauth2-section-label">Token</span>
      </div>
      <div className="flex items-center gap-4 w-full" key="input-token-type">
        <label className="block min-w-[140px]">Token Source</label>
        <div className="inline-flex items-center cursor-pointer token-placement-selector">
          <MenuDropdown
            items={[
              { id: 'access_token', label: 'Access Token', onClick: () => handleChange('tokenSource', 'access_token') },
              { id: 'id_token', label: 'ID Token', onClick: () => handleChange('tokenSource', 'id_token') }
            ]}
            selectedItemId={tokenSource}
            placement="bottom-end"
          >
            <div className="flex items-center justify-end token-placement-label select-none">
              {tokenSource === 'id_token' ? 'ID Token' : 'Access Token'}
              <IconCaretDown className="caret ml-1 mr-1" size={14} strokeWidth={2} />
            </div>
          </MenuDropdown>
        </div>
      </div>
      <div className="flex items-center gap-4 w-full" key="input-token-name">
        <label className="block min-w-[140px]">Token ID</label>
        <div className="single-line-editor-wrapper flex-1">
          <SingleLineEditor
            value={oAuth['credentialsId'] || ''}
            theme={storedTheme}
            onSave={handleSave}
            onChange={(val) => handleChange('credentialsId', val)}
            onRun={handleRun}
            collection={collection}
            item={item}
            isCompact
          />
        </div>
      </div>
      <div className="flex items-center gap-4 w-full" key="input-token-placement">
        <label className="block min-w-[140px]">Add token to</label>
        <div className="inline-flex items-center cursor-pointer token-placement-selector">
          <MenuDropdown
            items={[
              { id: 'header', label: 'Header', onClick: () => handleChange('tokenPlacement', 'header') },
              { id: 'url', label: 'URL', onClick: () => handleChange('tokenPlacement', 'url') }
            ]}
            selectedItemId={tokenPlacement}
            placement="bottom-end"
          >
            <div className="flex items-center justify-end token-placement-label select-none">
              {tokenPlacement == 'url' ? 'URL' : 'Headers'}
              <IconCaretDown className="caret ml-1 mr-1" size={14} strokeWidth={2} />
            </div>
          </MenuDropdown>
        </div>
      </div>
      {tokenPlacement === 'header' ? (
        <div className="flex items-center gap-4 w-full" key="input-token-prefix">
          <label className="block min-w-[140px]">Header Prefix</label>
          <div className="single-line-editor-wrapper flex-1">
            <SingleLineEditor
              value={oAuth['tokenHeaderPrefix'] || ''}
              theme={storedTheme}
              onSave={handleSave}
              onChange={(val) => handleChange('tokenHeaderPrefix', val)}
              onRun={handleRun}
              collection={collection}
              isCompact
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4 w-full" key="input-token-query-param-key">
          <label className="block min-w-[140px]">Query Param Key</label>
          <div className="single-line-editor-wrapper flex-1">
            <SingleLineEditor
              value={oAuth['tokenQueryKey'] || ''}
              theme={storedTheme}
              onSave={handleSave}
              onChange={(val) => handleChange('tokenQueryKey', val)}
              onRun={handleRun}
              collection={collection}
              isCompact
            />
          </div>
        </div>
      )}
    </>
  );
};

export default Oauth2TokenSection;
