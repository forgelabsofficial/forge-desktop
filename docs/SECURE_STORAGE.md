# Secure Storage Implementation

## Overview

Task 4.1 implements secure token storage for connection profiles using OS-native credential managers. This ensures connection tokens are stored securely and encrypted at rest.

## Implementation Details

### Backend (Rust)

The secure storage implementation is located in `src-tauri/src/secure_storage.rs` and uses the `keyring` crate (v3.6) for cross-platform secure storage.

#### Platform Support

| Platform | Storage Backend | Location |
|----------|----------------|----------|
| macOS | Keychain | System Keychain |
| Windows | Credential Manager | Windows Credential Store |
| Linux | Secret Service | libsecret (GNOME Keyring, KWallet) |

#### Tauri Commands

Three Tauri commands are exposed to the frontend:

1. **`store_token(profile_id: String, token: String) -> Result<(), String>`**
   - Stores a connection token securely
   - Overwrites existing token if present
   - Returns error if keychain is unavailable

2. **`get_token(profile_id: String) -> Result<String, String>`**
   - Retrieves a stored connection token
   - Returns error if token doesn't exist or keychain is unavailable

3. **`delete_token(profile_id: String) -> Result<(), String>`**
   - Deletes a stored connection token
   - Returns error if deletion fails

#### Service Name

All credentials are stored under the service name `"forge-desktop"` with the `profile_id` as the account name. This allows multiple profiles to be stored independently.

### Frontend (TypeScript)

The TypeScript wrapper is located in `src/services/secureStorage.ts` and provides a clean API for the frontend.

#### Usage Example

```typescript
import { storeToken, getToken, deleteToken, hasToken } from './services/secureStorage';

// Store a token after successful pairing
async function saveConnectionProfile(profileId: string, token: string) {
  try {
    await storeToken(profileId, token);
    console.log('Token stored securely');
  } catch (error) {
    console.error('Failed to store token:', error);
  }
}

// Retrieve a token for API requests
async function getAuthToken(profileId: string): Promise<string | null> {
  try {
    return await getToken(profileId);
  } catch (error) {
    console.error('Failed to retrieve token:', error);
    return null;
  }
}

// Check if a profile has a stored token
async function isProfileAuthenticated(profileId: string): Promise<boolean> {
  return await hasToken(profileId);
}

// Remove a token when user disconnects
async function removeProfile(profileId: string) {
  try {
    await deleteToken(profileId);
    console.log('Profile removed');
  } catch (error) {
    console.error('Failed to remove profile:', error);
  }
}
```

## Integration with Connection Profiles

The secure storage integrates with the ConnectionProfile data model from the design document:

```typescript
interface ConnectionProfile {
  id: string;              // Used as profile_id for secure storage
  name: string;
  deviceId: string;
  host: string;
  port: number;
  token: string;           // DO NOT store in memory/disk - use secure storage
  connectionMethod: 'tcp' | 'adb' | 'relay';
  lastConnected: number;
  deviceMetadata: {
    model: string;
    androidVersion: string;
    forgeOsVersion: string;
    capabilities: string[];
  };
}
```

### Best Practices

1. **Never store tokens in plain text** - Always use the secure storage API
2. **Use profile.id as the key** - Ensures unique storage per profile
3. **Remove tokens on logout** - Call `deleteToken()` when user disconnects
4. **Handle errors gracefully** - Keychain may be unavailable in some environments
5. **Don't cache tokens in memory** - Retrieve from secure storage as needed

### Example: ProfileManager Integration

```typescript
class ProfileManager {
  async createProfile(profile: Omit<ConnectionProfile, 'id'>): Promise<ConnectionProfile> {
    const id = generateUUID();
    const newProfile = { ...profile, id };
    
    // Store token securely
    await storeToken(id, profile.token);
    
    // Store profile metadata (without token) in regular storage
    const profileWithoutToken = { ...newProfile, token: '' };
    await this.saveProfileMetadata(profileWithoutToken);
    
    return newProfile;
  }

  async getProfile(id: string): Promise<ConnectionProfile | null> {
    const metadata = await this.loadProfileMetadata(id);
    if (!metadata) return null;
    
    // Retrieve token from secure storage
    try {
      const token = await getToken(id);
      return { ...metadata, token };
    } catch {
      // Token not available, return profile without auth
      return { ...metadata, token: '' };
    }
  }

  async deleteProfile(id: string): Promise<void> {
    await deleteToken(id);
    await this.removeProfileMetadata(id);
  }
}
```

