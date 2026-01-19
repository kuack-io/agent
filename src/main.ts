import { Connection, type Message, type ConnectionState } from "./connection";
import type { PodSpec } from "./runtime";

type WorkerOutputMessage =
  | { type: "pod_status"; payload: { namespace: string; name: string; status: unknown } }
  | { type: "pod_log"; payload: { namespace: string; name: string; log: string } }
  | { type: "status_update"; payload: { runningPods: number; executedPods: number } }
  | { type: "initialized" };

class Agent {
  private connection: Connection;
  private worker: Worker;
  private onStateChangeCallback: ((state: ConnectionState) => void) | null = null;
  private resourceInterval: number | null = null;
  private workerStatus: { runningPods: number; executedPods: number } = { runningPods: 0, executedPods: 0 };

  constructor(serverUrl: string, token: string, registryProxyUrl: string) {
    this.connection = new Connection(serverUrl, token);

    // Initialize Web Worker
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

    // Initialize worker with config
    this.worker.postMessage({
      type: "init",
      payload: { registryProxyUrl, token },
    });

    // Handle worker messages
    this.worker.onmessage = (e) => this.handleWorkerMessage(e.data);

    // Set up message handler
    this.connection.onMessage(this.handleMessage.bind(this));

    // Forward connection state changes
    this.connection.onStateChange((state) => {
      if (this.onStateChangeCallback) {
        this.onStateChangeCallback(state);
      }
    });
  }

  async start(): Promise<void> {
    console.log("[Agent] Starting Kuack Agent");
    await this.connection.connect();

    // Start periodic resource detection (every 5 seconds)
    // Silent mode to avoid console spam
    this.resourceInterval = setInterval(() => {
      this.connection.detectResources(true).catch(() => {
        // Silently fail or log only critical errors
      });
      // Also sync status from worker periodically
      this.worker.postMessage({ type: "get_status" });
    }, 5000) as unknown as number;
  }

  async stop(): Promise<void> {
    console.log("[Agent] Stopping agent");
    if (this.resourceInterval) {
      clearInterval(this.resourceInterval);
      this.resourceInterval = null;
    }
    await this.connection.disconnect();
    this.worker.terminate();
  }

  private async handleMessage(message: Message): Promise<void> {
    switch (message.type) {
      case "registered":
        // Registration acknowledgment - already handled by Connection class
        // No action needed here
        break;

      case "pod_spec":
        this.handlePodSpec(message.data as PodSpec);
        break;

      case "pod_delete":
        this.handlePodDelete(message.data as { namespace: string; name: string });
        break;

      default:
        console.warn("[Agent] Unhandled message type:", message.type);
    }
  }

  private handlePodSpec(podSpec: PodSpec): void {
    console.log("[Agent] Received pod spec:", podSpec.metadata.name);
    // Forward to worker
    this.worker.postMessage({
      type: "execute_pod",
      payload: podSpec,
    });
  }

  private handlePodDelete(data: { namespace: string; name: string }): void {
    console.log("[Agent] Received pod delete:", data.name);
    // Forward to worker
    this.worker.postMessage({
      type: "delete_pod",
      payload: data,
    });
  }

  private handleWorkerMessage(msg: WorkerOutputMessage): void {
    switch (msg.type) {
      case "pod_status":
        this.reportPodStatus(msg.payload.namespace, msg.payload.name, msg.payload.status);
        break;
      case "pod_log":
        this.reportPodLog(msg.payload.namespace, msg.payload.name, msg.payload.log);
        break;
      case "status_update":
        this.workerStatus = msg.payload;
        break;
      case "initialized":
        console.log("[Agent] Worker initialized");
        break;
      default:
      // ignore
    }
  }

  private async reportPodStatus(namespace: string, name: string, status: unknown): Promise<void> {
    const message: Message = {
      type: "pod_status",
      timestamp: new Date().toISOString(),
      data: {
        namespace,
        name,
        status,
      },
    };

    try {
      await this.connection.sendMessage(message);
    } catch (err) {
      console.error("[Agent] Failed to report pod status:", err);
    }
  }

  private async reportPodLog(namespace: string, name: string, log: string): Promise<void> {
    const message: Message = {
      type: "pod_logs",
      timestamp: new Date().toISOString(),
      data: {
        namespace,
        name,
        log,
      },
    };

    try {
      await this.connection.sendMessage(message);
    } catch (err) {
      console.error("[Agent] Failed to report pod log:", err);
    }
  }

  getStatus() {
    const resources = this.connection.getDetectedResources();
    return {
      uuid: this.connection.getUUID(),
      runningPods: this.workerStatus.runningPods,
      executedPods: this.workerStatus.executedPods,
      state: this.connection.getState(),
      cpu: resources?.cpu || null,
      memory: resources?.memory || null,
      gpu: resources?.gpu ?? null,
    };
  }

  onStateChange(callback: (state: ConnectionState) => void): void {
    this.onStateChangeCallback = callback;
  }
}

// Export for browser usage
if (typeof window !== "undefined") {
  (window as { KuackAgent?: typeof Agent }).KuackAgent = Agent;
}

export default Agent;
