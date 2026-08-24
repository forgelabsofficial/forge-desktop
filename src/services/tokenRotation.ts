/**
 * Token Rotation Service
 * 
 * Handles automatic token rotation when 401 Unauthorized responses are detected.
 * Prompts user for re-authentication without requiring full re-pairing.
 * 
 * Requirements: 2.7
 */

import { updateToken } from './secureStorage';
import { ConnectionProfile } from '../connectionManager';

/**
 * Authentication error indicating token expiration
 */
export class TokenExpiredError extends Error {
  constructor(message: string = 'Token expired - re-authentication required') {
    super(message);
    this.name = 'TokenExpiredError';
  }
}

/**
 * Callback function for prompting user to re-authenticate
 * Should display UI to collect new credentials from user
 * @returns Promise that resolves with the new token
 */
export type ReAuthenticationCallback = (profile: ConnectionProfile) => Promise<string>;

/**
 * Token rotation manager
 */
export class TokenRotationManager {
  private reAuthCallback: ReAuthenticationCallback | null = null;
  private rotationInProgress = new Map<string, Promise<string>>();

  /**
   * Set the re-authentication callback
   * This should be called during app initialization
   * 
   * @param callback Function to prompt user for new credentials
   * 
   * @example
   * ```typescript
   * tokenRotationManager.setReAuthenticationCallback(async (profile) => {
   *   // Display UI modal to collect new credentials
   *   const newToken = await showReAuthDialog(profile);
   *   return newToken;
   * });
   * ```
   */
  setReAuthenticationCallback(callback: ReAuthenticationCallback): void {
    this.reAuthCallback = callback;
  }

  /**
   * Handle token expiration by prompting for re-authentication
   * and updating the stored token
   * 
   * Requirements:
   * - 2.7: Prompt user for re-authentication without requiring full re-pairing
   * - 2.7: Update stored token in keychain after successful rotation
   * 
   * @param profile The connection profile that needs token rotation
   * @returns Promise that resolves with the new token
   * @throws Error if re-authentication fails or callback not set
   */
  async rotateToken(profile: ConnectionProfile): Promise<string> {
    if (!this.reAuthCallback) {
      throw new Error('Re-authentication callback not set. Call setReAuthenticationCallback() first.');
    }

    // Prevent concurrent rotation requests for the same profile
    const existingRotation = this.rotationInProgress.get(profile.id);
    if (existingRotation) {
      console.log(`[TokenRotation] Token rotation already in progress for profile ${profile.id}, waiting...`);
      return existingRotation;
    }

    console.log(`[TokenRotation] Starting token rotation for profile: ${profile.name} (${profile.id})`);

    const rotationPromise = this._performRotation(profile);
    this.rotationInProgress.set(profile.id, rotationPromise);

    try {
      const newToken = await rotationPromise;
      return newToken;
    } finally {
      this.rotationInProgress.delete(profile.id);
    }
  }

  /**
   * Internal method to perform the actual rotation
   */
  private async _performRotation(profile: ConnectionProfile): Promise<string> {
    try {
      // Prompt user for re-authentication
      console.log('[TokenRotation] Prompting user for re-authentication...');
      const newToken = await this.reAuthCallback!(profile);

      if (!newToken || newToken.trim().length === 0) {
        throw new Error('Re-authentication failed: empty token received');
      }

      // Update stored token in keychain (Requirement 2.7)
      console.log('[TokenRotation] Updating token in secure storage...');
      await updateToken(profile.id, newToken);

      // Update the profile object with new token
      profile.token = newToken;

      console.log('[TokenRotation] Token rotation completed successfully');
      return newToken;
    } catch (error) {
      console.error('[TokenRotation] Token rotation failed:', error);
      throw new Error(
        `Token rotation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check if a token rotation is currently in progress for a profile
   * 
   * @param profileId The profile ID to check
   * @returns True if rotation is in progress, false otherwise
   */
  isRotationInProgress(profileId: string): boolean {
    return this.rotationInProgress.has(profileId);
  }

  /**
   * Clear the re-authentication callback
   */
  clearReAuthenticationCallback(): void {
    this.reAuthCallback = null;
  }
}

/**
 * Global singleton instance
 */
export const tokenRotationManager = new TokenRotationManager();
