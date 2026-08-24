/**
 * Token Rotation Hook
 * 
 * React hook that manages token rotation state and provides
 * a callback for the TokenRotationManager.
 * 
 * Requirements: 2.7
 */

import { useState, useEffect, useCallback } from 'react';
import { tokenRotationManager } from '../services/tokenRotation';
import type { ConnectionProfile } from '../connectionManager';

interface TokenRotationState {
  /** Whether re-authentication dialog should be shown */
  showReAuthDialog: boolean;
  /** The profile that needs re-authentication */
  profileNeedingAuth: ConnectionProfile | null;
  /** Promise resolver for the current rotation request */
  resolver: ((token: string) => void) | null;
  /** Promise rejecter for the current rotation request */
  rejecter: ((error: Error) => void) | null;
}

/**
 * Hook to manage token rotation state and provide re-authentication UI
 * 
 * Usage:
 * ```tsx
 * const { ReAuthDialogComponent } = useTokenRotation();
 * 
 * return (
 *   <div>
 *     {ReAuthDialogComponent}
 *     {/* rest of app *\/}
 *   </div>
 * );
 * ```
 * 
 * @returns Object containing the ReAuthDialog component to render
 */
export function useTokenRotation() {
  const [state, setState] = useState<TokenRotationState>({
    showReAuthDialog: false,
    profileNeedingAuth: null,
    resolver: null,
    rejecter: null,
  });

  /**
   * Re-authentication callback for TokenRotationManager
   * 
   * Requirement 2.7: Prompt user for re-authentication without requiring full re-pairing
   */
  const reAuthCallback = useCallback((profile: ConnectionProfile): Promise<string> => {
    return new Promise((resolve, reject) => {
      setState({
        showReAuthDialog: true,
        profileNeedingAuth: profile,
        resolver: resolve,
        rejecter: reject,
      });
    });
  }, []);

  /**
   * Handle successful re-authentication
   */
  const handleReAuthSuccess = useCallback((newToken: string) => {
    if (state.resolver) {
      state.resolver(newToken);
    }
    setState({
      showReAuthDialog: false,
      profileNeedingAuth: null,
      resolver: null,
      rejecter: null,
    });
  }, [state.resolver]);

  /**
   * Handle cancelled re-authentication
   */
  const handleReAuthCancel = useCallback(() => {
    if (state.rejecter) {
      state.rejecter(new Error('Re-authentication cancelled by user'));
    }
    setState({
      showReAuthDialog: false,
      profileNeedingAuth: null,
      resolver: null,
      rejecter: null,
    });
  }, [state.rejecter]);

  /**
   * Set up the re-authentication callback on mount
   */
  useEffect(() => {
    tokenRotationManager.setReAuthenticationCallback(reAuthCallback);

    return () => {
      tokenRotationManager.clearReAuthenticationCallback();
    };
  }, [reAuthCallback]);

  return {
    showReAuthDialog: state.showReAuthDialog,
    profileNeedingAuth: state.profileNeedingAuth,
    handleReAuthSuccess,
    handleReAuthCancel,
  };
}
