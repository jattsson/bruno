import React from 'react';
import { IconTrash, IconPlus } from '@tabler/icons';
import { uuid } from 'utils/common';

// Editor for the `requestObjectAdditionalClaims` list — name/value/enabled rows merged into the
// signed Request Object JWT. Values that parse as JSON objects/arrays are sent as nested
// structures (so OIDC's `claims` request parameter and similar can be expressed); plain strings
// are sent as strings.
const RequestObjectClaims = ({ value = [], onChange }) => {
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
          <input
            type="text"
            value={claim.name || ''}
            onChange={(e) => updateAt(index, { name: e.target.value })}
            placeholder="claim name (e.g. claims)"
            className="single-line-editor-wrapper flex-1 min-w-0"
            style={{ minHeight: '2rem' }}
          />
          <textarea
            value={claim.value || ''}
            onChange={(e) => updateAt(index, { value: e.target.value })}
            placeholder='{"id_token":{"acr":{"essential":true}}}'
            rows={Math.max(1, Math.min(6, (claim.value || '').split('\n').length))}
            className="single-line-editor-wrapper flex-1 min-w-0 font-mono text-xs"
            style={{ resize: 'vertical' }}
          />
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
