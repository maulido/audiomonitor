import { io } from 'socket.io-client';

class DashboardClient {
  constructor(serverUrl, onConnectChange, onDataUpdate, onMonitoringStatus, onPcMonitoringUpdate, onPcMonitoringStates, onAllAgents, onAgentDeleted, onUpdateProgress, onTranscriptionStatus, onKeywordAlert) {
    this.serverUrl = serverUrl;
    this.socket = null;
    this.onConnectChange = onConnectChange;
    this.onDataUpdate = onDataUpdate;
    this.onMonitoringStatus = onMonitoringStatus;
    this.onPcMonitoringUpdate = onPcMonitoringUpdate;
    this.onPcMonitoringStates = onPcMonitoringStates;
    this.onAllAgents = onAllAgents;
    this.onAgentDeleted = onAgentDeleted;
    this.onUpdateProgress = onUpdateProgress;
    this.onTranscriptionStatus = onTranscriptionStatus;
    this.onKeywordAlert = onKeywordAlert;
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

      this.socket.on('agent-update-progress', (data) => {
        if (this.onUpdateProgress) this.onUpdateProgress(data);
      });

      this.socket.on('transcription-status', (data) => {
        if (this.onTranscriptionStatus) this.onTranscriptionStatus(data);
      });

      this.socket.on('keyword-alert', (data) => {
        if (this.onKeywordAlert) this.onKeywordAlert(data);
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
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to delete PC (${res.status})`);
    }
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
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed to rename PC (${res.status})`);
    }
    return await res.json();
  }
}

export default DashboardClient;
