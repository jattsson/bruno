import React from 'react';
import get from 'lodash/get';
import { useDispatch, useSelector } from 'react-redux';
import { savePreferences } from 'providers/ReduxStore/slices/app';
import toast from 'react-hot-toast';

// The "Use system browser for OAuth" preference is global (Bruno-wide), not per-collection or
// per-request — so this checkbox reads from / writes to the redux preferences slice directly and
// can be dropped into any browser-based OAuth2 form without prop drilling.
const Oauth2UseSystemBrowserToggle = () => {
  const dispatch = useDispatch();
  const preferences = useSelector((state) => state.app.preferences);
  const useSystemBrowser = get(preferences, 'request.oauth2.useSystemBrowser', false);

  const handleToggle = (e) => {
    const newValue = e.target.checked;
    dispatch(
      savePreferences({
        ...preferences,
        request: {
          ...preferences.request,
          oauth2: {
            ...preferences.request.oauth2,
            useSystemBrowser: newValue
          }
        }
      })
    )
      .then(() => toast.success('Preference updated successfully'))
      .catch((err) => {
        console.error(err);
        toast.error('Failed to update preference');
      });
  };

  return (
    <div className="flex items-center gap-4 w-full" key="input-use-system-browser">
      <label className="block min-w-[140px]"></label>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={Boolean(useSystemBrowser)}
          onChange={handleToggle}
          className="cursor-pointer"
        />
        <label
          className="block cursor-pointer"
          onClick={(e) => {
            e.preventDefault();
            handleToggle({ target: { checked: !useSystemBrowser } });
          }}
        >
          Use system browser for OAuth
        </label>
      </div>
    </div>
  );
};

export default Oauth2UseSystemBrowserToggle;
