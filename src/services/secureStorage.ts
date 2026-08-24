/**
 * Secure Storage Service
 * 
 * Provides TypeScript wrapper functions for interacting with the Rust backend's
 * secure token storage via Tauri commands.
 * 
 * Platform Support:
 * - macOS: Uses Keychain
 * - Windows: Uses Credential Store
 * - Linux: Uses Secret Service (libsecret)
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Store a connection token securely in the OS keychain
 * 
 * @param profileId - Unique identifier for the connection profile
 * @param token - The connection token to store (typically a JWT)
 * @returns Promise that resolves when token is stored successfully
 * @throws Error if storage fails
 * 
 * @example
 * ```typescript
 * await storeToken('device-uuid-12345', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');
 * ```
 */
export async function storeToken(profileId: string, token: string): Promise<void> {
  try {
    await invoke<void>('store_token', { profileId, token });
  } catch (error) {
    throw new Error(`Failed to store token: ${error}`);
  }
}

/**
 * Retrieve a connection token from the OS keychain
 * 
 * @param profileId - Unique identifier for the connection profile
 * @returns Promise that resolves with the encrypted token
 * @throws Error if retrieval fails or token not found
 * 
 * @example
 * ```typescript
 * const token = await getToken('device-uuid-12345');
 * console.log('Retrieved token:', token);
 * ```
 */
export async function getToken(profileId: string): Promise<string> {
  try {
    return await invoke<string>('get_token', { profileId });
  } catch (error) {
    throw new Error(`Failed to retrieve token: ${error}`);
  }
}

/**
 * Delete a connection token from the OS keychain
 * 
 * @param profileId - Unique identifier for the connection profile
 * @returns Promise that resolves when token is deleted successfully
 * @throws Error if deletion fails
 * 
 * @example
 * ```typescript
 * await deleteToken('device-uuid-12345');
 * console.log('Token deleted successfully');
 * ```
 */
export async function deleteToken(profileId: string): Promise<void> {
  try {
    await invoke<void>('delete_token', { profileId });
  } catch (error) {
    throw new Error(`Failed to delete token: ${error}`);
  }
}

/**
 * Check if a token exists for a given profile
 * 
 * @param profileId - Unique identifier for the connection profile
 * @returns Promise that resolves to true if token exists, false otherwise
 * 
 * @example
 * ```typescript
 * if (await hasToken('device-uuid-12345')) {
 *   console.log('Token exists for this profile');
 * }
 * ```
 */
export async function hasToken(profileId: string): Promise<boolean> {
  try {
    await getToken(profileId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Update an existing token (convenience method)
 * 
 * @param profileId - Unique identifier for the connection profile
 * @param newToken - The new connection token
 * @returns Promise that resolves when token is updated successfully
 * 
 * @example
 * ```typescript
 * await updateToken('device-uuid-12345', 'new-jwt-token...');
 * ```
 */
export async function updateToken(profileId: string, newToken: string): Promise<void> {
  // Store operation will overwrite existing token
  await storeToken(profileId, newToken);
}
