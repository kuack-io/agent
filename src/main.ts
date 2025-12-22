import { Connection, type Message, type ConnectionState } from "./connection";
import { Runtime, type PodSpec } from "./runtime";

class Agent {
  private connection: Connection;
  private runtime: Runtime;
  private onStateChangeCallback: ((state: ConnectionState) => void) | null = null;

  constructor(serverUrl: string, registryProxyUrl: string) {
    this.connection = new Connection(serverUrl);
    this.runtime = new Runtime(registryProxyUrl);

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
  }

  async stop(): Promise<void> {
    console.log("[Agent] Stopping agent");
    await this.connection.disconnect();
  }

  private async handleMessage(message: Message): Promise<void> {
    switch (message.type) {
      case "registered":
        // Registration acknowledgment - already handled by Connection class
        // No action needed here
        break;

      case "pod_spec":
        await this.handlePodSpec(message.data as PodSpec);
        break;

      case "pod_delete":
        await this.handlePodDelete(message.data as { namespace: string; name: string });
        break;

      default:
        console.warn("[Agent] Unhandled message type:", message.type);
    }
  }

  private async handlePodSpec(podSpec: PodSpec): Promise<void> {
    console.log("[Agent] Received pod spec:", podSpec.metadata.name);

    // Execute pod and report status updates
    await this.runtime.executePod(
      podSpec,
      (status) => this.reportPodStatus(podSpec, status),
      (log) => this.reportPodLog(podSpec, log),
    );
  }

  private async handlePodDelete(data: { namespace: string; name: string }): Promise<void> {
    console.log("[Agent] Received pod delete:", data.name);
    await this.runtime.deletePod(data.namespace, data.name);
  }

  private async reportPodStatus(podSpec: PodSpec, status: unknown): Promise<void> {
    const message: Message = {
      type: "pod_status",
      timestamp: new Date().toISOString(),
      data: {
        namespace: podSpec.metadata.namespace,
        name: podSpec.metadata.name,
        status,
      },
    };

    try {
      await this.connection.sendMessage(message);
    } catch (err) {
      console.error("[Agent] Failed to report pod status:", err);
    }
  }

  private async reportPodLog(podSpec: PodSpec, log: string): Promise<void> {
    const message: Message = {
      type: "pod_logs",
      timestamp: new Date().toISOString(),
      data: {
        namespace: podSpec.metadata.namespace,
        name: podSpec.metadata.name,
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
      runningPods: this.runtime.getRunningPodCount(),
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