## Testing

### Unit Tests (Rust)

Unit tests are located in `src-tauri/src/secure_storage.rs`. Run with:

```bash
cargo test --lib secure_storage
```

Note: Tests may skip if keychain is unavailable (e.g., in CI environments).

### Integration Tests (Rust)

Integration tests are located in `src-tauri/tests/secure_storage_integration.rs`. Run with:

```bash
cargo test --test secure_storage_integration
```

### Manual Testing

To test the functionality manually:

1. Build and run the Tauri app:
   ```bash
   npm run tauri dev
   ```

2. Open the browser console and test the commands:
   ```javascript
   // Store a token
   await window.__TAURI__.core.invoke('store_token', {
     profileId: 'test-profile-1',
     token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test'
   });

   // Retrieve the token
   const token = await window.__TAURI__.core.invoke('get_token', {
     profileId: 'test-profile-1'
   });
   console.log('Retrieved token:', token);

   // Delete the token
   await window.__TAURI__.core.invoke('delete_token', {
     profileId: 'test-profile-1'
   });
   ```

3. Verify on each platform:
   - **macOS**: Open Keychain Access app, search for "forge-desktop"
   - **Windows**: Open Credential Manager, look under "Generic Credentials"
   - **Linux**: Use `secret-tool search service forge-desktop`

## Security Considerations

### Encryption

- **macOS Keychain**: Uses 256-bit AES encryption, protected by user's login password
- **Windows Credential Manager**: Uses DPAPI (Data Protection API) with AES-256
- **Linux Secret Service**: Encryption depends on the backend (GNOME Keyring uses AES-128/256)

### Access Control

- Tokens are only accessible to the Forge Desktop application
- On macOS, tokens are protected by the app's code signature
- On Windows, tokens are bound to the user's Windows account
- On Linux, access requires authentication to the session keyring

### Token Rotation

The secure storage supports token rotation (Requirement 2.7):

```typescript
async function rotateToken(profileId: string, newToken: string) {
  // Simply overwrite the old token with the new one
  await storeToken(profileId, newToken);
  console.log('Token rotated successfully');
}
```

## Requirements Validation

This implementation validates:

- **Requirement 10.7**: The Connection_Manager SHALL encrypt stored Connection_Tokens
  - ✅ Tokens are stored using OS-native encrypted storage
  
- **Requirement 2.1**: THE Desktop_Client SHALL authenticate with Device using the Connection_Token
  - ✅ Tokens can be securely retrieved for API authentication

## Future Enhancements

1. **Token expiration tracking**: Store token expiration time alongside the token
2. **Automatic cleanup**: Periodically remove expired tokens
3. **Biometric protection**: Add optional biometric authentication before retrieving tokens
4. **Backup/restore**: Export encrypted token backups for device migration
5. **Audit logging**: Log token access for security auditing

## Troubleshooting

### "Keyring not available" errors

If you encounter keyring errors:

1. **Windows**: Ensure Credential Manager service is running
2. **macOS**: Check Keychain Access app is not locked
3. **Linux**: Install `gnome-keyring` or `kwallet` and ensure D-Bus is running

### Token not persisting

If tokens are stored but not retrieved:

1. Check the profile_id is exactly the same for store and retrieve
2. Verify the service name hasn't changed ("forge-desktop")
3. Check system logs for keychain access errors

### Testing in CI/CD

For CI/CD pipelines, tests may need to skip if no keychain is available:

```bash
# Set environment variable to skip keychain tests
export SKIP_KEYRING_TESTS=1
cargo test
```

## References

- [keyring crate documentation](https://docs.rs/keyring/)
- [Tauri commands guide](https://tauri.app/v1/guides/features/command/)
- Requirements Document: Section 10 (Connection Configuration Profiles)
- Design Document: Section 5 (Security Architecture)
