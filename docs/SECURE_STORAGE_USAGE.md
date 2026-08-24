# Secure Storage Usage Guide

## Overview

The secure storage module provides cross-platform OS keychain integration for securely storing connection tokens. This guide demonstrates how to use the secure storage API in your TypeScript code.

## Basic Usage

### Import the Service

```typescript
import { 
  storeToken, 
  getToken, 
  deleteToken, 
  hasToken, 
  updateToken 
} from './services/secureStorage';
```

### Store a Token

Store a connection token after successful pairing:

```typescript
async function saveConnectionToken(profileId: string, token: string) {
  try {
    await storeToken(profileId, token);
    console.log('✓ Token stored securely');
  } catch (error) {
    console.error('✗ Failed to store token:', error);
    throw error;
  }
}

// Example usage
await saveConnectionToken('device-uuid-12345', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');
```

### Retrieve a Token

Retrieve a token for API authentication:

```typescript
async function getAuthToken(profileId: string): Promise<string> {
  try {
    const token = await getToken(profileId);
    console.log('✓ Token retrieved successfully');
    return token;
  } catch (error) {
    console.error('✗ Failed to retrieve token:', error);
    // Token doesn't exist - prompt for pairing
    throw new Error('Token not found. Please pair with the device.');
  }
}

// Example usage
const token = await getAuthToken('device-uuid-12345');
```

### Delete a Token

Delete a token when disconnecting or removing a profile:

```typescript
async function removeConnection(profileId: string) {
  try {
    await deleteToken(profileId);
    console.log('✓ Token deleted successfully');
  } catch (error) {
    console.error('✗ Failed to delete token:', error);
    // Token might not exist - this is okay
  }
}

// Example usage
await removeConnection('device-uuid-12345');
```

### Check if Token Exists

Check if a token exists before attempting retrieval:

```typescript
async function checkTokenExists(profileId: string): Promise<boolean> {
  const exists = await hasToken(profileId);
  if (exists) {
    console.log('✓ Token exists for this profile');
  } else {
    console.log('✗ No token found for this profile');
  }
  return exists;
}

// Example usage
if (await checkTokenExists('device-uuid-12345')) {
  // Token exists, proceed with connection
} else {
  // No token, show pairing UI
}
```

### Update a Token

Update an existing token (token rotation):

```typescript
async function rotateToken(profileId: string, newToken: string) {
  try {
    await updateToken(profileId, newToken);
    console.log('✓ Token updated successfully');
  } catch (error) {
    console.error('✗ Failed to update token:', error);
    throw error;
  }
}

// Example usage
await rotateToken('device-uuid-12345', 'new-jwt-token...');
```

## Integration with Connection Manager

### Complete Connection Flow

