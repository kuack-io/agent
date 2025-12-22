# Kuack Agent

Browser-based Kubernetes node agent that connects to kuack-node via WebSocket to execute WASM workloads.

## Overview

The Kuack Agent runs in a web browser and connects to a kuack-node server to participate in a distributed Kubernetes cluster. It executes WebAssembly (WASM) workloads using the browser's runtime environment.

## Features

- WebSocket-based connection to kuack-node
- Automatic resource detection (CPU, memory, GPU)
- WASM workload execution
- Pod lifecycle management
- Heartbeat monitoring
- Automatic reconnection with exponential backoff

## Getting Started

### Prerequisites

- Modern browser with WebSocket and WebAssembly support
- Node.js 18+ and npm for development
- A running kuack-node server

### Installation

```bash
npm install
```

### Development

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Usage

1. Start a kuack-node server (default: `ws://localhost:8080/ws`)
2. Open `index.html` in a browser or serve it via a web server
3. Enter the WebSocket URL of your kuack-node server (e.g., `ws://localhost:8080`)
4. Click "Connect" to register the agent

The agent will automatically:
- Detect available resources (CPU cores, memory, GPU support)
- Register with the kuack-node server
- Start sending heartbeats
- Execute pods assigned by the cluster

## Configuration

### Server URL Format

The agent accepts WebSocket URLs in the following formats:
- `ws://localhost:8080` (will automatically append `/ws`)
- `wss://example.com:8080` (secure WebSocket)
- `ws://localhost:8080/ws` (explicit endpoint)

The agent automatically converts HTTP/HTTPS URLs to WebSocket URLs and ensures the `/ws` endpoint is used.

### Environment Variables

None required - the agent runs entirely in the browser.

## Architecture

### Connection Layer (`connection.ts`)

Manages WebSocket connection to kuack-node:
- Establishes and maintains WebSocket connection
- Handles registration and heartbeat
- Implements automatic reconnection with exponential backoff
- Processes incoming messages from the server

### Runtime Layer (`runtime.ts`)

Executes WASM workloads:
- Downloads WASM modules from registry proxy
- Instantiates and runs WASM modules
- Manages pod lifecycle (start, stop, delete)
- Captures and reports pod logs and status

### Agent (`main.ts`)

Orchestrates the agent components:
- Coordinates connection and runtime
- Handles pod lifecycle events
- Reports pod status and logs to the server

## Protocol

The agent communicates with kuack-node using JSON messages over WebSocket:

### Message Format

```typescript
{
  type: string;
  timestamp: string; // ISO 8601
  data: unknown;
}
```

### Message Types

#### From Agent to Server

- `register`: Agent registration with resource capabilities
- `heartbeat`: Periodic health check (includes `isThrottled` flag)
- `pod_status`: Pod status updates
- `pod_logs`: Pod log output

#### From Server to Agent

- `registered`: Registration acknowledgment
- `pod_spec`: Pod specification to execute
- `pod_delete`: Request to delete a pod

## Testing

Run the test suite:

```bash
npm test
```

The test suite includes:
- Unit tests for connection management
- Unit tests for runtime execution
- Unit tests for agent orchestration
- Mock WebSocket implementations for testing

## Building

```bash
npm run build
```

Outputs to `dist/` directory.

## Docker

A Dockerfile is provided for containerized deployment:

```bash
docker build -t kuack-agent .
docker run -p 8080:8080 kuack-agent
```

## License

See LICENSE file for details.
