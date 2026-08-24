/**
 * Integration example for HealthMonitor and ConnectionStatus UI
 * 
 * This demonstrates how to use the HealthMonitor service with the ConnectionStatus component
 * to monitor device health and display real-time connection information.
 * 
 * Requirements demonstrated:
 * - 3.1: Polling /api/status every 10 seconds
 * - 3.2: Tracking round-trip latency
 * - 3.3: Failure threshold detection (3 consecutive failures)
 * - 3.4: Event emission for state changes
 * - 3.5: Adaptive polling intervals based on latency
 * - 3.6: Last successful connection timestamp
 * - 3.7, 17.6: Connected clients count display
 */

import { HealthMonitor } from './healthMonitor';
import type { ConnectionConfig } from './types';

/**
 * Example: Basic HealthMonitor usage
 */
export function exampleBasicUsage() {
  console.log('=== HealthMonitor Basic Usage Example ===\n');

  const monitor = new HealthMonitor();
  
  const config: ConnectionConfig = {
    host: '192.168.1.100',
    port: 8789,
    token: 'your-auth-token-here',
  };

  // Subscribe to events (Requirement 3.4)
  monitor.addEventListener((event) => {
    const timestamp = new Date().toISOString();
    
    switch (event.type) {
      case 'connected':
        console.log(`[${timestamp}] ✓ CONNECTED (latency: ${event.latency}ms)`);
        break;
        
      case 'disconnected':
        console.log(`[${timestamp}] ✗ DISCONNECTED: ${event.reason}`);
        break;
        
      case 'high-latency':
        console.log(`[${timestamp}] ⚠ HIGH LATENCY: ${event.latency}ms (>1000ms threshold)`);
        break;
        
      case 'latency-update':
        console.log(
          `[${timestamp}] 📊 Latency: ${Math.round(event.stats.current)}ms ` +
          `(avg: ${Math.round(event.stats.average)}ms, ` +
          `min: ${Math.round(event.stats.min)}ms, ` +
          `max: ${Math.round(event.stats.max)}ms)`
        );
        break;
    }
  });

  // Start monitoring (Requirement 3.1)
  console.log('Starting health monitor...');
  monitor.start(config);
  
  console.log('Health checks will run every 10 seconds initially');
  console.log('Polling interval will adjust based on latency (Requirement 3.5):');
  console.log('  - 10s for latency <100ms');
  console.log('  - 15s for latency 100-500ms');
  console.log('  - 20s for latency >500ms\n');

  // Query state
  setTimeout(() => {
    console.log('\n--- Current State ---');
    console.log('Connection state:', monitor.getState());
    
    const stats = monitor.getLatencyStats();
    if (stats) {
      console.log('Latency stats:', {
        current: `${Math.round(stats.current)}ms`,
        average: `${Math.round(stats.average)}ms`,
        min: `${Math.round(stats.min)}ms`,
        max: `${Math.round(stats.max)}ms`,
      });
    }
    
    const lastCheck = monitor.getLastSuccessfulCheck();
    if (lastCheck) {
      const secondsAgo = Math.floor((Date.now() - lastCheck) / 1000);
      console.log('Last successful check:', `${secondsAgo} seconds ago`);
    }
    
    console.log('Connected clients:', monitor.getConnectedClientsCount());
  }, 15000);

  // Stop after 30 seconds for demo
  setTimeout(() => {
    console.log('\n--- Stopping Monitor ---');
    monitor.stop();
    console.log('Health monitor stopped');
  }, 30000);

  return monitor;
}

/**
 * Example: Demonstrating failure detection
 * 
 * Shows how the monitor detects connection failures and emits disconnected event
 * after 3 consecutive failures (Requirement 3.3)
 */
export function exampleFailureDetection() {
  console.log('=== HealthMonitor Failure Detection Example ===\n');

  const monitor = new HealthMonitor();
  
  // Use invalid config to simulate failures
  const config: ConnectionConfig = {
    host: '192.168.1.999', // Invalid IP
    port: 8789,
    token: 'test-token',
  };

  let failureCount = 0;

  monitor.addEventListener((event) => {
    const timestamp = new Date().toISOString();
    
    if (event.type === 'disconnected') {
      console.log(`[${timestamp}] ✗ DISCONNECTED after ${failureCount} failures`);
      console.log(`   Reason: ${event.reason}`);
      console.log('   Expected: 3 consecutive failures (Requirement 3.3)');
      
      // Verify requirement
      if (failureCount === 3) {
        console.log('   ✓ Requirement 3.3 satisfied: Disconnected after 3 failures');
      }
      
      monitor.stop();
    }
  });

  console.log('Starting monitor with invalid host (will fail)...');
  console.log('Expected: Disconnected event after 3 consecutive failures\n');
  
  monitor.start(config);

  // Monitor internal state
  const checkInterval = setInterval(() => {
    failureCount++;
    console.log(`Health check attempt ${failureCount}...`);
    
    if (monitor.getState() === 'disconnected') {
      clearInterval(checkInterval);
    }
  }, 10000);

  return monitor;
}

