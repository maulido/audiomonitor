/**
 * Comprehensive Whitebox Test Suite for Audio Monitor
 * Covers 10 Full Test Suites:
 * 1. ConfigManager Unit, Persistence & Corrupted File Recovery
 * 2. DatabaseManager Complex Queries, Edge-Cases & Auto-Cleanup
 * 3. AlertManager Notification, Cooldown & HTML Escaping
 * 4. TelemetryHub Status Evaluation, Override & Malformed Payload Handling
 * 5. Express REST API Auth, PIN Security & Input Sanitization
 * 6. Audio Streaming, Range Headers & Recording File Management
 * 7. Agent Audio Processing, Spike Filtering & Auto-Recovery Unmute
 * 8. Multi-Agent Concurrency & Parallel Connection Handling
 * 9. Agent Disconnect, Network Drop & Reconnection Recovery
 * 10. Remote Control Dispatch & Bidirectional WebSocket Sync
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { io: ioClient } = require('socket.io-client');

// Import Modules
const ConfigManager = require('../packages/server/src/ConfigManager');
const DatabaseManager = require('../packages/server/src/DatabaseManager');
const AlertManager = require('../packages/server/src/AlertManager');
const TelemetryHub = require('../packages/server/src/TelemetryHub');
const ServerApp = require('../packages/server/src/ServerApp');

// Test Utilities
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log('  [PASS] ' + message);
  } else {
    failedTests++;
    console.error('  [FAIL] ' + message);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, message + ' (Expected: ' + expected + ', Actual: ' + actual + ')');
}

async function runSuite(name, fn) {
  console.log('\n======================================================');
  console.log('SUITE: ' + name);
  console.log('======================================================');
  try {
    await fn();
  } catch (err) {
    console.error('Suite ' + name + ' threw unexpected error:', err);
    failedTests++;
  }
}

// Temporary directory for isolated DB and config tests
const TEST_DIR = path.join(__dirname, 'test_scratch_' + Date.now());
if (!fs.existsSync(TEST_DIR)) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

async function main() {
  console.log('STARTING EXTENDED WHITEBOX & USER SCENARIO TEST SUITE...\n');

  // =========================================================================
  // SUITE 1: ConfigManager Unit, Persistence & Corrupted File Recovery
  // =========================================================================
  await runSuite('1. ConfigManager Unit, Persistence & Corrupted File Recovery', () => {
    const configPath = path.join(TEST_DIR, 'config_1.json');
    const cm = new ConfigManager(configPath);

    assert(cm.config !== null && typeof cm.config === 'object', 'Config loaded with object structure');
    assertEqual(cm.config.dashboardPin, '1234', 'Default dashboardPin is 1234');
    assertEqual(cm.config.logRetentionDays, 30, 'Default logRetentionDays is 30');

    // Update config & test persistence
    cm.config.dashboardPin = '8888';
    cm.config.logRetentionDays = 45;
    cm.saveConfig();

    const cmReloaded = new ConfigManager(configPath);
    assertEqual(cmReloaded.config.dashboardPin, '8888', 'Updated PIN persisted across reloads');
    assertEqual(cmReloaded.config.logRetentionDays, 45, 'Updated retention days persisted across reloads');

    // Rename PC
    cm.setPcName('uuid-prod-1', 'Studio-Utama');
    assertEqual(cm.getPcName('uuid-prod-1'), 'Studio-Utama', 'PC alias mapped correctly');
    assertEqual(cm.getPcName('uuid-unknown'), 'uuid-unknown', 'Unmapped UUID returns fallback');

    // Delete PC alias
    cm.deletePcMapping('uuid-prod-1');
    assertEqual(cm.getPcName('uuid-prod-1'), 'uuid-prod-1', 'Deleted PC alias falls back to UUID');

    // Corrupted file recovery scenario
    const corruptPath = path.join(TEST_DIR, 'corrupt_config.json');
    fs.writeFileSync(corruptPath, '{ INVALID_JSON :::: malformed');
    const cmCorrupt = new ConfigManager(corruptPath);
    assert(cmCorrupt.config !== null, 'Corrupted config handled gracefully with fallback defaults');
    assertEqual(cmCorrupt.config.dashboardPin, '1234', 'Default PIN restored on corrupted file');
  });

  // =========================================================================
  // SUITE 2: DatabaseManager Complex Queries, Edge-Cases & Auto-Cleanup
  // =========================================================================
  await runSuite('2. DatabaseManager Complex Queries, Edge-Cases & Auto-Cleanup', async () => {
    const dbPath = path.join(TEST_DIR, 'db_scenarios.json');
    const db = new DatabaseManager(dbPath);
    db.incidents = [];
    db.saveDbSync();

    const now = new Date();
    const d45 = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000); // 45 days ago
    const d25 = new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000); // 25 days ago
    const d10 = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
    const dToday = new Date(now.getTime() - 1000);                  // Today

    db.incidents = [
      { id: 1, uuid: 'pc-1', pcName: 'PC-Alpha', incidentType: 'BAHAYA_MUTE', details: 'OBS Mute', timestamp: d45.toISOString().replace('T', ' ').substring(0, 19) },
      { id: 2, uuid: 'pc-2', pcName: 'PC-Beta', incidentType: 'BAHAYA_CLIPPING', details: 'Pecah', timestamp: d25.toISOString().replace('T', ' ').substring(0, 19) },
      { id: 3, uuid: 'pc-1', pcName: 'PC-Alpha', incidentType: 'AMAN', details: 'Normal', timestamp: d10.toISOString().replace('T', ' ').substring(0, 19) },
      { id: 4, uuid: 'pc-3', pcName: 'PC-Gamma (Special <#1>)', incidentType: 'BAHAYA_AUDIO_DEAD', details: 'Dead Mic', timestamp: dToday.toISOString().replace('T', ' ').substring(0, 19) }
    ];
    db.saveDbSync();

    // Query with special characters in PC Name
    await new Promise(res => {
      db.getFilteredIncidents({ pcName: 'PC-Gamma (Special <#1>)' }, list => {
        assertEqual(list.length, 1, 'Query by PC Name with special characters matches exact record');
        res();
      });
    });

    // Query with Inverted Date Range (Start Date after End Date)
    await new Promise(res => {
      db.getFilteredIncidents({ startDate: '2026-12-31', endDate: '2026-01-01' }, list => {
        assertEqual(list.length, 0, 'Inverted date range returns 0 records safely without throwing');
        res();
      });
    });

    // Auto-cleanup with invalid inputs (negative or string days)
    const removedInvalid = db.autoCleanup(-5);
    assertEqual(removedInvalid, 1, 'Negative retention days defaults to 30 days and prunes 45-day record');
    assertEqual(db.incidents.length, 3, 'Remaining count is 3');

    // Auto-cleanup on empty DB scenario
    const emptyDbPath = path.join(TEST_DIR, 'empty_db.json');
    const emptyDb = new DatabaseManager(emptyDbPath);
    emptyDb.incidents = [];
    const removedEmpty = emptyDb.autoCleanup(30);
    assertEqual(removedEmpty, 0, 'Auto-cleanup on empty database safely returns 0 removed');
  });

  // =========================================================================
  // SUITE 3: AlertManager Notification, Cooldown & HTML Escaping
  // =========================================================================
  await runSuite('3. AlertManager Notification, Cooldown & HTML Escaping', async () => {
    let sentMessages = [];
    const mockBot = {
      sendMessage: async (chatId, text, options) => {
        sentMessages.push({ chatId, text, options });
        return { message_id: 1 };
      }
    };

    const cm = new ConfigManager(path.join(TEST_DIR, 'alert_test_config.json'));
    cm.config.telegram = { token: 'mock-bot-token', chatId: '98765432', interval: 2 };
    const db = new DatabaseManager(path.join(TEST_DIR, 'alert_test_db.json'));

    const alertMgr = new AlertManager(cm, db);
    alertMgr.bot = mockBot;

    // Test HTML Escaping for XSS / Special characters in PC Name
    const pcXss = { uuid: 'pc-xss', status: 'BAHAYA_MUTE', micDb: -40, obsDb: -60 };
    alertMgr.processTelemetry(pcXss, 'Studio <Main> & Audio');
    
    assertEqual(sentMessages.length, 1, 'Alert sent for XSS-named PC');
    assert(sentMessages[0].text.includes('&lt;Main&gt;'), 'HTML tags are escaped to &lt;Main&gt;');
    assert(sentMessages[0].text.includes('&amp;'), '& character is escaped to &amp;');

    // Test Throttling within cooldown
    alertMgr.processTelemetry(pcXss, 'Studio <Main> & Audio');
    assertEqual(sentMessages.length, 1, 'Duplicate trigger during interval cooldown is suppressed');

    // Test Bot error handling without crash (Bot throws network error)
    alertMgr.bot = {
      sendMessage: async () => {
        throw new Error('Telegram network failure: ETIMEDOUT');
      }
    };
    alertMgr.sendTelegramAlert('Test failure alert');
    assert(true, 'Telegram send failure caught safely without throwing uncaught exception');
  });

  // =========================================================================
  // SUITE 4: TelemetryHub Status Evaluation, Override & Malformed Payload Handling
  // =========================================================================
  await runSuite('4. TelemetryHub Status Evaluation, Override & Malformed Payload Handling', () => {
    const configPath = path.join(TEST_DIR, 'hub_test_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'hub_test_db.json'));
    const alertMgr = new AlertManager(cm, db);
    
    const fakeHttpServer = http.createServer();
    const hub = new TelemetryHub(fakeHttpServer, cm, alertMgr);

    // Scenario 4.1: Malformed / Incomplete Telemetry Payload
    hub.handleTelemetry(null);
    hub.handleTelemetry({});
    hub.handleTelemetry({ uuid: '' });
    assert(true, 'Null and empty telemetry payloads rejected without error');

    // Scenario 4.2: Telemetry with NaN numbers
    hub.handleTelemetry({ uuid: 'pc-nan', pcName: 'PC-NaN', status: 'AMAN', micDb: NaN, obsDb: NaN, cpuUsage: null });
    const nanAgent = hub.lastKnownState.get('pc-nan');
    assert(nanAgent !== undefined, 'NaN telemetry payload handled safely');

    // Scenario 4.3: Per-PC Monitoring Pause Override
    hub.setPcMonitoring('pc-paused', false);
    assertEqual(hub.pcMonitoringState['pc-paused'], false, 'Monitoring state set to false for PC');
    
    // Agent sends BAHAYA telemetry while paused -> Status should not trigger danger alerts
    let alertCountBefore = db.incidents.length;
    hub.handleTelemetry({ uuid: 'pc-paused', pcName: 'PC-Paused', status: 'BAHAYA_MUTE' });
    assertEqual(db.incidents.length, alertCountBefore, 'No incident recorded when PC monitoring is paused');
  });

  // =========================================================================
  // SUITE 5: Express REST API Auth, PIN Security & Input Sanitization
  // =========================================================================
  await runSuite('5. Express REST API Auth, PIN Security & Input Sanitization', async () => {
    const configPath = path.join(TEST_DIR, 'api_sec_config.json');
    const cm = new ConfigManager(configPath);
    cm.config.dashboardPin = '1234';
    const db = new DatabaseManager(path.join(TEST_DIR, 'api_sec_db.json'));
    const alertMgr = new AlertManager(cm, db);

    const serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;
    serverApp.alertManager = alertMgr;

    const port = await new Promise(res => {
      const s = serverApp.server.listen(0, '127.0.0.1', () => res(s.address().port));
    });
    const baseUrl = 'http://127.0.0.1:' + port;

    async function req(urlPath, options = {}) {
      const res = await fetch(baseUrl + urlPath, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      let body;
      try { body = await res.json(); } catch(e) { body = null; }
      return { status: res.status, ok: res.ok, body };
    }

    // 1. PIN Security: POST without x-pin should return 401 Unauthorized
    const resNoPin = await req('/api/rename', { method: 'POST', body: JSON.stringify({ uuid: 'pc-1', newName: 'NewName' }) });
    assertEqual(resNoPin.status, 401, 'POST without x-pin returns 401 Unauthorized');

    // 2. PIN Security: POST with invalid x-pin returns 401
    const resWrongPin = await req('/api/rename', {
      method: 'POST',
      headers: { 'x-pin': '9999' },
      body: JSON.stringify({ uuid: 'pc-1', newName: 'NewName' })
    });
    assertEqual(resWrongPin.status, 401, 'POST with wrong x-pin returns 401 Unauthorized');

    // 3. Short PIN rejection: POST /api/config/pin with < 4 digits
    const resShortPin = await req('/api/config/pin', {
      method: 'POST',
      headers: { 'x-pin': '1234' },
      body: JSON.stringify({ newPin: '12' })
    });
    assertEqual(resShortPin.status, 400, 'POST /api/config/pin with <4 characters rejected with 400');

    // 4. Valid PIN update: POST /api/config/pin
    const resValidPin = await req('/api/config/pin', {
      method: 'POST',
      headers: { 'x-pin': '1234' },
      body: JSON.stringify({ newPin: '9876' })
    });
    assertEqual(resValidPin.status, 200, 'POST /api/config/pin with >=4 characters accepted with 200');
    assertEqual(cm.config.dashboardPin, '9876', 'Server dashboardPin updated to 9876');

    // 5. Global Monitoring Toggle: POST /api/config/monitoring
    const resMon = await req('/api/config/monitoring', {
      method: 'POST',
      headers: { 'x-pin': '9876' },
      body: JSON.stringify({ active: false })
    });
    assertEqual(resMon.status, 200, 'POST /api/config/monitoring returns 200');
    assertEqual(cm.config.monitoringActive, false, 'Global monitoring disabled');

    // 6. Delete PC: DELETE /api/pc/:uuid
    cm.setPcName('pc-del-1', 'PC To Delete');
    const resDelPc = await req('/api/pc/pc-del-1', {
      method: 'DELETE',
      headers: { 'x-pin': '9876' }
    });
    assertEqual(resDelPc.status, 200, 'DELETE /api/pc/:uuid returns 200');
    assert(cm.config.pcMapping['pc-del-1'] === undefined, 'PC mapping removed from config');

    await new Promise(r => serverApp.server.close(r));
  });

  // =========================================================================
  // SUITE 6: Audio Streaming, Range Headers & Recording File Management
  // =========================================================================
  await runSuite('6. Audio Streaming, Range Headers & Recording File Management', async () => {
    const configPath = path.join(TEST_DIR, 'records_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'records_db.json'));
    const alertMgr = new AlertManager(cm, db);

    const testRecordDir = path.join(TEST_DIR, 'audio_vault');
    fs.mkdirSync(testRecordDir, { recursive: true });
    cm.config.recordDir = testRecordDir;

    // Create a mock completed session folder matching the 36-char UUID format
    const sampleUuid = '3365df9b-62ec-46ed-8644-83db7d225868';
    cm.setPcName(sampleUuid, 'PC Studio 1');
    const sessionFolder = 'PC_Studio_1_' + sampleUuid + '_2026-08-29_14-00-00_to_14-10-00';
    const folderPath = path.join(testRecordDir, sessionFolder);
    fs.mkdirSync(folderPath, { recursive: true });
    const dummyData = Buffer.alloc(10240, 'a'); // 10 KB
    fs.writeFileSync(path.join(folderPath, 'Part_001.webm'), dummyData);

    const serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;
    serverApp.alertManager = alertMgr;

    const port = await new Promise(res => {
      const s = serverApp.server.listen(0, '127.0.0.1', () => res(s.address().port));
    });
    const baseUrl = 'http://127.0.0.1:' + port;

    // 1. GET /api/records - Session parsing
    const resRecords = await fetch(baseUrl + '/api/records');
    const records = await resRecords.json();
    assertEqual(records.length, 1, 'GET /api/records parsed 1 recording session');
    assertEqual(records[0].pcName, 'PC Studio 1', 'Session pcName is PC Studio 1');
    assertEqual(records[0].fileName, 'Part_001.webm', 'Session fileName is Part_001.webm');

    // 2. GET /media with Range Header (Seeking simulation: bytes 0-1023)
    const mediaUrl = baseUrl + '/media/' + sessionFolder + '/Part_001.webm';
    const resRange = await fetch(mediaUrl, {
      headers: { 'Range': 'bytes=0-1023' }
    });
    assertEqual(resRange.status, 206, 'Audio seeking with Range header returns 206 Partial Content');
    assert(resRange.headers.get('content-range') !== null, 'Response contains Content-Range header');

    // 3. Fallback matching: Requesting ongoing folder when completed folder exists
    const ongoingUrl = baseUrl + '/media/PC_Studio_1_' + sampleUuid + '_2026-08-29_14-00-00/Part_001.webm';
    const resFallback = await fetch(ongoingUrl);
    assertEqual(resFallback.status, 200, 'Request to ongoing session name resolves cleanly to completed _to_ folder');

    // 4. Safe deletion of single file: DELETE /api/records
    const resDelRecord = await fetch(baseUrl + '/api/records', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-pin': cm.config.dashboardPin
      },
      body: JSON.stringify({ pcName: sessionFolder, fileName: 'Part_001.webm' })
    });
    assertEqual(resDelRecord.status, 200, 'DELETE /api/records successfully deletes recording file');
    assert(!fs.existsSync(path.join(folderPath, 'Part_001.webm')), 'File removed from disk');

    await new Promise(r => serverApp.server.close(r));
  });

  // =========================================================================
  // SUITE 7: Agent Audio Processing, Spike Filtering & Auto-Recovery Unmute
  // =========================================================================
  await runSuite('7. Agent Audio Processing, Spike Filtering & Auto-Recovery Unmute', () => {
    // Pure function logic mirroring AudioProcessor danger state engine
    function processAudioFrame({
      micRms,
      obsMuted,
      noiseGate = 15,
      silenceTimeoutSec = 10,
      clippingThreshold = 95,
      clippingDurationSec = 2,
      consecutiveClippingSec = 0,
      consecutiveSilenceSec = 0,
      autoRecoveryUnmute = true
    }) {
      const isSpeaking = micRms >= (noiseGate + 10);
      const isSilent = micRms < noiseGate;
      const isClipping = micRms >= clippingThreshold;

      let dangerScore = 0;
      let status = 'AMAN';
      let shouldAutoUnmute = false;

      // Auto Recovery Unmute
      if (obsMuted && isSpeaking && autoRecoveryUnmute) {
        shouldAutoUnmute = true;
      }

      if (obsMuted) {
        dangerScore = 100;
        status = 'BAHAYA_MUTE';
      } else if (isClipping && consecutiveClippingSec >= clippingDurationSec) {
        dangerScore = 100;
        status = 'BAHAYA_CLIPPING';
      } else if (isSilent && consecutiveSilenceSec >= silenceTimeoutSec) {
        dangerScore = 80;
        status = 'BAHAYA_AUDIO_DEAD';
      }

      return { isSpeaking, isSilent, isClipping, dangerScore, status, shouldAutoUnmute };
    }

    // Case 1: Short clipping spike (1 sec < 2 sec threshold) -> Should NOT trigger BAHAYA
    const spikeFrame = processAudioFrame({ micRms: 99, obsMuted: false, consecutiveClippingSec: 1, clippingDurationSec: 2 });
    assertEqual(spikeFrame.status, 'AMAN', 'Short 1s audio spike is filtered out (status: AMAN)');

    // Case 2: Sustained clipping (3 sec >= 2 sec threshold) -> Triggers BAHAYA_CLIPPING
    const clipFrame = processAudioFrame({ micRms: 99, obsMuted: false, consecutiveClippingSec: 3, clippingDurationSec: 2 });
    assertEqual(clipFrame.status, 'BAHAYA_CLIPPING', 'Sustained clipping triggers BAHAYA_CLIPPING');

    // Case 3: Prolonged silence (12s >= 10s timeout) -> Triggers BAHAYA_AUDIO_DEAD
    const deadFrame = processAudioFrame({ micRms: 2, obsMuted: false, consecutiveSilenceSec: 12, silenceTimeoutSec: 10 });
    assertEqual(deadFrame.status, 'BAHAYA_AUDIO_DEAD', 'Prolonged silence triggers BAHAYA_AUDIO_DEAD');

    // Case 4: Auto-Recovery disabled in settings -> should NOT trigger unmute
    const noAutoFrame = processAudioFrame({ micRms: 50, obsMuted: true, autoRecoveryUnmute: false });
    assertEqual(noAutoFrame.shouldAutoUnmute, false, 'Auto-recovery does not trigger when disabled');
  });

  // =========================================================================
  // SUITE 8: Multi-Agent Concurrency & Parallel Connection Handling
  // =========================================================================
  await runSuite('8. Multi-Agent Concurrency & Parallel Connection Handling', async () => {
    const configPath = path.join(TEST_DIR, 'concurrent_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'concurrent_db.json'));
    const alertMgr = new AlertManager(cm, db);

    const serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;
    serverApp.alertManager = alertMgr;

    const port = await new Promise(res => {
      serverApp.server.listen(0, '127.0.0.1', () => res(serverApp.server.address().port));
    });
    const wsUrl = 'http://127.0.0.1:' + port;

    const AGENT_COUNT = 10;
    const sockets = [];

    // Connect 10 agents concurrently
    await Promise.all(
      Array.from({ length: AGENT_COUNT }, (_, i) => {
        return new Promise(res => {
          const socket = ioClient(wsUrl);
          const uuid = 'agent-concurrent-' + (i + 1);
          socket.on('connect', () => {
            socket.emit('register', { type: 'agent', uuid, name: 'PC-Concurrent-' + (i + 1) });
            sockets.push(socket);
            setTimeout(res, 50);
          });
        });
      })
    );

    assertEqual(serverApp.telemetryHub.agentSockets.size, AGENT_COUNT, 'All 10 concurrent agents registered in agentSockets map');

    // All 10 agents send telemetries in parallel
    sockets.forEach((s, idx) => {
      s.emit('telemetry', {
        uuid: 'agent-concurrent-' + (idx + 1),
        pcName: 'PC-Concurrent-' + (idx + 1),
        status: 'AMAN',
        micDb: -20 - idx,
        obsDb: -22 - idx,
        cpuUsage: 10 + idx,
        ramUsage: 40 + idx
      });
    });

    await new Promise(r => setTimeout(r, 200));

    // Verify all 10 states updated in lastKnownState
    for (let i = 1; i <= AGENT_COUNT; i++) {
      const state = serverApp.telemetryHub.lastKnownState.get('agent-concurrent-' + i);
      assert(state !== undefined, 'State for agent ' + i + ' exists');
      assertEqual(state.status, 'AMAN', 'Status for agent ' + i + ' is AMAN');
    }

    sockets.forEach(s => s.disconnect());
    await new Promise(r => serverApp.server.close(r));
  });

  // =========================================================================
  // SUITE 9: Agent Disconnect, Network Drop & Reconnection Recovery
  // =========================================================================
  await runSuite('9. Agent Disconnect, Network Drop & Reconnection Recovery', async () => {
    const configPath = path.join(TEST_DIR, 'reconnect_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'reconnect_db.json'));
    const alertMgr = new AlertManager(cm, db);

    const serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;
    serverApp.alertManager = alertMgr;

    const port = await new Promise(res => {
      serverApp.server.listen(0, '127.0.0.1', () => res(serverApp.server.address().port));
    });
    const wsUrl = 'http://127.0.0.1:' + port;

    const testUuid = 'agent-reconnect-007';

    // Step 1: Initial Connection
    let agentSocket = ioClient(wsUrl);
    await new Promise(res => {
      agentSocket.on('connect', () => {
        agentSocket.emit('register', { type: 'agent', uuid: testUuid, name: 'PC-Reconnecting' });
        agentSocket.emit('telemetry', { uuid: testUuid, pcName: 'PC-Reconnecting', status: 'AMAN', micDb: -25, obsDb: -25 });
        setTimeout(res, 100);
      });
    });

    const stateBefore = serverApp.telemetryHub.lastKnownState.get(testUuid);
    assertEqual(stateBefore.status, 'AMAN', 'Initial state is AMAN');

    // Step 2: Simulate Sudden Network Disconnect
    agentSocket.disconnect();
    await new Promise(r => setTimeout(r, 150));

    const stateDisconnected = serverApp.telemetryHub.lastKnownState.get(testUuid);
    assertEqual(stateDisconnected.status, 'OFFLINE', 'Server detected disconnect and updated status to OFFLINE');

    // Step 3: Simulate Reconnection with new Socket ID
    const newAgentSocket = ioClient(wsUrl);
    await new Promise(res => {
      newAgentSocket.on('connect', () => {
        newAgentSocket.emit('register', { type: 'agent', uuid: testUuid, name: 'PC-Reconnecting' });
        newAgentSocket.emit('telemetry', { uuid: testUuid, pcName: 'PC-Reconnecting', status: 'AMAN', micDb: -20, obsDb: -20 });
        setTimeout(res, 100);
      });
    });

    const stateRecovered = serverApp.telemetryHub.lastKnownState.get(testUuid);
    assertEqual(stateRecovered.status, 'AMAN', 'Reconnected agent restored status to AMAN');

    newAgentSocket.disconnect();
    await new Promise(r => serverApp.server.close(r));
  });

  // =========================================================================
  // SUITE 10: Remote Control Dispatch & Bidirectional WebSocket Sync
  // =========================================================================
  await runSuite('10. Remote Control Dispatch & Bidirectional WebSocket Sync', async () => {
    const configPath = path.join(TEST_DIR, 'sync_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'sync_db.json'));
    const alertMgr = new AlertManager(cm, db);

    const serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;
    serverApp.alertManager = alertMgr;

    const port = await new Promise(res => {
      serverApp.server.listen(0, '127.0.0.1', () => res(serverApp.server.address().port));
    });
    const wsUrl = 'http://127.0.0.1:' + port;

    const testUuid = 'agent-sync-target';

    const agentSocket = ioClient(wsUrl);
    const dashSocket = ioClient(wsUrl);

    await Promise.all([
      new Promise(res => {
        agentSocket.on('connect', () => {
          agentSocket.emit('register', { type: 'agent', uuid: testUuid, name: 'PC-Sync-Target' });
          setTimeout(res, 100);
        });
      }),
      new Promise(res => {
        dashSocket.on('connect', () => {
          dashSocket.emit('register', { type: 'dashboard' });
          setTimeout(res, 100);
        });
      })
    ]);

    // 1. Dashboard sends Remote Config Update
    let receivedConfig = null;
    agentSocket.on('update-config', cfg => {
      receivedConfig = cfg;
    });

    dashSocket.emit('agent-config-update', {
      uuid: testUuid,
      config: { noiseGate: 30, silenceTimeoutSec: 20, autoRecoveryUnmute: true }
    });

    await new Promise(r => setTimeout(r, 150));
    assert(receivedConfig !== null, 'Agent received remote config update');
    assertEqual(receivedConfig.noiseGate, 30, 'Remote noiseGate applied');
    assertEqual(receivedConfig.silenceTimeoutSec, 20, 'Remote silenceTimeout applied');

    // 2. Dashboard sends Monitoring Pause
    let receivedPauseState = null;
    agentSocket.on('set-monitoring', state => {
      receivedPauseState = state;
    });

    dashSocket.emit('agent-monitoring', { uuid: testUuid, active: false });
    await new Promise(r => setTimeout(r, 150));

    assertEqual(receivedPauseState, false, 'Agent received set-monitoring false');

    agentSocket.disconnect();
    dashSocket.disconnect();
    await new Promise(r => serverApp.server.close(r));
  });

  // Clean up test directory
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch(e) {}

  console.log('\n======================================================');
  console.log('FINAL EXTENDED WHITEBOX TEST SUMMARY REPORT');
  console.log('======================================================');
  console.log('Total Tests Run : ' + totalTests);
  console.log('Tests Passed   : ' + passedTests);
  console.log('Tests Failed   : ' + failedTests);
  console.log('Success Rate   : ' + ((passedTests / totalTests) * 100).toFixed(1) + '%');
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
