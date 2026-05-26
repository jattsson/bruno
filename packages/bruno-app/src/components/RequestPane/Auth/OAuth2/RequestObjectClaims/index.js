import React from 'react';
import { IconTrash, IconPlus } from '@tabler/icons';
import { useTheme } from 'providers/Theme';
import SingleLineEditor from 'components/SingleLineEditor';
import MultiLineEditor from 'components/MultiLineEditor';
import { uuid } from 'utils/common';

// Editor for the `requestObjectAdditionalClaims` list — name/value/enabled rows merged into the
// signed Request Object JWT. Values that parse as JSON objects/arrays are sent as nested
// structures (so OIDC's `claims` request parameter and similar can be expressed); plain strings
// are sent as strings.
//
// The name and value cells use Bruno's CodeMirror-backed editors so {{var}} references resolve
// against the collection's environment / runtime variables — same behaviour as the
// AdditionalParams editor below.
const RequestObjectClaims = ({ value = [], onChange, collection, handleSave }) => {
  const { storedTheme } = useTheme();
  const claims = Array.isArray(value) ? value : [];

  const updateAt = (index, patch) => {
    const next = claims.map((c, i) => (i === index ? { ...c, ...patch } : c));
    onChange(next);
  };

  const addRow = () => {
    onChange([...claims, { uid: uuid(), name: '', value: '', enabled: true }]);
  };

  const removeAt = (index) => {
    onChange(claims.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      {claims.length === 0 && (
        <div className="text-xs text-gray-500 italic">
          No custom claims. Values that look like JSON (start with <code>{'{'}</code> or <code>[</code>) are sent as nested objects/arrays; everything else is sent as a string.
        </div>
      )}
      {claims.map((claim, index) => (
        <div className="flex items-start gap-2 w-full" key={claim.uid || index}>
          <input
            type="checkbox"
            checked={claim.enabled !== false}
            onChange={(e) => updateAt(index, { enabled: e.target.checked })}
            className="cursor-pointer mt-2"
            title={claim.enabled !== false ? 'Disable' : 'Enable'}
          />
          <div className="single-line-editor-wrapper flex-1 min-w-0">
            <SingleLineEditor
              value={claim.name || ''}
              theme={storedTheme}
              onChange={(val) => updateAt(index, { name: val })}
              collection={collection}
              onSave={handleSave}
              isCompact
            />
          </div>
          <div className="flex-1 min-w-0">
            <MultiLineEditor
              value={claim.value || ''}
              theme={storedTheme}
              onChange={(val) => updateAt(index, { value: val })}
              collection={collection}
              onSave={handleSave}
            />
          </div>
          <button
            type="button"
            onClick={() => removeAt(index)}
            className="oauth2-icon cursor-pointer mt-2"
            title="Remove claim"
          >
            <IconTrash size={14} />
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1 oauth2-icon cursor-pointer text-link"
          title="Add custom claim"
        >
          <IconPlus size={14} />
          <span className="text-xs">Add claim</span>
        </button>
      </div>
    </div>
  );
};

export default RequestObjectClaims;