/**
 * Example: Adaptive polling intervals
 * 
 * Demonstrates how polling interval adjusts based on network latency (Requirement 3.5)
 */
export function exampleAdaptivePolling() {
  console.log('=== HealthMonitor Adaptive Polling Example ===\n');

  const monitor = new HealthMonitor();
  
  const config: ConnectionConfig = {
    host: '192.168.1.100',
    port: 8789,
    token: 'your-token-here',
  };

  console.log('Monitoring polling interval adjustments based on latency:\n');
  console.log('Rules (Requirement 3.5):');
  console.log('  - Average latency <100ms  → 10s interval');
  console.log('  - Average latency 100-500ms → 15s interval');
  console.log('  - Average latency >500ms   → 20s interval\n');

  let lastInterval = 10000;
  let checkCount = 0;

  monitor.addEventListener((event) => {
    if (event.type === 'latency-update') {
      checkCount++;
      const stats = event.stats;
      
      // Determine expected interval based on average latency
      let expectedInterval: number;
      if (stats.average < 100) {
        expectedInterval = 10000;
      } else if (stats.average < 500) {
        expectedInterval = 15000;
      } else {
        expectedInterval = 20000;
      }

      if (expectedInterval !== lastInterval) {
        console.log(
          `Interval adjusted: ${lastInterval}ms → ${expectedInterval}ms ` +
          `(avg latency: ${Math.round(stats.average)}ms)`
        );
        lastInterval = expectedInterval;
      }

      console.log(
        `Check ${checkCount}: ${Math.round(stats.current)}ms ` +
        `(avg: ${Math.round(stats.average)}ms) - using ${expectedInterval}ms interval`
      );
    }
  });

  monitor.start(config);

  // Stop after 2 minutes
  setTimeout(() => {
    console.log('\nStopping monitor...');
    monitor.stop();
  }, 120000);

  return monitor;
}

/**
 * Example: React component integration
 * 
 * Shows how to integrate HealthMonitor with ConnectionStatus React component
 */
export function exampleReactIntegration() {
  console.log('=== React Component Integration Example ===\n');

  console.log('To use HealthMonitor with ConnectionStatus component:\n');
  
  console.log('1. Create HealthMonitor instance:');
  console.log('   const healthMonitor = new HealthMonitor();');
  console.log('');
  
  console.log('2. Start monitoring after connection:');
  console.log('   healthMonitor.start(connectionConfig);');
  console.log('');
  
  console.log('3. Render ConnectionStatus component:');
  console.log('   <ConnectionStatus healthMonitor={healthMonitor} />');
  console.log('');
  
  console.log('The ConnectionStatus component will display:');
  console.log('  ✓ Connection state badge (Connected/Disconnected/Connecting)');
  console.log('  ✓ Current latency with moving average');
  console.log('  ✓ Last successful connection timestamp (relative time)');
  console.log('  ✓ High latency warning when >1000ms');
  console.log('  ✓ Count of other connected clients\n');
  
  console.log('Example App.tsx integration:');
  console.log('```typescript');
  console.log('import { HealthMonitor } from "./healthMonitor";');
  console.log('import ConnectionStatus from "./components/ConnectionStatus";');
  console.log('');
  console.log('function App() {');
  console.log('  const [healthMonitor] = useState(() => new HealthMonitor());');
  console.log('  const [config, setConfig] = useState<ConnectionConfig | null>(null);');
  console.log('');
  console.log('  useEffect(() => {');
  console.log('    if (config) {');
  console.log('      healthMonitor.start(config);');
  console.log('      return () => healthMonitor.stop();');
  console.log('    }');
  console.log('  }, [config, healthMonitor]);');
  console.log('');
  console.log('  return (');
  console.log('    <div>');
  console.log('      <ConnectionStatus healthMonitor={healthMonitor} />');
  console.log('      {/* Rest of your app */}');
  console.log('    </div>');
  console.log('  );');
  console.log('}');
  console.log('```');
}

/**
 * Run all examples
 */
export function runAllExamples() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     HealthMonitor Integration Examples - Task 5           ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Show React integration instructions
  exampleReactIntegration();
  
  console.log('\n' + '='.repeat(60) + '\n');
  
  // Note: Uncomment to run live examples (requires running device)
  // exampleBasicUsage();
  // exampleFailureDetection();
  // exampleAdaptivePolling();
  
  console.log('To run live examples:');
  console.log('1. Start a Forge OS device on the network');
  console.log('2. Update the host/token in the examples above');
  console.log('3. Uncomment the example function calls');
  console.log('4. Run: npm run dev\n');
}

// Export for use in console or other modules
if (typeof window !== 'undefined') {
  (window as any).healthMonitorExamples = {
    basic: exampleBasicUsage,
    failure: exampleFailureDetection,
    adaptive: exampleAdaptivePolling,
    react: exampleReactIntegration,
    all: runAllExamples,
  };
}