```typescript
import { storeToken, getToken, deleteToken, hasToken } from './services/secureStorage';

interface ConnectionProfile {
  id: string;
  name: string;
  deviceId: string;
  host: string;
  port: number;
}

class ConnectionManager {
  /**
   * Connect to a device using stored credentials
   */
  async connect(profile: ConnectionProfile): Promise<void> {
    // Check if token exists
    const tokenExists = await hasToken(profile.id);
    
    if (!tokenExists) {
      throw new Error('No token found. Please pair with the device first.');
    }
    
    // Retrieve token
    const token = await getToken(profile.id);
    
    // Use token for authentication
    await this.authenticateWithToken(profile, token);
  }
  
  /**
   * Pair with a new device and store credentials
   */
  async pair(profile: ConnectionProfile, pairingCode: string): Promise<void> {
    // Perform pairing flow
    const response = await fetch(`http://${profile.host}:${profile.port}/api/pairing/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairing_code: pairingCode,
        desktop_id: profile.id
      })
    });
    
    if (!response.ok) {
      throw new Error('Pairing failed');
    }
    
    const data = await response.json();
    
    // Store the token securely
    await storeToken(profile.id, data.token);
    
    console.log('Pairing successful, token stored');
  }
  
  /**
   * Disconnect and remove credentials
   */
  async disconnect(profile: ConnectionProfile): Promise<void> {
    // Delete the stored token
    await deleteToken(profile.id);
    
    console.log('Disconnected and removed credentials');
  }
  
  /**
   * Handle token rotation on 401 response
   */
  async handleTokenExpiration(profile: ConnectionProfile): Promise<void> {
    // Attempt to refresh the token
    const newToken = await this.refreshToken(profile);
    
    // Update the stored token
    await updateToken(profile.id, newToken);
    
    console.log('Token rotated successfully');
  }
  
  /**
   * Make authenticated API request
   */
  async makeAuthenticatedRequest(profile: ConnectionProfile, endpoint: string): Promise<Response> {
    const token = await getToken(profile.id);
    
    const response = await fetch(`http://${profile.host}:${profile.port}${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    // Handle token expiration
    if (response.status === 401) {
      await this.handleTokenExpiration(profile);
      // Retry the request
      return this.makeAuthenticatedRequest(profile, endpoint);
    }
    
    return response;
  }
  
  private async authenticateWithToken(profile: ConnectionProfile, token: string): Promise<void> {
    // Implementation for authentication
  }
  
  private async refreshToken(profile: ConnectionProfile): Promise<string> {
    // Implementation for token refresh
    return 'new-token';
  }
}
```

## Error Handling

### Recommended Error Handling Pattern

```typescript
async function secureOperation(profileId: string) {
  try {
    const token = await getToken(profileId);
    // Use the token
  } catch (error) {
    if (error.message.includes('Failed to retrieve token')) {
      // Token doesn't exist or keychain is locked
      console.error('Token not found or keychain locked');
      // Show pairing UI
    } else if (error.message.includes('permission')) {
      // Permission denied
      console.error('Permission denied to access keychain');
      // Show system settings guide
    } else {
      // Other error
      console.error('Unexpected error:', error);
    }
  }
}
```

## Testing

### Unit Test Example

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storeToken, getToken, deleteToken } from './secureStorage';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core');

describe('Secure Storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should store token successfully', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue(undefined);

    await storeToken('test-profile', 'test-token');

    expect(mockInvoke).toHaveBeenCalledWith('store_token', {
      profileId: 'test-profile',
      token: 'test-token',
    });
  });

  it('should retrieve token successfully', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue('retrieved-token');

    const result = await getToken('test-profile');

    expect(mockInvoke).toHaveBeenCalledWith('get_token', {
      profileId: 'test-profile',
    });
    expect(result).toBe('retrieved-token');
  });

  it('should delete token successfully', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue(undefined);

    await deleteToken('test-profile');

    expect(mockInvoke).toHaveBeenCalledWith('delete_token', {
      profileId: 'test-profile',
    });
  });
});
```

## Platform-Specific Notes

### macOS
- Tokens are stored in the macOS Keychain
- User may be prompted for keychain password on first access
- Keychain Access.app can be used to view stored credentials

### Windows
- Tokens are stored in Windows Credential Manager
- Can be viewed in Control Panel > Credential Manager
- No user prompt required after login

### Linux
- Tokens are stored in Secret Service (libsecret)
- Requires GNOME Keyring or KWallet
- May prompt for keyring password

## Security Best Practices

1. **Never log tokens**: Avoid logging token values in console or files
2. **Use profile IDs**: Always use unique profile IDs as keys
3. **Handle errors gracefully**: Don't expose keychain errors to users
4. **Rotate tokens**: Implement token rotation for expired credentials
5. **Clean up**: Delete tokens when profiles are removed

## Troubleshooting

### Token Not Persisting

If tokens aren't being stored:
- Check if the OS keychain service is running
- Verify user has permissions to access keychain
- Check if keychain is locked (macOS)
- Ensure Secret Service is installed (Linux)

### Permission Denied

If you get permission errors:
- **macOS**: Unlock Keychain Access
- **Windows**: Run as administrator if needed
- **Linux**: Install and configure GNOME Keyring or KWallet

### Token Not Found

If retrieval fails:
- Verify the profile ID is correct
- Check if token was actually stored
- Ensure keychain wasn't cleared manually

## API Reference

### `storeToken(profileId: string, token: string): Promise<void>`
Stores a token securely in the OS keychain.

**Parameters:**
- `profileId`: Unique identifier for the connection profile
- `token`: The connection token to store

**Throws:** Error if storage fails

---

### `getToken(profileId: string): Promise<string>`
Retrieves a token from the OS keychain.

**Parameters:**
- `profileId`: Unique identifier for the connection profile

**Returns:** The stored token

**Throws:** Error if token not found or retrieval fails

---

### `deleteToken(profileId: string): Promise<void>`
Deletes a token from the OS keychain.

**Parameters:**
- `profileId`: Unique identifier for the connection profile

**Throws:** Error if deletion fails

---

### `hasToken(profileId: string): Promise<boolean>`
Checks if a token exists in the keychain.

**Parameters:**
- `profileId`: Unique identifier for the connection profile

**Returns:** `true` if token exists, `false` otherwise

---

### `updateToken(profileId: string, newToken: string): Promise<void>`
Updates an existing token (convenience method).

**Parameters:**
- `profileId`: Unique identifier for the connection profile
- `newToken`: The new connection token

**Throws:** Error if update fails

## Additional Resources

- [Rust Backend Documentation](../src-tauri/src/secure_storage_README.md)
- [Keyring Crate Documentation](https://docs.rs/keyring/)
- [Tauri Invoke API](https://tauri.app/v1/guides/features/command/)
