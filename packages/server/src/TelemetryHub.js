const { Server } = require('socket.io');

class TelemetryHub {
  constructor(httpServer, configManager, alertManager) {
    this.configManager = configManager;
    this.alertManager = alertManager;
    
    this.io = new Server(httpServer, {
      cors: { origin: '*' }
    });

    this.setupListeners();
  }

  setupListeners() {
    this.io.on('connection', (socket) => {
      console.log('A client connected:', socket.id);

      socket.on('telemetry', (data) => {
        // Map socket id to uuid so we know who disconnects later
        if (data.uuid) {
          socket.agentUuid = data.uuid;
        }
        this.handleTelemetry(data);
      });

      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        if (socket.agentUuid) {
          const pcName = this.configManager.getPcName(socket.agentUuid);
          this.io.emit('agent-disconnect', {
            uuid: socket.agentUuid,
            pcName,
            status: 'OFFLINE'
          });
          
          // Optionally notify telegram that an agent went offline
          this.alertManager.processOffline(socket.agentUuid, pcName);
        }
      });
    });
  }

  handleTelemetry(data) {
    // Determine the readable PC Name
    const pcName = this.configManager.getPcName(data.uuid);
    const enrichedData = { ...data, pcName };

    // Broadcast to dashboard
    this.io.emit('dashboard-update', enrichedData);

    // Process alerts
    this.alertManager.processTelemetry(data, pcName);
  }
}

module.exports = TelemetryHub;
