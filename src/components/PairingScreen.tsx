import { useState, useRef, useEffect } from "react";
import { initiatePairing, confirmPairing } from "../api";
import { ConnectionManager } from "../connectionManager";
import type { ConnectionProfile } from "../connectionManager";

interface DiscoveredDevice {
  id: string;
  name: string;
  host: string;
  port: number;
  model?: string;
  version?: string;
}

interface Props {
  onPairingComplete: (profile: ConnectionProfile) => void;
  onCancel: () => void;
  discoveredDevices?: DiscoveredDevice[];
}

type PairingState =
  | "select-device"
  | "initiating"
  | "entering-code"
  | "confirming"
  | "success"
  | "error";

export default function PairingScreen({
  onPairingComplete,
  onCancel,
  discoveredDevices = [],
}: Props) {
  const [state, setState] = useState<PairingState>("select-device");
  const [selectedDevice, setSelectedDevice] = useState<DiscoveredDevice | null>(
    null
  );
  const [manualHost, setManualHost] = useState("");
  const [manualPort, setManualPort] = useState("8789");
  const [pairingCode, setPairingCode] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [deviceMetadata, setDeviceMetadata] = useState<{
    model: string;
    androidVersion: string;
    forgeOsVersion: string;
  } | null>(null);

  // Refs for code input auto-focus
  const codeInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Auto-select first discovered device if available
  useEffect(() => {
    if (discoveredDevices.length > 0 && !selectedDevice) {
      setSelectedDevice(discoveredDevices[0]);
    }
  }, [discoveredDevices, selectedDevice]);

  // Auto-focus first code input when entering code state
  useEffect(() => {
    if (state === "entering-code" && codeInputRefs.current[0]) {
      codeInputRefs.current[0].focus();
    }
  }, [state]);

  const handleInitiatePairing = async () => {
    setError("");
    setState("initiating");

    try {
      const host = selectedDevice?.host || manualHost.trim();
      const port = selectedDevice?.port || parseInt(manualPort, 10) || 8789;

      if (!host) {
        throw new Error("Please select a device or enter an IP address");
      }

      // Get desktop name (you could make this configurable)
      const desktopName =
        window.navigator?.userAgent?.includes("Windows")
          ? "Windows Desktop"
          : window.navigator?.userAgent?.includes("Mac")
          ? "Mac Desktop"
          : "Desktop";

      await initiatePairing(host, port, desktopName);

      // Pairing initiated successfully - now wait for user to enter code
      setState("entering-code");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("select-device");
    }
  };

  const handleCodeInput = (index: number, value: string) => {
    // Only allow digits
    if (value && !/^\d$/.test(value)) {
      return;
    }

    const newCode = [...pairingCode];
    newCode[index] = value;
    setPairingCode(newCode);

    // Auto-advance to next input
    if (value && index < 5) {
      codeInputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all digits entered
    if (index === 5 && value) {
      const fullCode = newCode.join("");
      if (fullCode.length === 6) {
        handleConfirmPairing(fullCode);
      }
    }
  };

  const handleCodeKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    // Handle backspace - move to previous input
    if (e.key === "Backspace" && !pairingCode[index] && index > 0) {
      codeInputRefs.current[index - 1]?.focus();
    }
  };

  const handleCodePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData("text").trim();

    // Check if it's a 6-digit code
    if (/^\d{6}$/.test(pastedText)) {
      const digits = pastedText.split("");
      setPairingCode(digits);
      // Focus last input
      codeInputRefs.current[5]?.focus();
      // Auto-submit
      setTimeout(() => handleConfirmPairing(pastedText), 100);
    }
  };

  const handleConfirmPairing = async (code: string) => {
    setError("");
    setState("confirming");

    try {
      const host = selectedDevice?.host || manualHost.trim();
      const port = selectedDevice?.port || parseInt(manualPort, 10) || 8789;
      const desktopId = crypto.randomUUID();

      const result = await confirmPairing(host, port, code, desktopId);

      // Store device metadata for success display
      setDeviceMetadata({
        model: result.deviceMetadata.model,
        androidVersion: result.deviceMetadata.androidVersion,
        forgeOsVersion: result.deviceMetadata.forgeOsVersion,
      });

      // Create connection profile
      const profile = ConnectionManager.createProfile({
        name: selectedDevice?.name || `Device ${host}`,
        deviceId: result.deviceId,
        host,
        port,
        token: result.token,
        connectionMethod: "tcp",
        deviceMetadata: result.deviceMetadata,
      });

      setState("success");

      // Wait a moment to show success, then complete
      setTimeout(() => {
        onPairingComplete(profile);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("entering-code");
      // Clear code inputs
      setPairingCode(["", "", "", "", "", ""]);
      codeInputRefs.current[0]?.focus();
    }
  };

  const handleRetry = () => {
    setError("");
    setPairingCode(["", "", "", "", "", ""]);
    setState("select-device");
    setSelectedDevice(null);
    setDeviceMetadata(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-forge-bg">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="text-3xl font-bold tracking-tight">
            Pair New <span className="text-forge-accent">Device</span>
          </div>
          <p className="mt-2 text-sm text-forge-muted">
            {state === "select-device" &&
              "Select a device or enter connection details"}
            {state === "initiating" && "Initiating pairing with device..."}
            {state === "entering-code" &&
              "Enter the 6-digit code shown on your device"}
            {state === "confirming" && "Confirming pairing..."}
            {state === "success" && "Pairing successful!"}
          </p>
        </div>

        <div className="space-y-4 rounded-xl border border-forge-border bg-forge-panel p-6">
          {/* Device Selection */}
          {state === "select-device" && (
            <>
              {discoveredDevices.length > 0 && (
                <div>
                  <label className="mb-2 block text-xs font-medium text-forge-muted">
                    Discovered Devices
                  </label>
                  <div className="space-y-2">
                    {discoveredDevices.map((device) => (
                      <button
                        key={device.id}
                        onClick={() => setSelectedDevice(device)}
                        className={`w-full rounded-lg border px-4 py-3 text-left transition ${
                          selectedDevice?.id === device.id
                            ? "border-forge-accent bg-forge-accent/10"
                            : "border-forge-border bg-forge-bg hover:border-forge-accent/50"
                        }`}
                      >
                        <div className="font-medium text-sm">{device.name}</div>
                        <div className="text-xs text-forge-muted mt-0.5">
                          {device.host}:{device.port}
                          {device.model && ` • ${device.model}`}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(discoveredDevices.length === 0 || selectedDevice === null) && (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-forge-muted">
                      Device IP Address
                    </label>
                    <input
                      value={manualHost}
                      onChange={(e) => setManualHost(e.target.value)}
                      placeholder="192.168.1.42"
                      className="w-full rounded-lg border border-forge-border bg-forge-bg px-3 py-2 text-sm outline-none focus:border-forge-accent"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-forge-muted">
                      Port
                    </label>
                    <input
                      value={manualPort}
                      onChange={(e) => setManualPort(e.target.value)}
                      placeholder="8789"
                      inputMode="numeric"
                      className="w-full rounded-lg border border-forge-border bg-forge-bg px-3 py-2 text-sm outline-none focus:border-forge-accent"
                    />
                  </div>
                </>
              )}

              {error && (
                <div className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              )}

              <button
                onClick={handleInitiatePairing}
                disabled={
                  !selectedDevice &&
                  (!manualHost.trim() || !manualPort.trim())
                }
                className="w-full rounded-lg bg-forge-accent px-3 py-2 text-sm font-semibold text-black transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Initiate Pairing
              </button>

              <button
                onClick={onCancel}
                className="w-full rounded-lg border border-forge-border bg-forge-bg px-3 py-2 text-sm font-medium text-forge-muted transition hover:text-forge-text"
              >
                Cancel
              </button>
            </>
          )}

          {/* Loading State - Initiating */}
          {state === "initiating" && (
            <div className="py-8 text-center">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-forge-border border-t-forge-accent"></div>
              <p className="mt-4 text-sm text-forge-muted">
                Contacting device...
              </p>
            </div>
          )}

          {/* Code Entry */}
          {state === "entering-code" && (
            <>
              <div className="py-4">
                <div className="flex justify-center gap-2">
                  {pairingCode.map((digit, index) => (
                    <input
                      key={index}
                      ref={(el) => {
                        codeInputRefs.current[index] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleCodeInput(index, e.target.value)}
                      onKeyDown={(e) => handleCodeKeyDown(index, e)}
                      onPaste={handleCodePaste}
                      className="h-14 w-12 rounded-lg border-2 border-forge-border bg-forge-bg text-center text-2xl font-bold outline-none transition focus:border-forge-accent"
                      aria-label={`Digit ${index + 1}`}
                    />
                  ))}
                </div>
              </div>

              {error && (
                <div className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                  {error}
                  <button
                    onClick={handleRetry}
                    className="ml-2 underline hover:text-red-200"
                  >
                    Retry
                  </button>
                </div>
              )}

              <div className="text-center text-xs text-forge-muted">
                Check your device screen for the 6-digit code
              </div>

              <button
                onClick={handleRetry}
                className="w-full rounded-lg border border-forge-border bg-forge-bg px-3 py-2 text-sm font-medium text-forge-muted transition hover:text-forge-text"
              >
                Back
              </button>
            </>
          )}

          {/* Loading State - Confirming */}
          {state === "confirming" && (
            <div className="py-8 text-center">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-forge-border border-t-forge-accent"></div>
              <p className="mt-4 text-sm text-forge-muted">
                Confirming pairing code...
              </p>
            </div>
          )}

          {/* Success State */}
          {state === "success" && (
            <div className="py-8 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
                <svg
                  className="h-8 w-8 text-green-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <div className="text-lg font-semibold text-forge-text">
                Pairing Successful!
              </div>
              {deviceMetadata && (
                <div className="mt-4 space-y-1 text-sm text-forge-muted">
                  <div>
                    <span className="font-medium">Device:</span>{" "}
                    {deviceMetadata.model}
                  </div>
                  <div>
                    <span className="font-medium">Android:</span>{" "}
                    {deviceMetadata.androidVersion}
                  </div>
                  <div>
                    <span className="font-medium">Forge OS:</span>{" "}
                    {deviceMetadata.forgeOsVersion}
                  </div>
                </div>
              )}
              <p className="mt-4 text-xs text-forge-muted">
                Connecting to device...
              </p>
            </div>
          )}
        </div>

        {/* Help Text */}
        {state === "select-device" && (
          <p className="mt-4 text-center text-[11px] leading-relaxed text-forge-muted">
            Ensure your device has the Forge OS pairing feature enabled
            <br />
            and both devices are on the same network
          </p>
        )}
      </div>
    </div>
  );
}
