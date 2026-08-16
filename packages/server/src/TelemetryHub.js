const { Server } = require('socket.io');

class TelemetryHub {
  constructor(httpServer, configManager, alertManager) {
    this.configManager = configManager;
    this.alertManager = alertManager;
    // Server is the single source of truth for per-PC monitoring state
    this.pcMonitoringState = {};
    
    this.io = new Server(httpServer, {
      cors: { origin: '*' }
    });

    this.setupListeners();
  }

  setupListeners() {
    this.io.on('connection', (socket) => {
      console.log('A client connected:', socket.id);

      socket.on('register', (data) => {
        if (data && data.type === 'dashboard') {
          socket.join('dashboards');
          socket.emit('monitoring-status', this.configManager.config.monitoringActive !== false);
          // Fix 17: Send initial per-PC monitoring states
          socket.emit('pc-monitoring-states', this.pcMonitoringState);
        } else if (data && data.type === 'agent' && data.uuid) {
          socket.join(`agent-${data.uuid}`);
          // Fix 18: Set agentUuid on register too
          socket.agentUuid = data.uuid;
          socket.agentName = data.name || data.uuid;
          // Send the agent its stored monitoring state (if any)
          const stored = this.pcMonitoringState[data.uuid];
          if (stored !== undefined) {
            socket.emit('set-monitoring', stored);
          }
        }
      });

      socket.on('telemetry', (data) => {
        if (!data) return;
        if (data.uuid) {
          socket.agentUuid = data.uuid;
          socket.agentName = data.name;
        }
        // Fix 1: REMOVED — do NOT overwrite pcMonitoringState from agent telemetry.
        // Server is the sole authority for per-PC monitoring state.
        this.handleTelemetry(data);
      });

      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        if (socket.agentUuid) {
          const pcName = this.configManager.config.pcMapping[socket.agentUuid] || socket.agentName || socket.agentUuid;
          // Fix 3: Scope to dashboards only
          this.io.to('dashboards').emit('agent-disconnect', {
            uuid: socket.agentUuid,
            pcName,
            status: 'OFFLINE'
          });
          
          // Fix 2: Check BOTH global AND per-PC monitoring before offline alert
          const globalActive = this.configManager.config.monitoringActive !== false;
          const pcActive = this.pcMonitoringState[socket.agentUuid] !== false;
          if (globalActive && pcActive) {
            this.alertManager.processOffline(socket.agentUuid, pcName);
          }
        }
      });
    });
  }

  // Called by ServerApp when dashboard toggles a specific PC
  setPcMonitoring(uuid, active) {
    this.pcMonitoringState[uuid] = active;
    // Tell the agent
    this.io.to(`agent-${uuid}`).emit('set-monitoring', active);
    // Tell all dashboards immediately so they update
    this.io.to('dashboards').emit('pc-monitoring-update', { uuid, active });
  }

  handleTelemetry(data) {
    const pcName = this.configManager.config.pcMapping[data.uuid] || data.name || data.uuid;
    
    // Inject the server's authoritative monitoring state
    const isMonitoringActive = this.pcMonitoringState[data.uuid] !== undefined 
      ? this.pcMonitoringState[data.uuid] 
      : true;
    
    const enrichedData = { ...data, pcName, isMonitoringActive };

    // Fix 3: Scope to dashboards only
    this.io.to('dashboards').emit('dashboard-update', enrichedData);

    // Process alerts (only if both global AND per-PC monitoring is active)
    const globalActive = this.configManager.config.monitoringActive !== false;
    if (globalActive && isMonitoringActive) {
      this.alertManager.processTelemetry(data, pcName);
    }
  }
}

module.exports = TelemetryHub;
