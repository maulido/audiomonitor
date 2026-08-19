import { io } from 'socket.io-client';

class DashboardClient {
  constructor(serverUrl, onConnectChange, onDataUpdate, onMonitoringStatus, onPcMonitoringUpdate, onPcMonitoringStates, onAllAgents, onAgentDeleted) {
    this.serverUrl = serverUrl;
    this.socket = null;
    this.onConnectChange = onConnectChange;
    this.onDataUpdate = onDataUpdate;
    this.onMonitoringStatus = onMonitoringStatus;
    this.onPcMonitoringUpdate = onPcMonitoringUpdate;
    this.onPcMonitoringStates = onPcMonitoringStates;
    this.onAllAgents = onAllAgents;
    this.onAgentDeleted = onAgentDeleted;
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

      this.socket.on('all-agents-state', (data) => {
          if (this.onAllAgents) this.onAllAgents(data);
        });

        this.socket.on('agent-deleted', (uuid) => {
          if (this.onAgentDeleted) this.onAgentDeleted(uuid);
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

  async deletePC(uuid, pin) {
    const res = await fetch(`${this.serverUrl}/api/pc/${uuid}`, {
      method: 'DELETE',
      headers: { 'x-pin': pin }
    });
    if (!res.ok) throw new Error('Failed to delete PC');
  }

  async renamePC(uuid, newName, pin) {
    const res = await fetch(`${this.serverUrl}/api/rename`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-pin': pin
      },
      body: JSON.stringify({ uuid, newName })
    });
    
    if (!res.ok) {
      throw new Error('Failed to rename PC');
    }
    return await res.json();
  }
}

export default DashboardClient;
