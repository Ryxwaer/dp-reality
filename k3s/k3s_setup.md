# K3s Setup Guide with Tailscale Integration

This guide describes how to set up a K3s cluster with Tailscale mesh networking on Fedora CoreOS (or similar systems).

## Prerequisites

- **Tailscale Auth Key**: A reusable auth key from your Tailscale admin console (e.g., `tskey-auth-...`).
- **Tailscale Installed**: Ensure Tailscale is installed and running on all nodes.

## 1. Server Setup

On the server node (e.g., `minisforum`):

1.  **Prepare Configuration**:
    Create `/etc/rancher/k3s/config.yaml` using the template below. Replace `<TSKEY_AUTH>` with your actual Tailscale auth key.

    ```yaml
    # /etc/rancher/k3s/config.yaml
    vpn-auth: "name=tailscale,joinKey=<TSKEY_AUTH>"
    tls-san:
      - "<HOSTNAME>"
      - "<TAILSCALE_IP>"
    node-external-ip: "<TAILSCALE_IP>"
    ```
    *(See `k3s/server.yaml` for reference)*

2.  **Install K3s Server**:
    Run the installation script. Note the `INSTALL_K3S_SKIP_SELINUX_RPM=true` flag is used for Fedora CoreOS to avoid package conflicts (as `k3s-selinux` is usually pre-layered).

    ```bash
    curl -sfL https://get.k3s.io sh -s - server
    ```

3.  **Verify & Get Token**:
    Wait for the node to be `Ready`.
    ```bash
    # Fix SELinux context if needed on CoreOS
    sudo chcon -t bin_t /usr/local/bin/k3s

    # Get the node join token
    sudo cat /var/lib/rancher/k3s/server/node-token
    ```
    *Save this token for the worker setup.*

## 2. Worker Setup

On each worker node:

1.  **Prepare Configuration**:
    Create `/etc/rancher/k3s/config.yaml`. Replace `<SERVER_GENERATED_TOKEN>` with the token from the server and `<TSKEY_AUTH>` with your Tailscale auth key.

    ```yaml
    # /etc/rancher/k3s/config.yaml
    server: "https://100.93.242.42:6443"
    token: "<SERVER_GENERATED_TOKEN>"
    vpn-auth: "name=tailscale,joinKey=<TSKEY_AUTH>"
    ```
    *(See `k3s/worker.yaml` for reference)*

2.  **Install K3s Agent**:
    ```bash
    curl -sfL https://get.k3s.io sh -s - agent
    ```

## 3. verification

On the server, check that all nodes are connected and ready:

```bash
sudo kubectl get nodes -o wide
```
