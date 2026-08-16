import { io } from 'socket.io-client';

class DashboardClient {
  constructor(serverUrl, onConnectChange, onDataUpdate, onMonitoringStatus, onPcMonitoringUpdate, onPcMonitoringStates) {
    this.serverUrl = serverUrl;
    this.socket = null;
    this.onConnectChange = onConnectChange;
    this.onDataUpdate = onDataUpdate;
    this.onMonitoringStatus = onMonitoringStatus;
    this.onPcMonitoringUpdate = onPcMonitoringUpdate;
    this.onPcMonitoringStates = onPcMonitoringStates;
  }

  connect() {
    if (!this.socket) {
      this.socket = io(this.serverUrl);

      this.socket.on('connect', () => {
        if (this.onConnectChange) this.onConnectChange(true);
        this.socket.emit('register', { type: 'dashboard' });
      });

      this.socket.on('disconnect', () => {
        if (this.onConnectChange) this.onConnectChange(false);
      });

      this.socket.on('dashboard-update', (data) => {
        if (this.onDataUpdate) this.onDataUpdate(data);
      });

      this.socket.on('agent-disconnect', (data) => {
        if (this.onDataUpdate) this.onDataUpdate(data);
      });

      this.socket.on('monitoring-status', (status) => {
        if (this.onMonitoringStatus) this.onMonitoringStatus(status);
      });

      this.socket.on('pc-monitoring-update', (data) => {
        if (this.onPcMonitoringUpdate) this.onPcMonitoringUpdate(data);
      });

      this.socket.on('pc-monitoring-states', (states) => {
        if (this.onPcMonitoringStates) this.onPcMonitoringStates(states);
      });
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  async renamePC(uuid, newName) {
    const res = await fetch(`${this.serverUrl}/api/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid, newName })
    });
    
    if (!res.ok) {
      throw new Error('Failed to rename PC');
    }
    return await res.json();
  }
}

export default DashboardClient;
