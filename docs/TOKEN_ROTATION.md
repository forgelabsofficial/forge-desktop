# Token Rotation Implementation

**Task:** 4.3 Implement token rotation support in TypeScript  
**Requirements:** 2.7  
**Status:** ✅ Complete

## Overview

Token rotation allows users to re-authenticate with a device when their connection token expires, without requiring a full re-pairing process. This provides a seamless user experience while maintaining security.

## Requirements Implemented

From Requirement 2.7:

1. ✅ **Detect HTTP 401 as token expiration signal** - Implemented in `api.ts`
2. ✅ **Prompt user for re-authentication without full re-pairing** - Implemented via `ReAuthDialog` component
3. ✅ **Update stored token in keychain** - Uses `updateToken()` from `secureStorage.ts`
4. ✅ **Retry failed request with new token** - Implemented in `rawRequestWithRetry()`

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│  ┌────────────┐    ┌─────────────────┐                     │
│  │  App.tsx   │───▶│ ReAuthDialog    │                     │
│  └────────────┘    └─────────────────┘                     │
│         │                    │                               │
│         │          ┌─────────▼──────────┐                   │
│         └─────────▶│ useTokenRotation   │                   │
│                    │     (Hook)         │                   │
└────────────────────┴────────────────────┴──────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                   Service Layer                              │
│  ┌─────────────────────────┐   ┌──────────────────────┐    │
│  │ TokenRotationManager    │   │   api.ts             │    │
│  │  - rotateToken()        │◀──│   - parse()          │    │
│  │  - setReAuthCallback()  │   │   - rawRequestWithRetry()│ │
│  └─────────────────────────┘   └──────────────────────┘    │
│             │                            │                   │
│             │                            │                   │
│  ┌──────────▼──────────┐    ┌───────────▼────────────┐    │
│  │  secureStorage.ts   │    │   ConnectionProfile    │    │
│  │  - updateToken()    │    │   (Profile Management) │    │
│  └─────────────────────┘    └────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              Platform Layer (Rust/Tauri)                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Keychain Storage (store_token command)             │   │
│  │    macOS: Keychain   Windows: Credential Store      │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Flow Diagram

```
User                 App              API Layer         TokenRotationManager    Device
 │                    │                    │                      │               │
 │  Make API call     │                    │                      │               │
 ├───────────────────▶│                    │                      │               │
 │                    │  HTTP Request      │                      │               │
 │                    ├───────────────────▶│                      │               │
 │                    │                    │  Token: expired-123  │               │
 │                    │                    ├─────────────────────▶│               │
 │                    │                    │                      │  401 Unauthorized
 │                    │                    │◀─────────────────────┤               │
 │                    │                    │                      │               │
 │                    │                    │  Detect 401          │               │
 │                    │                    ├──────────────┐       │               │
 │                    │                    │  TokenExpiredError   │               │
 │                    │                    │◀─────────────┘       │               │
 │                    │                    │                      │               │
 │                    │                    │  rotateToken()       │               │
 │                    │                    ├─────────────────────▶│               │
 │                    │                    │                      │               │
 │                    │  reAuthCallback()  │                      │               │
 │                    │◀───────────────────┴──────────────────────┤               │
 │                    │                                            │               │
 │  Show Dialog       │                                            │               │
 │◀───────────────────┤                                            │               │
 │                    │                                            │               │
 │  Enter Code        │                                            │               │
 ├───────────────────▶│                                            │               │
 │                    │  confirmPairing()                          │               │
 │                    ├──────────────────────────────────────────────────────────▶│
 │                    │                                            │  New Token    │
 │                    │◀──────────────────────────────────────────────────────────┤
 │                    │                                            │               │
 │                    │  Return new token                          │               │
 │                    ├───────────────────────────────────────────▶│               │
 │                    │                                            │               │
 │                    │                    │  Update keychain      │               │
 │                    │                    │◀─────────────────────┤               │
 │                    │                    │                      │               │
 │                    │                    │  Retry request       │               │
 │                    │                    ├──────────────────────┴──────────────▶│
 │                    │                    │  Token: new-token-456                │
 │                    │                    │                      │  200 OK       │
 │                    │                    │◀─────────────────────────────────────┤
 │                    │  Response          │                      │               │
 │                    │◀───────────────────┤                      │               │
 │  Success           │                    │                      │               │
 │◀───────────────────┤                    │                      │               │
```

## Implementation Details

### 1. Token Expiration Detection (`api.ts`)

The `parse()` function detects HTTP 401 responses and throws a `TokenExpiredError`:

```typescript
function parse<T>(r: RawResponse): T {
  // Requirement 2.7: Detect HTTP 401 as token expiration signal
  if (r.status === 401) {
    throw new TokenExpiredError("Unauthorized — token may be expired");
  }
  // ... rest of error handling
}
```

### 2. Automatic Retry with Token Rotation (`api.ts`)

The `rawRequestWithRetry()` function catches `TokenExpiredError` and handles rotation:

```typescript
async function rawRequestWithRetry(
  cfg: ConnectionConfig,
  profile: ConnectionProfile | null,
  method: string,
  path: string,
  body?: unknown,
  timeoutSecs = 30
): Promise<RawResponse> {
  try {
    return await rawRequest(cfg, method, path, body, timeoutSecs);
  } catch (error) {
    if (error instanceof TokenExpiredError && profile) {
      // Rotate token (prompts user for re-authentication)
      const newToken = await tokenRotationManager.rotateToken(profile);
      
      // Update config with new token
      cfg.token = newToken;
      
      // Retry with new token
      return await rawRequest(cfg, method, path, body, timeoutSecs);
    }
    throw error;
  }
}
```

### 3. Token Rotation Manager (`services/tokenRotation.ts`)

Manages the rotation process:

- **Deduplication**: Multiple concurrent rotation requests for the same profile are deduplicated
- **Callback Pattern**: Uses a callback to prompt the user for re-authentication
- **Secure Storage**: Updates the token in the OS keychain after rotation

Key methods:
- `setReAuthenticationCallback(callback)` - Set the UI callback
- `rotateToken(profile)` - Perform token rotation
- `isRotationInProgress(profileId)` - Check rotation status

### 4. Re-Authentication Dialog (`components/ReAuthDialog.tsx`)

Modal dialog that prompts the user to:
1. Open Forge OS on their device
2. Generate a new pairing code
3. Enter the 6-digit code

Features:
- Input validation (6 digits only)
- Loading states
- Error handling
- Clear instructions

### 5. React Hook (`hooks/useTokenRotation.ts`)

React hook that:
- Sets up the re-authentication callback on mount
- Manages dialog state (show/hide)
- Provides promise resolution for the rotation process
- Cleans up on unmount

### 6. App Integration (`App.tsx`)

The main app:
- Uses `useTokenRotation()` hook
- Renders `ReAuthDialog` when token expires
- Handles success/cancel callbacks

## Usage

### For Developers

The token rotation is automatic once set up. No manual intervention needed in most code:

```typescript
import { checkStatus } from './api';

// This will automatically handle 401 and rotate token if needed
const status = await checkStatus(config, profile);
```

### For Users

When a token expires:

1. **User sees dialog**: "Token Expired - Your connection to [Device Name] has expired"
2. **User follows steps**:
   - Open Forge OS on device
   - Go to Settings → Desktop Integration
   - Tap "Generate Pairing Code"
   - Enter the 6-digit code in the dialog
3. **System handles rotation**:
   - Confirms pairing
   - Updates token in keychain
   - Retries failed request
   - User continues working seamlessly

## Testing

### Manual Testing

Run the test suite in browser console:

```javascript
// Import test module
import { runAllTests } from './services/tokenRotation.test';

// Run all tests
await runAllTests();

// Or run individual tests
await tokenRotationTests.testTokenRotationFlow();
```

### Test Coverage

Tests cover:
- ✅ Token rotation manager initialization
- ✅ Re-authentication callback setup
- ✅ Token rotation flow
- ✅ Concurrent rotation request deduplication
- ✅ 401 error detection
- ✅ Rotation in-progress tracking
- ✅ API integration

### Integration Testing

To test the full flow with a real device:

1. Connect to a device
2. Manually expire the token (edit stored token to invalid value)
3. Make an API call (e.g., check status)
4. Verify dialog appears
5. Enter valid pairing code from device
6. Verify request succeeds with new token

## Security Considerations

1. **No Plaintext Storage**: Tokens are always stored in OS keychain, never in plaintext
2. **Pairing Code Expiration**: Pairing codes expire after 5 minutes (device-side)
3. **Single Rotation**: Concurrent requests are deduplicated to prevent multiple prompts
4. **User Confirmation**: User must manually enter pairing code (no auto-rotation)

## Error Handling

### User Cancellation

If user cancels re-authentication:
- Promise rejects with "Re-authentication cancelled by user"
- Original API request fails
- User can retry the operation

### Invalid Pairing Code

If pairing code is incorrect:
- Error message displayed in dialog
- User can re-enter code
- Dialog remains open for retry

### Network Errors

If re-authentication fails due to network:
- Error displayed with retry option
- User can attempt again
- Token not updated on failure

## Future Enhancements

1. **Automatic Token Refresh**: Refresh token before expiration
2. **Biometric Auth**: Require fingerprint/face before rotating
3. **Token Expiration Preview**: Show time until expiration
4. **Rotation History**: Log of token rotations for debugging

## Files Modified/Created

### Created:
- `src/components/ReAuthDialog.tsx` - Re-authentication UI component
- `src/hooks/useTokenRotation.ts` - React hook for token rotation state
- `src/services/tokenRotation.test.ts` - Test suite
- `docs/TOKEN_ROTATION.md` - This documentation

### Modified:
- `src/App.tsx` - Integrated token rotation hook and dialog

### Pre-existing (used by implementation):
- `src/services/tokenRotation.ts` - Core rotation logic
- `src/services/secureStorage.ts` - Token storage
- `src/api.ts` - 401 detection and retry logic

## Conclusion

Token rotation is now fully implemented with:
- ✅ Automatic 401 detection
- ✅ User-friendly re-authentication flow
- ✅ Secure token storage updates
- ✅ Automatic request retry
- ✅ Comprehensive error handling
- ✅ Test coverage

The implementation satisfies all requirements from Requirement 2.7 and provides a seamless experience for users when tokens expire.
