/**
 * Unit tests for Secure Storage Service
 * 
 * Note: These are manual test examples. The actual Tauri commands can only
 * be tested in the Tauri app runtime. These tests demonstrate the expected
 * behavior and can be adapted for a test framework like Vitest if installed.
 * 
 * To run with vitest:
 * 1. Install: npm install -D vitest @vitest/ui
 * 2. Add to package.json scripts: "test": "vitest"
 * 3. Uncomment the vitest imports below
 * 4. Run: npm test
 */

// Uncomment these for vitest:
// import { describe, it, expect, vi, beforeEach } from 'vitest';
// import { invoke } from '@tauri-apps/api/core';

import { storeToken, getToken, deleteToken, hasToken, updateToken } from './secureStorage';

/**
 * Manual test examples for secure storage
 * These demonstrate the API but require a running Tauri app to execute
 */

/**
 * Test: Store a token
 */
export async function testStoreToken() {
  console.log('=== Test: Store Token ===\n');

  const profileId = 'test-profile-' + Date.now();
  const token = 'test-token-123';

  try {
    await storeToken(profileId, token);
    console.log('✓ Token stored successfully');
    console.log(`  Profile ID: ${profileId}`);
    console.log(`  Token: ${token.slice(0, 10)}...`);
    
    // Clean up
    await deleteToken(profileId);
    console.log('✓ Cleanup completed');
  } catch (error) {
    console.error('✗ Test failed:', error);
  }

  console.log('\n=== Test Complete ===\n');
}

/**
 * Test: Retrieve a token
 */
export async function testGetToken() {
  console.log('=== Test: Get Token ===\n');

  const profileId = 'test-profile-' + Date.now();
  const token = 'test-token-456';

  try {
    // Store first
    await storeToken(profileId, token);
    console.log('Setup: Token stored');

    // Retrieve
    const retrieved = await getToken(profileId);
    
    if (retrieved === token) {
      console.log('✓ Token retrieved successfully');
      console.log(`  Retrieved: ${retrieved.slice(0, 10)}...`);
    } else {
      console.error('✗ Token mismatch');
      console.error(`  Expected: ${token}`);
      console.error(`  Got: ${retrieved}`);
    }
    
    // Clean up
    await deleteToken(profileId);
    console.log('✓ Cleanup completed');
  } catch (error) {
    console.error('✗ Test failed:', error);
  }

  console.log('\n=== Test Complete ===\n');
}

/**
 * Test: Delete a token
 */
export async function testDeleteToken() {
  console.log('=== Test: Delete Token ===\n');

  const profileId = 'test-profile-' + Date.now();
  const token = 'test-token-789';

  try {
    // Store first
    await storeToken(profileId, token);
    console.log('Setup: Token stored');

    // Delete
    await deleteToken(profileId);
    console.log('✓ Token deleted successfully');

    // Verify deletion
    const exists = await hasToken(profileId);
    if (!exists) {
      console.log('✓ Token confirmed deleted (does not exist)');
    } else {
      console.error('✗ Token still exists after deletion');
    }
  } catch (error) {
    console.error('✗ Test failed:', error);
  }

  console.log('\n=== Test Complete ===\n');
}

/**
 * Test: Check if token exists
 */
export async function testHasToken() {
  console.log('=== Test: Has Token ===\n');

  const profileId = 'test-profile-' + Date.now();
  const token = 'test-token-abc';

  try {
    // Check non-existent token
    const existsBefore = await hasToken(profileId);
    if (!existsBefore) {
      console.log('✓ Correctly reports non-existent token');
    } else {
      console.error('✗ False positive: token reported as existing');
    }

    // Store token
    await storeToken(profileId, token);
    console.log('Setup: Token stored');

    // Check existing token
    const existsAfter = await hasToken(profileId);
    if (existsAfter) {
      console.log('✓ Correctly reports existing token');
    } else {
      console.error('✗ False negative: token not reported as existing');
    }

    // Clean up
    await deleteToken(profileId);
    console.log('✓ Cleanup completed');
  } catch (error) {
    console.error('✗ Test failed:', error);
  }

  console.log('\n=== Test Complete ===\n');
}

/**
 * Test: Update a token
 */
export async function testUpdateToken() {
  console.log('=== Test: Update Token ===\n');

  const profileId = 'test-profile-' + Date.now();
  const oldToken = 'old-token-123';
  const newToken = 'new-token-456';

  try {
    // Store initial token
    await storeToken(profileId, oldToken);
    console.log('Setup: Initial token stored');

    // Update token
    await updateToken(profileId, newToken);
    console.log('✓ Token updated successfully');

    // Verify update
    const retrieved = await getToken(profileId);
    if (retrieved === newToken) {
      console.log('✓ Token update verified');
      console.log(`  Old: ${oldToken.slice(0, 10)}...`);
      console.log(`  New: ${newToken.slice(0, 10)}...`);
    } else {
      console.error('✗ Token update failed');
      console.error(`  Expected: ${newToken}`);
      console.error(`  Got: ${retrieved}`);
    }

    // Clean up
    await deleteToken(profileId);
    console.log('✓ Cleanup completed');
  } catch (error) {
    console.error('✗ Test failed:', error);
  }

  console.log('\n=== Test Complete ===\n');
}

/**
 * Test: Error handling
 */
export async function testErrorHandling() {
  console.log('=== Test: Error Handling ===\n');

  try {
    // Try to get non-existent token
    try {
      await getToken('non-existent-profile');
      console.error('✗ Should have thrown error for non-existent token');
    } catch (error) {
      console.log('✓ Correctly throws error for non-existent token');
      console.log(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Try to delete non-existent token
    try {
      await deleteToken('non-existent-profile');
      console.log('✓ Delete handles non-existent token gracefully');
    } catch (error) {
      console.log('✓ Delete throws error for non-existent token');
      console.log(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  } catch (error) {
    console.error('✗ Test failed:', error);
  }

  console.log('\n=== Test Complete ===\n');
}

/**
 * Run all tests
 */
export async function runAllSecureStorageTests() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║       Secure Storage Service Test Suite                  ║');
  console.log('║       Note: Requires Tauri runtime to execute            ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  await testStoreToken();
  await testGetToken();
  await testDeleteToken();
  await testHasToken();
  await testUpdateToken();
  await testErrorHandling();

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║         All Tests Complete                                ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
}

// Export for use in browser console
if (typeof window !== 'undefined') {
  (window as any).secureStorageTests = {
    runAll: runAllSecureStorageTests,
    testStoreToken,
    testGetToken,
    testDeleteToken,
    testHasToken,
    testUpdateToken,
    testErrorHandling,
  };
}
