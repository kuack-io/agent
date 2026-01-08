/**
 * WebSocket Connection Manager for Agent
 */

export interface Message {
  type: string;
  timestamp: string;
  data: unknown;
}

export interface RegisterData {
  uuid: string;
  browserId: string;
  cpu: string;
  memory: string;
  gpu: boolean;
  labels: Record<string, string>;
  token: string;
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

export class Connection {
  private socket: WebSocket | null = null;
  private uuid: string;
  private browserId: string;
  private serverUrl: string;
  private token: string;
  private reconnectDelay = 200;
  private maxReconnectDelay = 3000;
  private heartbeatInterval: number;
  private heartbeatTimer: number | null = null;
  private onMessageCallback: ((msg: Message) => void) | null = null;
  private onStateChangeCallback: ((state: ConnectionState) => void) | null = null;
  private isConnecting = false;
  private shouldReconnect = true;
  private hasConnectedOnce = false; // Track if we've ever successfully connected
  private currentState: ConnectionState = "disconnected";
  private detectedResources: {
    cpu: string;
    memory: string;
    gpu: boolean;
    labels: Record<string, string>;
  } | null = null;

  // WebSocket close code for duplicate browser connection
  // Using 4001 (in the 4000-4999 range reserved for libraries/frameworks)
  private static readonly CLOSE_CODE_DUPLICATE_BROWSER = 4001;

  constructor(serverUrl: string, token: string, heartbeatInterval: number = 15000) {
    this.serverUrl = this.convertToWebSocketUrl(serverUrl);
    this.token = token;
    this.uuid = this.generateUUID();
    this.browserId = this.getOrCreateBrowserId();
    this.heartbeatInterval = heartbeatInterval;
  }

  private convertToWebSocketUrl(url: string): string {
    // Convert http:// or https:// to ws:// or wss://
    // If already ws:// or wss://, keep it as-is
    let wsUrl = url;
    if (url.startsWith("http:")) {
      wsUrl = url.replace(/^http:/, "ws:");
    } else if (url.startsWith("https:")) {
      wsUrl = url.replace(/^https:/, "wss:");
    }

    // Remove trailing slash
    wsUrl = wsUrl.replace(/\/$/, "");

    return wsUrl;
  }

