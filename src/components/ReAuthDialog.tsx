/**
 * Re-Authentication Dialog Component
 * 
 * Displays a modal dialog when a token expires, prompting the user
 * to re-authenticate without requiring full re-pairing.
 * 
 * Requirements: 2.7
 */

import { useState } from 'react';
import type { ConnectionProfile } from '../connectionManager';
import { confirmPairing } from '../api';

interface ReAuthDialogProps {
  profile: ConnectionProfile;
  onSuccess: (newToken: string) => void;
  onCancel: () => void;
}

/**
 * ReAuthDialog component for token rotation
 * 
 * Prompts user for re-authentication when a token expires.
 * Uses the same pairing confirmation endpoint but without full re-pairing.
 * 
 * @param profile - The connection profile that needs re-authentication
 * @param onSuccess - Callback with new token when re-auth succeeds
 * @param onCancel - Callback when user cancels re-authentication
 */
export default function ReAuthDialog({
  profile,
  onSuccess,
  onCancel,
}: ReAuthDialogProps) {
  const [pairingCode, setPairingCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (pairingCode.length !== 6) {
      setError('Pairing code must be 6 digits');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Request new pairing code from device
      // User should manually initiate pairing on the device first
      const result = await confirmPairing(
        profile.host,
        profile.port,
        pairingCode,
        profile.deviceId
      );

      // Requirement 2.7: Return new token for rotation
      onSuccess(result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Re-authentication failed');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-forge-panel p-6 shadow-xl">
        <h2 className="mb-2 text-lg font-semibold text-forge-text">
          Token Expired
        </h2>
        <p className="mb-4 text-sm text-forge-muted">
          Your connection to <span className="font-medium text-forge-text">{profile.name}</span> has expired.
          Please re-authenticate to continue.
        </p>

        <div className="mb-4 rounded-md bg-forge-bg p-3">
          <p className="text-xs text-forge-muted">
            <span className="font-medium text-forge-text">Steps:</span>
          </p>
          <ol className="mt-2 space-y-1 text-xs text-forge-muted">
            <li>1. Open Forge OS on your device</li>
            <li>2. Go to Settings → Desktop Integration</li>
            <li>3. Tap "Generate Pairing Code"</li>
            <li>4. Enter the 6-digit code below</li>
          </ol>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="pairing-code"
              className="mb-1.5 block text-xs font-medium text-forge-text"
            >
              Pairing Code
            </label>
            <input
              id="pairing-code"
              type="text"
              value={pairingCode}
              onChange={(e) => {
                // Only allow digits, max 6 characters
                const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                setPairingCode(value);
                setError('');
              }}
              placeholder="000000"
              maxLength={6}
              className="w-full rounded-md border border-forge-border bg-forge-bg px-3 py-2 text-center text-lg font-mono tracking-widest text-forge-text placeholder-forge-muted/50 focus:border-forge-accent focus:outline-none focus:ring-1 focus:ring-forge-accent"
              disabled={loading}
              autoFocus
            />
            {error && (
              <p className="mt-1.5 text-xs text-red-400">{error}</p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="flex-1 rounded-md border border-forge-border bg-forge-bg px-4 py-2 text-sm font-medium text-forge-text transition hover:bg-forge-panel disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || pairingCode.length !== 6}
              className="flex-1 rounded-md bg-forge-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-forge-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Re-authenticating...' : 'Re-authenticate'}
            </button>
          </div>
        </form>

        <p className="mt-4 text-xs text-forge-muted">
          <span className="font-medium text-forge-text">Note:</span> This will
          update your stored token without requiring a full re-pairing process.
        </p>
      </div>
    </div>
  );
}
