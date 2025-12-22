# Kuack Agent

Browser-based Kubernetes node agent that connects to kuack-node via WebSocket to execute WASM workloads.

## Overview

The Kuack Agent runs in a web browser and connects to a kuack-node server to participate in a distributed Kubernetes cluster. It executes WebAssembly (WASM) workloads using the browser's runtime environment.

**Note:** The Agent and Node should be hosted on the same domain to avoid CORS (Cross-Origin Resource Sharing) issues. If they are on different domains, the Node server must be configured to allow CORS requests from the Agent's origin, otherwise the browser will block connections to external resources (like WASM modules).

## Deployment

### Helm

The application is packaged as Docker image to be deployed on Kubernetes using Helm.
Please refer to the [Kuack Helm Charts](https://github.com/kuack-io/helm) repository for deployment instructions.

### Static Hosting

The generated agent package consists of static files. You can download the release artifact, modify it if needed, and deploy it on any web server (Nginx, Apache, S3, GitHub Pages, etc.).

### Docker

You can also run the agent server using Docker:

```bash
docker run -p 8080:8080 ghcr.io/kuack-io/agent
```

Then access it at <http://localhost:8080>.

## Usage

1. **Open the Agent**: Open the hosted agent URL in a modern web browser (Chrome, Firefox, Safari, Edge).
2. **Connect**: Enter the WebSocket URL of your kuack-node server (e.g., `ws://localhost:8080` or `wss://kuack.example.com`).
3. **Start**: Click "Connect" to register the agent.

Once connected, the agent will automatically:

- Detect available resources (CPU, memory).
- Accept and execute WASM workloads assigned by the cluster.
