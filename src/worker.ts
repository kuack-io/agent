import { Runtime, type PodSpec, type PodStatus } from "./runtime";

// Define message types for type safety
type WorkerMessage =
  | { type: "init"; payload: { registryProxyUrl: string; token: string } }
  | { type: "execute_pod"; payload: PodSpec }
  | { type: "delete_pod"; payload: { namespace: string; name: string } }
  | { type: "get_status" };

let runtime: Runtime | null = null;

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  try {
    switch (msg.type) {
      case "init": {
        const { registryProxyUrl, token } = msg.payload;
        runtime = new Runtime(registryProxyUrl, token);
        self.postMessage({ type: "initialized" });
        break;
      }

      case "execute_pod": {
        if (!runtime) {
          throw new Error("Runtime not initialized");
        }
        const podSpec = msg.payload;
        // We don't await here to allow concurrent handling if needed,
        // though JS is single threaded, async operations (fetches) allow interleaving.
        // However, we should probably catch errors.
        runtime
          .executePod(
            podSpec,
            (status: PodStatus) => {
              self.postMessage({
                type: "pod_status",
                payload: {
                  namespace: podSpec.metadata.namespace,
                  name: podSpec.metadata.name,
                  status,
                },
              });
            },
            (log: string) => {
              self.postMessage({
                type: "pod_log",
                payload: {
                  namespace: podSpec.metadata.namespace,
                  name: podSpec.metadata.name,
                  log,
                },
              });
            },
          )
          .catch((err) => {
            console.error("[Worker] Pod execution error:", err);
            self.postMessage({
              type: "pod_status",
              payload: {
                namespace: podSpec.metadata.namespace,
                name: podSpec.metadata.name,
                status: {
                  phase: "Failed",
                  message: `Internal Worker Error: ${err}`,
                },
              },
            });
          });
        break;
      }

      case "delete_pod": {
        if (!runtime) {
          throw new Error("Runtime not initialized");
        }
        const { namespace, name } = msg.payload;
        await runtime.deletePod(namespace, name);
        break;
      }

      case "get_status": {
        if (!runtime) {
          self.postMessage({ type: "status_update", payload: { runningPods: 0, executedPods: 0 } });
          return;
        }
        self.postMessage({
          type: "status_update",
          payload: {
            runningPods: runtime.getRunningPodCount(),
            executedPods: runtime.getExecutedPodCount(),
          },
        });
        break;
      }

      default:
        console.warn("[Worker] Unknown message type:", (msg as { type: string }).type);
    }
  } catch (err) {
    console.error("[Worker] Error handling message:", err);
  }
};
