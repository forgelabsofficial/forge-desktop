/**
 * ConnectionStatus - Connection status UI component
 * 
 * Displays:
 * - Connection state badge with color coding (Requirement 3.2)
 * - Current latency with moving average (Requirement 3.5)
 * - Last successful connection timestamp (Requirement 3.6)
 * - Warning indicator when latency exceeds 1000ms (Requirement 3.7)
 * - Count of other connected clients (Requirement 17.6)
 * 
 * Requirements: 3.2, 3.5, 3.6, 3.7, 17.6
 */

import { useState, useEffect } from 'react';
import { HealthMonitor, type ConnectionState, type LatencyStats } from '../healthMonitor';

interface ConnectionStatusProps {
  healthMonitor: HealthMonitor;
}

/**
 * Format timestamp as relative time (e.g., "2 minutes ago")
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return seconds === 1 ? '1 second ago' : `${seconds} seconds ago`;
  } else if (minutes < 60) {
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  } else if (hours < 24) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  } else {
    return days === 1 ? '1 day ago' : `${days} days ago`;
  }
}

/**
 * ConnectionStatus component
 */
export default function ConnectionStatus({ healthMonitor }: ConnectionStatusProps) {
  const [state, setState] = useState<ConnectionState>(healthMonitor.getState());
  const [latencyStats, setLatencyStats] = useState<LatencyStats | null>(
    healthMonitor.getLatencyStats()
  );
  const [lastCheck, setLastCheck] = useState<number | null>(
    healthMonitor.getLastSuccessfulCheck()
  );
  const [connectedClients, setConnectedClients] = useState<number>(
    healthMonitor.getConnectedClientsCount()
  );
  const [showHighLatencyWarning, setShowHighLatencyWarning] = useState(false);

  // Update relative time every second
  const [, setTick] = useState(0);

  useEffect(() => {
    // Subscribe to health monitor events
    const handleEvent = (event: any) => {
      switch (event.type) {
        case 'connected':
          setState('connected');
          setLastCheck(Date.now());
          break;

        case 'disconnected':
          setState('disconnected');
          break;

        case 'latency-update':
          setLatencyStats(event.stats);
          setLastCheck(healthMonitor.getLastSuccessfulCheck());
          setConnectedClients(healthMonitor.getConnectedClientsCount());
          break;

        case 'high-latency':
          setShowHighLatencyWarning(true);
          // Hide warning after 5 seconds
          setTimeout(() => setShowHighLatencyWarning(false), 5000);
          break;
      }
    };

    healthMonitor.addEventListener(handleEvent);

    // Update relative time every second
    const timer = setInterval(() => {
      setTick(prev => prev + 1);
    }, 1000);

    return () => {
      healthMonitor.removeEventListener(handleEvent);
      clearInterval(timer);
    };
  }, [healthMonitor]);

  // Get badge color and text based on state
  const getBadgeStyles = () => {
    switch (state) {
      case 'connected':
        return {
          bgColor: 'bg-green-500/10',
          textColor: 'text-green-500',
          dotColor: 'bg-green-500',
          label: 'Connected',
        };
      case 'disconnected':
        return {
          bgColor: 'bg-red-500/10',
          textColor: 'text-red-500',
          dotColor: 'bg-red-500',
          label: 'Disconnected',
        };
      case 'connecting':
        return {
          bgColor: 'bg-yellow-500/10',
          textColor: 'text-yellow-500',
          dotColor: 'bg-yellow-500',
          label: 'Connecting',
        };
    }
  };

  const badgeStyles = getBadgeStyles();

  return (
    <div className="flex items-center gap-4 text-sm">
      {/* Connection State Badge - Requirement 3.2 */}
      <div
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 ${badgeStyles.bgColor}`}
      >
        <span className={`inline-block h-2 w-2 rounded-full ${badgeStyles.dotColor}`} />
        <span className={`text-xs font-medium ${badgeStyles.textColor}`}>
          {badgeStyles.label}
        </span>
      </div>

      {/* Latency Display - Requirement 3.5 */}
      {latencyStats && state === 'connected' && (
        <div className="flex items-center gap-1.5 text-xs text-forge-muted">
          <span className="font-medium">Latency:</span>
          <span>
            {Math.round(latencyStats.current)}ms
            <span className="text-forge-muted/60">
              {' '}
              (avg: {Math.round(latencyStats.average)}ms)
            </span>
          </span>
          
          {/* High Latency Warning - Requirement 3.7 */}
          {(latencyStats.current > 1000 || showHighLatencyWarning) && (
            <span
              className="inline-flex items-center gap-1 rounded bg-orange-500/10 px-1.5 py-0.5 text-orange-500"
              title="High latency detected"
            >
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span className="font-medium">High</span>
            </span>
          )}
        </div>
      )}

      {/* Last Successful Check - Requirement 3.6 */}
      {lastCheck && state === 'connected' && (
        <div className="text-xs text-forge-muted">
          <span className="font-medium">Last check:</span>{' '}
          {formatRelativeTime(lastCheck)}
        </div>
      )}

      {/* Connected Clients Count - Requirement 17.6 */}
      {state === 'connected' && connectedClients > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-forge-muted">
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          <span>
            {connectedClients} {connectedClients === 1 ? 'client' : 'clients'}
          </span>
        </div>
      )}
    </div>
  );
}