  async connect(): Promise<void> {
    if (this.isConnecting || (this.socket && this.socket.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;
    this.setState("connecting");

    try {
      console.log(`[Agent] Connecting to ${this.serverUrl}`);

      // Create WebSocket connection with custom header for token
      // Note: WebSocket constructor doesn't support custom headers in browsers
      // We'll send the token in the first message (register) instead
      this.socket = new WebSocket(this.serverUrl);

      // Wait for connection to open
      await new Promise<void>((resolve, reject) => {
        if (!this.socket) {
          reject(new Error("Socket creation failed"));
          return;
        }

        const timeout = setTimeout(() => {
          if (this.socket) {
            this.socket.close();
          }
          reject(new Error(`Connection timeout after 10 seconds to ${this.serverUrl}`));
        }, 10000);

        this.socket.onopen = () => {
          clearTimeout(timeout);
          console.log("[Agent] WebSocket connection established");
          this.hasConnectedOnce = true;
          resolve();
        };

        this.socket.onerror = (_event) => {
          clearTimeout(timeout);
          // WebSocket error events don't have a message property
          // Create a proper Error object with a descriptive message
          const error = new Error(`WebSocket connection failed to ${this.serverUrl}`);
          reject(error);
        };
      });

      // Set up message handler
      this.socket.onmessage = (event) => {
        try {
          const message: Message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (err) {
          console.error("[Agent] Failed to parse message:", err);
        }
      };

      // Handle connection closure
      this.socket.onclose = (event) => {
        this.socket = null;
        this.isConnecting = false;

        // Stop heartbeat timer immediately when connection closes
        if (this.heartbeatTimer) {
          clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = null;
        }

        // Check if this was a duplicate browser connection closure
        if (event.code === Connection.CLOSE_CODE_DUPLICATE_BROWSER) {
          console.log("[Agent] Connection closed: Another tab from the same browser connected. Stopping reconnection.");
          this.shouldReconnect = false;
          this.setState("disconnected");
          return;
        }

        console.log(`[Agent] Connection closed (code: ${event.code}, reason: ${event.reason || "none"})`);

        if (this.shouldReconnect) {
          this.setState("reconnecting");
          this.handleDisconnect();
        } else {
          this.setState("disconnected");
        }
      };

      // Register with the server
      await this.register();

      // Start heartbeat
      this.startHeartbeat();

      this.isConnecting = false;
      this.setState("connected");
    } catch (error) {
      console.error("[Agent] Failed to connect:", error);
      this.socket = null;
      this.isConnecting = false;
      // Only auto-reconnect if we've successfully connected before
      // On initial connection failure, always throw the error
      if (this.shouldReconnect && this.hasConnectedOnce) {
        this.handleDisconnect();
      } else {
        throw error;
      }
    }
  }

  private async register(): Promise<void> {
    const resources = await this.detectResources();

    // Store detected resources for UI display
    this.detectedResources = {
      cpu: resources.cpu,
      memory: resources.memory,
      gpu: resources.gpu,
      labels: resources.labels,
    };

    const registerMsg: Message = {
      type: "register",
      timestamp: new Date().toISOString(),
      data: {
        uuid: this.uuid,
        browserId: this.browserId,
        cpu: resources.cpu,
        memory: resources.memory,
        gpu: resources.gpu,
        labels: resources.labels,
        token: this.token,
      } as RegisterData,
    };

    await this.sendMessage(registerMsg);
    console.log("[Agent] Registration sent:", { ...(registerMsg.data as RegisterData), token: "***" });

    // Wait for acknowledgment (registered message)
    // The acknowledgment will be handled by the message handler
  }

  public async detectResources(silent: boolean = false) {
    // CPU: navigator.hardwareConcurrency returns logical CPU cores available to the browser
    // This represents the number of logical CPU cores on the system
    // IMPORTANT: This is shared across ALL browser tabs/processes, not per-tab
    // Browsers don't expose per-tab CPU allocation, so this is the best we can do
    // The actual CPU available to this tab depends on:
    // - Total system CPU cores
    // - Number of other active tabs/processes
    // - Browser's process model (single vs multi-process)
    // - OS scheduling
    const cpuCores = navigator.hardwareConcurrency;
    if (!cpuCores || cpuCores < 1) {
      throw new Error("Unable to detect CPU cores - hardwareConcurrency not available");
    }
    if (!silent) {
      console.log(
        `[Agent] Detected CPU cores: ${cpuCores} (via navigator.hardwareConcurrency - this is total logical cores, shared across all browser tabs)`,
      );
    }

    // Memory: Try multiple methods to get accurate memory information
    let memoryGB: number | undefined;

    // Method 1: performance.memory (Chrome/Edge) - jsHeapSizeLimit is the max JS heap size
    // This represents the maximum memory the browser will allocate for JavaScript per tab/origin
    // This is the MOST ACCURATE method as it reflects actual browser limits
    if ("memory" in performance) {
      const perfMemory = (
        performance as {
          memory?: {
            jsHeapSizeLimit?: number;
            totalJSHeapSize?: number;
            usedJSHeapSize?: number;
          };
        }
      ).memory;
      if (perfMemory?.jsHeapSizeLimit) {
        // Convert bytes to GB (jsHeapSizeLimit is in bytes)
        // Round to 1 decimal place for accuracy
        memoryGB = Math.round((perfMemory.jsHeapSizeLimit / (1024 * 1024 * 1024)) * 10) / 10;
        if (!silent) {
          const limitGB = (perfMemory.jsHeapSizeLimit / (1024 * 1024 * 1024)).toFixed(2);
          const usedGB = perfMemory.usedJSHeapSize
            ? (perfMemory.usedJSHeapSize / (1024 * 1024 * 1024)).toFixed(2) + " GB"
            : "N/A";
          const totalGB = perfMemory.totalJSHeapSize
            ? (perfMemory.totalJSHeapSize / (1024 * 1024 * 1024)).toFixed(2) + " GB"
            : "N/A";
          console.log(
            `[Agent] Detected memory from performance.memory: ${memoryGB}GB (JS heap limit: ${limitGB} GB, used: ${usedGB}, total: ${totalGB})`,
          );
        }
      }
    }

    // Method 2: navigator.deviceMemory (total device memory, not per-tab)
    // This is less accurate as it's total device memory, not available to this specific tab
    // Browsers typically limit JS heap to 2-4GB per tab regardless of device memory
    // Use conservative estimates based on typical browser JS heap limits
    if (!memoryGB && "deviceMemory" in navigator) {
      const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory;
      if (deviceMemory && deviceMemory > 0) {
        // Conservative estimates based on typical browser JS heap limits:
        // - Most browsers cap JS heap at ~2-4GB per tab/origin
        // - This is independent of total device memory
        if (deviceMemory <= 2) {
          // Very small devices: use most of available memory
          memoryGB = Math.max(0.5, deviceMemory * 0.8);
        } else if (deviceMemory <= 4) {
          // Small devices: typical browser JS heap limit is ~2GB
          memoryGB = 2;
        } else if (deviceMemory <= 8) {
          // Medium devices: typical browser JS heap limit is ~2-4GB
          memoryGB = Math.min(4, Math.max(2, deviceMemory * 0.5));
        } else {
          // Large devices: browsers typically cap JS heap at ~4GB per tab
          // Some browsers may allow up to 8GB in certain configurations
          memoryGB = 4;
        }
        if (!silent) {
          console.log(
            `[Agent] Estimated memory from deviceMemory: ${memoryGB}GB (device total: ${deviceMemory}GB, using conservative browser JS heap limit)`,
          );
        }
      }
    }

    // If still no memory info, we can't proceed - don't use arbitrary defaults
    if (!memoryGB || memoryGB < 0.1) {
      throw new Error(
        "Unable to detect available memory - memory APIs not available. Please use a modern browser (Chrome/Edge recommended for accurate memory detection via performance.memory).",
      );
    }

    // GPU: Get detailed GPU information if available
    const gpuInfo = await this.detectGPU();

    // Check if page is currently throttled (hidden/background)
    const isThrottled = document.hidden;

    return {
      cpu: `${cpuCores * 1000}m`, // Convert to millicores
      memory: `${memoryGB}Gi`,
      gpu: gpuInfo.supported,
      labels: {
        browser: this.getBrowserName(),
        gpu: String(gpuInfo.supported),
        gpuAdapter: gpuInfo.adapterInfo || "unknown",
        throttled: String(isThrottled),
      },
    };
  }

  private async detectGPU(): Promise<{ supported: boolean; adapterInfo?: string }> {
    try {
      if (!navigator.gpu) {
        return { supported: false };
      }

      // Suppress browser console warnings for experimental WebGPU
      // The browser may log warnings, but we handle errors gracefully
      const adapter = await navigator.gpu.requestAdapter().catch(() => null);
      if (!adapter) {
        return { supported: false };
      }

      // Try to get adapter info if available (WebGPU - requestAdapterInfo may require user activation)
      let adapterInfo: string | undefined;
      try {
        // requestAdapterInfo() is available in some browsers but may require user activation
        if ("requestAdapterInfo" in adapter) {
          const info = await (
            adapter as {
              requestAdapterInfo?: () => Promise<{ vendor?: string; architecture?: string; device?: string }>;
            }
          )
            .requestAdapterInfo?.()
            .catch(() => null);
          if (info) {
            const parts: string[] = [];
            if (info.vendor) parts.push(`vendor:${info.vendor}`);
            if (info.architecture) parts.push(`arch:${info.architecture}`);
            if (info.device) parts.push(`device:${info.device}`);
            adapterInfo = parts.length > 0 ? parts.join(",") : "available";
          } else {
            adapterInfo = "available";
          }
        } else {
          // Adapter is available but info API not supported
          adapterInfo = "available";
        }
      } catch {
        // requestAdapterInfo may fail due to user activation requirement or other reasons
        // But adapter is still available
        adapterInfo = "available";
      }

      return { supported: true, adapterInfo };
    } catch {
      // WebGPU is experimental and may not be available on all platforms
      // Silently return false - no need to log warnings for expected failures
      return { supported: false };
    }
  }

  private getBrowserName(): string {
    const userAgent = navigator.userAgent;
    if (userAgent.includes("Firefox")) return "firefox";
    if (userAgent.includes("Edge") || userAgent.includes("Edg")) return "edge";
    if (userAgent.includes("Chrome")) return "chrome";
    if (userAgent.includes("Safari")) return "safari";
    return "unknown";
  }

  private generateUUID(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Gets or creates a persistent browser ID stored in localStorage.
   * This ID persists across tabs in the same browser instance,
   * allowing the server to enforce "one agent per browser" policy.
   * Incognito tabs have separate localStorage, so they will get separate IDs.
   */
  private getOrCreateBrowserId(): string {
    const STORAGE_KEY = "kuack-browser-id";

    try {
      // Try to get existing browser ID from localStorage
      const existingId = localStorage.getItem(STORAGE_KEY);
      if (existingId) {
        console.log(`[Agent] Using existing browser ID: ${existingId}`);
        return existingId;
      }

      // Generate new browser ID if none exists
      const newId = this.generateUUID();
      localStorage.setItem(STORAGE_KEY, newId);
      console.log(`[Agent] Generated new browser ID: ${newId}`);
      return newId;
    } catch (err) {
      // localStorage might be unavailable (e.g., in some privacy modes)
      // Fall back to generating a new UUID each time (not ideal, but better than failing)
      console.warn("[Agent] localStorage unavailable, using session-only browser ID:", err);
      return this.generateUUID();
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = window.setInterval(async () => {
      // Check if connection is still open before sending heartbeat
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        // Connection is closed, stop the heartbeat timer
        if (this.heartbeatTimer) {
          clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = null;
        }
        return;
      }

      const isThrottled = document.hidden; // Page Visibility API

      // Re-detect resources on each heartbeat to reflect current availability
      // This ensures we report accurate resources even if browser throttling changes
      let resources;
      try {
        resources = await this.detectResources();
      } catch (err) {
        console.error("[Agent] Failed to detect resources for heartbeat:", err);
        // Fallback to basic heartbeat without resource info
        const heartbeatMsg: Message = {
          type: "heartbeat",
          timestamp: new Date().toISOString(),
          data: {
            uuid: this.uuid,
            isThrottled: isThrottled,
          },
        };
        this.sendMessage(heartbeatMsg).catch((err) => {
          console.error("[Agent] Failed to send heartbeat:", err);
        });
        return;
      }

      const heartbeatMsg: Message = {
        type: "heartbeat",
        timestamp: new Date().toISOString(),
        data: {
          uuid: this.uuid,
          isThrottled: isThrottled,
          cpu: resources.cpu,
          memory: resources.memory,
          gpu: resources.gpu,
        },
      };

      this.sendMessage(heartbeatMsg).catch((err) => {
        console.error("[Agent] Failed to send heartbeat:", err);
      });
    }, this.heartbeatInterval);
  }

  private handleMessage(message: Message): void {
    console.log("[Agent] Received message:", message.type);

    if (message.type === "registered") {
      console.log("[Agent] Received acknowledgment:", message.data);
    }

    if (this.onMessageCallback) {
      this.onMessageCallback(message);
    }

    switch (message.type) {
      case "pod_spec":
        // Will be handled by runtime module
        break;
      case "pod_delete":
        // Will be handled by runtime module
        break;
      default:
        // Don't warn for registered message
        if (message.type !== "registered") {
          console.warn("[Agent] Unknown message type:", message.type);
        }
    }
  }

  async sendMessage(message: Message): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }

    this.socket.send(JSON.stringify(message));
  }

  onMessage(callback: (msg: Message) => void): void {
    this.onMessageCallback = callback;
  }

  onStateChange(callback: (state: ConnectionState) => void): void {
    this.onStateChangeCallback = callback;
  }

  getState(): ConnectionState {
    return this.currentState;
  }

  private setState(state: ConnectionState): void {
    if (this.currentState !== state) {
      this.currentState = state;
      if (this.onStateChangeCallback) {
        this.onStateChangeCallback(state);
      }
    }
  }

  private handleDisconnect(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Exponential backoff reconnect
    setTimeout(() => {
      if (this.shouldReconnect) {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
        this.connect();
      }
    }, this.reconnectDelay);
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.hasConnectedOnce = false;
    this.setState("disconnected");

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  getUUID(): string {
    return this.uuid;
  }

  getDetectedResources(): { cpu: string; memory: string; gpu: boolean; labels: Record<string, string> } | null {
    return this.detectedResources;
  }
}
