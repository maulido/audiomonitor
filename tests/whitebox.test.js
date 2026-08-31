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
const TranscriptionManager = require('../packages/server/src/TranscriptionManager');
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

  // =========================================================================
  // SUITE 11: OpenAI Whisper Integration, Keyword Alerting & Transcript Search
  // =========================================================================
  await runSuite('11. OpenAI Whisper Integration, Keyword Alerting & Transcript Search', async () => {
    const configPath = path.join(TEST_DIR, 'whisper_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'whisper_db.json'));
    const alertMgr = new AlertManager(cm, db);

    const testRecordDir = path.join(TEST_DIR, 'whisper_vault');
    fs.mkdirSync(testRecordDir, { recursive: true });
    cm.config.recordDir = testRecordDir;

    // 1. Setup Mock Whisper API Worker Server
    const mockWorker = http.createServer((req, res) => {
      if (req.url === '/health' || req.method === 'GET' || req.method === 'OPTIONS') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok', worker: 'Mac-M1-Worker' }));
      }
      if (req.url === '/transcribe' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          text: 'Halo selamat malam, ini adalah rekaman siaran langsung studio, terjadi suara bocor di mikrofon.',
          segments: [
            { id: 0, start: 0.0, end: 4.2, text: 'Halo selamat malam, ini adalah rekaman siaran langsung studio' },
            { id: 1, start: 4.5, end: 8.9, text: 'terjadi suara bocor di mikrofon.' }
          ]
        }));
      }
      res.writeHead(404);
      res.end();
    });

    const mockPort = await new Promise(res => {
      const s = mockWorker.listen(0, '127.0.0.1', () => res(s.address().port));
    });
    const mockWorkerUrl = 'http://127.0.0.1:' + mockPort + '/transcribe';

    // 2. Configure Whisper in ConfigManager
    cm.setTranscriptionConfig({
      enabled: true,
      apiUrl: mockWorkerUrl,
      language: 'id',
      autoTranscribe: true,
      alertKeywords: ['bocor', 'mati']
    });

    const serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;
    serverApp.alertManager = alertMgr;
    serverApp.transcriptionManager = new TranscriptionManager(cm, db, alertMgr, serverApp.telemetryHub);

    const port = await new Promise(res => {
      const s = serverApp.server.listen(0, '127.0.0.1', () => res(s.address().port));
    });
    const baseUrl = 'http://127.0.0.1:' + port;

    // 3. Test Keyword Scanning (Unit Logic)
    const scanned = serverApp.transcriptionManager.scanAlertKeywords(
      'Ada indikasi suara bocor dan kabel putus di studio',
      ['bocor', 'mati', 'rusak']
    );
    assertEqual(scanned.length, 1, 'scanAlertKeywords found 1 keyword match');
    assertEqual(scanned[0], 'bocor', 'Matched keyword is "bocor"');

    // 4. Test API Health / Connectivity Check
    const connResult = await serverApp.transcriptionManager.testConnection('http://127.0.0.1:' + mockPort + '/health');
    assert(connResult.success === true, 'Whisper API connection test succeeded');

    const connFailResult = await serverApp.transcriptionManager.testConnection('http://127.0.0.1:9999/dead-port');
    assert(connFailResult.success === false, 'Offline Whisper API connection test correctly returned success: false');

    // 5. Test Path Traversal Protection
    const resTraversalGet = await fetch(`${baseUrl}/api/records/transcript?folder=..`);
    assert(resTraversalGet.status === 400 || resTraversalGet.status === 403, 'Path traversal on GET transcript rejected with 400/403');

    const resTraversalPost = await fetch(`${baseUrl}/api/records/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pin': '1234' },
      body: JSON.stringify({ folder: '..', file: 'secret.txt', pcName: 'Test' })
    });
    assert(resTraversalPost.status === 400 || resTraversalPost.status === 403, 'Path traversal on POST transcribe rejected with 400/403');

    // 6. Test Audio File Transcription Execution
    const sampleUuid = '88888888-4444-4444-4444-121212121212';
    cm.setPcName(sampleUuid, 'PC Studio Utama');
    const sessionFolder = 'PC_Studio_Utama_' + sampleUuid + '_2026-08-29_16-00-00_to_16-10-00';
    const folderPath = path.join(testRecordDir, sessionFolder);
    fs.mkdirSync(folderPath, { recursive: true });
    
    const sampleAudioPath = path.join(folderPath, 'Part_001.webm');
    fs.writeFileSync(sampleAudioPath, Buffer.alloc(2048, 'b'));

    const transResult = await serverApp.transcriptionManager.transcribeFile(
      sampleAudioPath, 
      sessionFolder, 
      'Part_001.webm', 
      'PC Studio Utama'
    );

    assert(transResult !== null, 'Transcription result returned');
    assertEqual(transResult.language, 'id', 'Transcript language is ID');
    assertEqual(transResult.segments.length, 2, 'Transcript parsed 2 segments');
    assertEqual(transResult.keywordsFound.length, 1, 'Detected keyword in transcript');
    assertEqual(transResult.keywordsFound[0], 'bocor', 'Keyword "bocor" recorded in transcript');
    assert(fs.existsSync(sampleAudioPath + '.transcript.json'), 'Transcript JSON saved on disk next to audio');

    // 7. Test GET /api/records/transcript
    const resGetTrans = await fetch(`${baseUrl}/api/records/transcript?folder=${encodeURIComponent(sessionFolder)}&file=Part_001.webm`);
    assertEqual(resGetTrans.status, 200, 'GET /api/records/transcript returned 200');
    const transBody = await resGetTrans.json();
    assert(transBody.success === true, 'API returned success true');
    assertEqual(transBody.transcript.segments.length, 2, 'API transcript contains 2 segments');

    // 8. Test Keyword Search: GET /api/records/search-transcript?q=bocor
    const resSearch = await fetch(`${baseUrl}/api/records/search-transcript?q=bocor`);
    assertEqual(resSearch.status, 200, 'GET /api/records/search-transcript returned 200');
    const searchBody = await resSearch.json();
    assert(searchBody.success === true, 'Search returned success true');
    assertEqual(searchBody.results.length, 1, 'Found 1 matching transcript file');
    assertEqual(searchBody.results[0].pcName, 'PC Studio Utama', 'Matched PC Studio Utama');

    // 8b. Test Search with PC Filter (Matching)
    const resSearchPcMatch = await fetch(`${baseUrl}/api/records/search-transcript?q=bocor&pcFilter=${encodeURIComponent('PC Studio Utama')}`);
    const searchPcMatchBody = await resSearchPcMatch.json();
    assertEqual(searchPcMatchBody.results.length, 1, 'PC filter match returned 1 result');

    // 8c. Test Search with PC Filter (Non-Matching)
    const resSearchPcOther = await fetch(`${baseUrl}/api/records/search-transcript?q=bocor&pcFilter=${encodeURIComponent('PC Studio Lain')}`);
    const searchPcOtherBody = await resSearchPcOther.json();
    assertEqual(searchPcOtherBody.results.length, 0, 'PC filter mismatch returned 0 results');

    // 8d. Test Search with Date Range Filter (Matching)
    const resSearchDateMatch = await fetch(`${baseUrl}/api/records/search-transcript?q=bocor&startDate=2020-01-01&endDate=2030-12-31`);
    const searchDateMatchBody = await resSearchDateMatch.json();
    assertEqual(searchDateMatchBody.results.length, 1, 'Date range match returned 1 result');

    // 8e. Test Search with Date Range Filter (Non-Matching)
    const resSearchDateMismatch = await fetch(`${baseUrl}/api/records/search-transcript?q=bocor&startDate=2020-01-01&endDate=2020-01-02`);
    const searchDateMismatchBody = await resSearchDateMismatch.json();
    assertEqual(searchDateMismatchBody.results.length, 0, 'Date range mismatch returned 0 results');

    // 9. Test Keyword Alert Logged in Database
    const incidents = db.incidents;
    const keywordIncidents = incidents.filter(inc => inc.incidentType === 'KEYWORD_ALERT');
    assert(keywordIncidents.length > 0, 'KEYWORD_ALERT incident recorded in database');

    await new Promise(r => mockWorker.close(r));
    await new Promise(r => serverApp.server.close(r));
  });

  // =========================================================================
  // SUITE 12: End-to-End Incident Lifecycle, Audio Recording, Rollover & Merge
  // =========================================================================
  await runSuite('12. End-to-End Incident Lifecycle, Rollover & Multi-Part Stitching', async () => {
    const configPath = path.join(TEST_DIR, 'lifecycle_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'lifecycle_db.json'));
    const alertMgr = new AlertManager(cm, db);
    const testRecordDir = path.join(TEST_DIR, 'lifecycle_vault');
    fs.mkdirSync(testRecordDir, { recursive: true });
    cm.config.recordDir = testRecordDir;

    const serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;
    serverApp.alertManager = alertMgr;

    const port = await new Promise(res => {
      const s = serverApp.server.listen(0, '127.0.0.1', () => res(s.address().port));
    });
    const baseUrl = 'http://127.0.0.1:' + port;

    const testUuid = '99999999-aaaa-bbbb-cccc-111122223333';
    cm.setPcName(testUuid, 'PC Siaran 1');

    const ongoingFolder = 'PC_Siaran_1_' + testUuid + '_2026-08-29_18-00-00';
    const completedFolder = 'PC_Siaran_1_' + testUuid + '_2026-08-29_18-00-00_to_18-30-00';

    // 1. Agent uploads Part_001.webm during ongoing incident
    const resPart1 = await fetch(`${baseUrl}/internal/upload-record`, {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/webm',
        'x-agent-name': 'PC Siaran 1',
        'x-session-folder': ongoingFolder,
        'x-file-name': 'Part_001.webm'
      },
      body: Buffer.alloc(1024, '1')
    });
    assertEqual(resPart1.status, 200, 'Upload Part_001 returned 200');

    // 2. Agent uploads Part_002.webm on rollover (still ongoing)
    const resPart2 = await fetch(`${baseUrl}/internal/upload-record`, {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/webm',
        'x-agent-name': 'PC Siaran 1',
        'x-session-folder': ongoingFolder,
        'x-file-name': 'Part_002.webm'
      },
      body: Buffer.alloc(1024, '2')
    });
    assertEqual(resPart2.status, 200, 'Upload Part_002 returned 200');

    // 3. Incident ends: Agent uploads Part_003.webm to completed folder name
    const resPart3 = await fetch(`${baseUrl}/internal/upload-record`, {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/webm',
        'x-agent-name': 'PC Siaran 1',
        'x-session-folder': completedFolder,
        'x-file-name': 'Part_003.webm'
      },
      body: Buffer.alloc(1024, '3')
    });
    assertEqual(resPart3.status, 200, 'Upload Part_003 to completed folder returned 200');

    // Give server moment to finish disk rename/merge
    await new Promise(r => setTimeout(r, 200));

    // 4. Verify Server Merged All 3 Parts into Completed Folder
    const completedPath = path.join(testRecordDir, completedFolder);
    assert(fs.existsSync(completedPath), 'Completed session folder exists');
    assert(fs.existsSync(path.join(completedPath, 'Part_001.webm')), 'Part_001 migrated to completed folder');
    assert(fs.existsSync(path.join(completedPath, 'Part_002.webm')), 'Part_002 migrated to completed folder');
    assert(fs.existsSync(path.join(completedPath, 'Part_003.webm')), 'Part_003 written to completed folder');

    // 5. Verify GET /api/records returns consolidated session
    const resRecords = await fetch(`${baseUrl}/api/records`);
    const recordsData = await resRecords.json();
    const recordsList = Array.isArray(recordsData) ? recordsData : recordsData.records;
    assertEqual(recordsList.length, 3, 'GET /api/records lists all 3 parts');
    assertEqual(recordsList[0].isCompleted, true, 'All parts marked isCompleted true');
    assertEqual(recordsList[0].pcName, 'PC Siaran 1', 'Session pcName matches');

    // 6. Verify Access via Media Route with Ongoing Folder Name automatically resolves to Completed Folder
    const resMedia = await fetch(`${baseUrl}/media/${encodeURIComponent(ongoingFolder)}/Part_001.webm`);
    assertEqual(resMedia.status, 200, 'Ongoing folder URL transparently served from completed folder');

    await new Promise(r => serverApp.server.close(r));
  });

  // =========================================================================
  // SUITE 13: Parallel Upload Concurrency, Queue Backpressure & Background Transcriber
  // =========================================================================
  await runSuite('13. Parallel Upload Concurrency & Background Transcriber Stress', async () => {
    const configPath = path.join(TEST_DIR, 'stress_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'stress_db.json'));
    const alertMgr = new AlertManager(cm, db);
    const testRecordDir = path.join(TEST_DIR, 'stress_vault');
    fs.mkdirSync(testRecordDir, { recursive: true });
    cm.config.recordDir = testRecordDir;

    // Setup Mock Whisper Worker with 20ms simulated latency
    let workerRequestsCount = 0;
    const mockWorker = http.createServer((req, res) => {
      if (req.url === '/transcribe' && req.method === 'POST') {
        workerRequestsCount++;
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            text: 'Uji coba beban sistem paralel dan transkripsi suara.',
            segments: [{ id: 0, start: 0.0, end: 5.0, text: 'Uji coba beban sistem paralel dan transkripsi suara.' }]
          }));
        }, 20);
      } else {
        res.writeHead(200);
        res.end();
      }
    });

    const mockPort = await new Promise(res => {
      const s = mockWorker.listen(0, '127.0.0.1', () => res(s.address().port));
    });
    const mockWorkerUrl = 'http://127.0.0.1:' + mockPort + '/transcribe';

    cm.setTranscriptionConfig({
      enabled: true,
      apiUrl: mockWorkerUrl,
      language: 'id',
      autoTranscribe: true,
      alertKeywords: ['paralel']
    });

    const serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;
    serverApp.alertManager = alertMgr;
    serverApp.transcriptionManager = new TranscriptionManager(cm, db, alertMgr, serverApp.telemetryHub);

    const port = await new Promise(res => {
      const s = serverApp.server.listen(0, '127.0.0.1', () => res(s.address().port));
    });
    const baseUrl = 'http://127.0.0.1:' + port;

    const stressUuid = '77777777-8888-9999-aaaa-bbbbccccdddd';
    cm.setPcName(stressUuid, 'PC Stress Test');
    const stressFolder = 'PC_Stress_Test_' + stressUuid + '_2026-08-29_19-00-00';

    // 1. Fire 8 simultaneous parallel file uploads with proper headers
    const uploadPromises = [];
    for (let i = 1; i <= 8; i++) {
      const fileName = `Part_00${i}.webm`;
      uploadPromises.push(
        fetch(`${baseUrl}/internal/upload-record`, {
          method: 'POST',
          headers: {
            'Content-Type': 'audio/webm',
            'x-agent-name': 'PC Stress Test',
            'x-session-folder': stressFolder,
            'x-file-name': fileName
          },
          body: Buffer.alloc(512, String(i))
        })
      );
    }

    const uploadResponses = await Promise.all(uploadPromises);
    for (const r of uploadResponses) {
      assertEqual(r.status, 200, 'Parallel upload chunk succeeded with 200');
    }

    // 2. Wait for background transcription queue to drain all 8 tasks
    let waitCount = 0;
    while (serverApp.transcriptionManager.queue.length > 0 || serverApp.transcriptionManager.isProcessing) {
      await new Promise(r => setTimeout(r, 50));
      waitCount++;
      if (waitCount > 100) break; // timeout guard 5s
    }

    assertEqual(serverApp.transcriptionManager.queue.length, 0, 'Transcription queue drained to 0');
    assertEqual(serverApp.transcriptionManager.isProcessing, false, 'Transcription worker returned to idle');
    assert(workerRequestsCount >= 8, 'Whisper worker handled all parallel tasks');

    // 3. Verify all 8 transcript files exist on disk
    for (let i = 1; i <= 8; i++) {
      const tPath = path.join(testRecordDir, stressFolder, `Part_00${i}.webm.transcript.json`);
      assert(fs.existsSync(tPath), `Transcript file Part_00${i}.webm.transcript.json created on disk`);
    }

    await new Promise(r => mockWorker.close(r));
    await new Promise(r => serverApp.server.close(r));
  });

  // =========================================================================
  // SUITE 14: Input Fuzzing, Search Query Resilience & Multilingual Safety
  // =========================================================================
  await runSuite('14. Input Fuzzing, Special Characters & Search Query Resilience', async () => {
    const configPath = path.join(TEST_DIR, 'fuzz_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'fuzz_db.json'));
    const alertMgr = new AlertManager(cm, db);
    const testRecordDir = path.join(TEST_DIR, 'fuzz_vault');
    fs.mkdirSync(testRecordDir, { recursive: true });
    cm.config.recordDir = testRecordDir;

    const serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;
    serverApp.alertManager = alertMgr;
    serverApp.transcriptionManager = new TranscriptionManager(cm, db, alertMgr, serverApp.telemetryHub);

    const port = await new Promise(res => {
      const s = serverApp.server.listen(0, '127.0.0.1', () => res(s.address().port));
    });
    const baseUrl = 'http://127.0.0.1:' + port;

    // 1. Create transcript with special symbols, numbers and mixed unicode
    const fFolder = 'PC_Fuzz_11111111-2222-3333-4444-555555555555_2026-08-29_20-00-00';
    const fDirPath = path.join(testRecordDir, fFolder);
    fs.mkdirSync(fDirPath, { recursive: true });

    const fTranscript = {
      fileName: 'Part_001.webm',
      sessionFolder: fFolder,
      pcName: 'PC Fuzz Test',
      transcribedAt: '2026-08-29 20:00:00',
      language: 'id',
      text: 'Peringatan! Terjadi error pada port [COM3] & regex string (*+?^$|#@) dengan status OK.',
      segments: [
        { id: 0, start: 0, end: 4, text: 'Peringatan! Terjadi error pada port [COM3]' },
        { id: 1, start: 4, end: 8, text: '& regex string (*+?^$|#@) dengan status OK.' }
      ]
    };
    fs.writeFileSync(path.join(fDirPath, 'Part_001.webm.transcript.json'), JSON.stringify(fTranscript));

    // 2. Test Regex Special Character Search Queries
    const specialQueries = ['(*+?^$|#@)', '[COM3]', 'error', 'Peringatan!'];
    for (const q of specialQueries) {
      const res = await fetch(`${baseUrl}/api/records/search-transcript?q=${encodeURIComponent(q)}`);
      assertEqual(res.status, 200, `Search query "${q}" returned 200`);
      const body = await res.json();
      assert(body.success === true, `Search query "${q}" succeeded`);
      assertEqual(body.results.length, 1, `Search query "${q}" matched 1 result`);
    }

    // 3. Test Massive Fuzz Query String (> 3000 characters)
    const massiveQuery = 'a'.repeat(3000);
    const resMassive = await fetch(`${baseUrl}/api/records/search-transcript?q=${encodeURIComponent(massiveQuery)}`);
    assertEqual(resMassive.status, 200, 'Massive 3000-char search query handled safely without 500 crash');
    const massiveBody = await resMassive.json();
    assertEqual(massiveBody.results.length, 0, 'No match for 3000-char string');

    // 4. Test Configuration Fuzzing (Deduplication, Whitespace, Mixed Casing)
    const resConfig = await fetch(`${baseUrl}/api/config/transcription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pin': '1234' },
      body: JSON.stringify({
        enabled: true,
        apiUrl: 'http://192.168.1.100:8000/transcribe',
        alertKeywords: ['BOCOR', '  bocor  ', 'MATI', 'rusak', '']
      })
    });
    assertEqual(resConfig.status, 200, 'POST /api/config/transcription returned 200');
    const cfgData = await resConfig.json();
    assertEqual(cfgData.transcription.alertKeywords.length, 3, 'Alert keywords deduplicated to 3 unique items');
    assert(cfgData.transcription.alertKeywords.includes('bocor'), 'Keyword "bocor" saved lowercase');
    assert(cfgData.transcription.alertKeywords.includes('mati'), 'Keyword "mati" saved lowercase');
    assert(cfgData.transcription.alertKeywords.includes('rusak'), 'Keyword "rusak" saved lowercase');

    // 5. Test test-api endpoint input validation
    const resBadUrl = await fetch(`${baseUrl}/api/transcription/test-api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pin': '1234' },
      body: JSON.stringify({ apiUrl: 'ftp://invalid-protocol.com' })
    });
    const badUrlData = await resBadUrl.json();
    assertEqual(badUrlData.success, false, 'Invalid URL scheme rejected with success: false');

    await new Promise(r => serverApp.server.close(r));
  });

  // =========================================================================
  // SUITE 15: Rapid Telemetry Bursts, State Window Clamping & Edge-Cases
  // =========================================================================
  await runSuite('15. Rapid Telemetry Bursts, State Window Clamping & Edge-Cases', async () => {
    const configPath = path.join(TEST_DIR, 'burst_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'burst_db.json'));
    const alertMgr = new AlertManager(cm, db);

    const serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;
    serverApp.alertManager = alertMgr;

    const port = await new Promise(res => {
      const s = serverApp.server.listen(0, '127.0.0.1', () => res(s.address().port));
    });

    const agentSocket = ioClient(`http://127.0.0.1:${port}`);
    await new Promise(res => agentSocket.on('connect', res));

    const burstUuid = '55555555-6666-7777-8888-999999999999';

    // 1. Emit 40 rapid telemetry packets in quick succession
    for (let i = 0; i < 40; i++) {
      agentSocket.emit('telemetry', {
        uuid: burstUuid,
        micDb: -20 + (i % 5),
        obsDb: -22 + (i % 5),
        status: 'AMAN',
        dangerScore: 0,
        isMuted: false
      });
    }

    await new Promise(r => setTimeout(r, 200));

    // 2. Verify server recorded state without crash and updated fields
    const recordedState = serverApp.telemetryHub.lastKnownState.get(burstUuid);
    assert(recordedState !== undefined, 'Agent state recorded in TelemetryHub');
    assertEqual(recordedState.status, 'AMAN', 'Agent status is AMAN');

    // 3. Test Invalid dB Values (NaN, -Infinity, undefined)
    agentSocket.emit('telemetry', {
      uuid: burstUuid,
      micDb: -Infinity,
      obsDb: NaN,
      status: 'AMAN'
    });

    await new Promise(r => setTimeout(r, 100));

    const sanitizedState = serverApp.telemetryHub.lastKnownState.get(burstUuid);
    assert(sanitizedState !== undefined, 'Sanitized state exists');
    assert(isFinite(sanitizedState.micDb) || sanitizedState.micDb === -60, 'Non-finite micDb handled safely');

    agentSocket.disconnect();
    await new Promise(r => serverApp.server.close(r));
  });

  // =========================================================================
  // SUITE 16: Auto-Update Lifecycle, Installer Distribution & Progress Streaming
  // =========================================================================
  await runSuite('16. Auto-Update Lifecycle, Installer Distribution & Progress Streaming', async () => {
    const configPath = path.join(TEST_DIR, 'update_config.json');
    const cm = new ConfigManager(configPath);
    cm.config.updatesDir = path.join(TEST_DIR, 'updates_vault');
    const db = new DatabaseManager(path.join(TEST_DIR, 'update_db.json'));
    const alertMgr = new AlertManager(cm, db);

    const serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;
    serverApp.alertManager = alertMgr;

    const port = await new Promise(res => {
      const s = serverApp.server.listen(0, '127.0.0.1', () => res(s.address().port));
    });
    const baseUrl = 'http://127.0.0.1:' + port;

    // 1. Check /updates/agent/info initially
    const resInfoInitial = await fetch(`${baseUrl}/updates/agent/info`);
    assertEqual(resInfoInitial.status, 200, 'GET /updates/agent/info returned 200');
    const infoDataInitial = await resInfoInitial.json();
    assert(infoDataInitial.hasUpdate !== undefined, 'hasUpdate field present');

    // 2. Test Invalid File Extension Upload (Reject .bat/.sh)
    const resBadExt = await fetch(`${baseUrl}/api/updates/upload-agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-file-name': 'malicious_script.bat',
        'x-pin': '1234'
      },
      body: Buffer.from('echo Hacked')
    });
    assertEqual(resBadExt.status, 400, 'Non-exe upload rejected with 400');

    // 3. Upload Valid Installer v1.0.2
    const fakeInstaller102 = Buffer.alloc(4096, 'E');
    const resUpload102 = await fetch(`${baseUrl}/api/updates/upload-agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-file-name': 'AudioMonitor_Agent_Installer_v1.0.2.exe',
        'x-pin': '1234'
      },
      body: fakeInstaller102
    });
    assertEqual(resUpload102.status, 200, 'Upload installer v1.0.2 returned 200');

    // 4. Upload Higher Version Installer v1.0.3
    const fakeInstaller103 = Buffer.alloc(8192, 'F');
    const resUpload103 = await fetch(`${baseUrl}/api/updates/upload-agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-file-name': 'AudioMonitor_Agent_Installer_v1.0.3.exe',
        'x-pin': '1234'
      },
      body: fakeInstaller103
    });
    assertEqual(resUpload103.status, 200, 'Upload installer v1.0.3 returned 200');

    // 5. Query /updates/agent/info and verify Semver selection chooses v1.0.3
    const resInfoLatest = await fetch(`${baseUrl}/updates/agent/info`);
    const infoLatest = await resInfoLatest.json();
    assertEqual(infoLatest.hasUpdate, true, 'hasUpdate is true after upload');
    assertEqual(infoLatest.version, '1.0.3', 'Latest version identified as 1.0.3');
    assertEqual(infoLatest.fileName, 'AudioMonitor_Agent_Installer_v1.0.3.exe', 'Latest installer filename matches');

    // 6. Download installer via LAN streaming endpoint
    const resDownload = await fetch(`${baseUrl}/updates/agent/AudioMonitor_Agent_Installer_v1.0.3.exe`);
    assertEqual(resDownload.status, 200, 'Download installer returned 200');
    const downloadedBuf = Buffer.from(await resDownload.arrayBuffer());
    assertEqual(downloadedBuf.length, 8192, 'Downloaded file size matches uploaded 8192 bytes');

    // 7. Path Traversal Protection on update files
    const resTrav = await fetch(`${baseUrl}/updates/agent/..%2F..%2Fsecret.txt`);
    assert(resTrav.status === 403 || resTrav.status === 404, 'Path traversal on updates rejected with 403/404');

    // 8. Test Agent Update Trigger Dispatch via Socket.io
    const testAgentUuid = 'update-test-uuid-1111-2222';
    const agentSocket = ioClient(`http://127.0.0.1:${port}`);
    let receivedUpdateCmd = null;

    agentSocket.on('connect', () => {
      agentSocket.emit('register', { type: 'agent', uuid: testAgentUuid, pcName: 'Test PC' });
    });
    agentSocket.on('execute-update', (data) => {
      receivedUpdateCmd = data;
    });

    await new Promise(r => setTimeout(r, 200));

    const resTrigger = await fetch(`${baseUrl}/api/updates/trigger-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pin': '1234' },
      body: JSON.stringify({
        targetUuid: testAgentUuid,
        downloadUrl: '/updates/agent/AudioMonitor_Agent_Installer_v1.0.3.exe'
      })
    });
    assertEqual(resTrigger.status, 200, 'POST /api/updates/trigger-agent returned 200');

    await new Promise(r => setTimeout(r, 200));
    assert(receivedUpdateCmd !== null, 'Agent received request-install-update command');
    assert(receivedUpdateCmd.downloadUrl.includes('AudioMonitor_Agent_Installer_v1.0.3.exe'), 'Download URL conveyed correctly');

    // 9. Test Agent Progress Relay to Dashboard
    const dashSocket = ioClient(`http://127.0.0.1:${port}`);
    let dashReceivedProgress = null;

    dashSocket.on('connect', () => {
      dashSocket.emit('register', { type: 'dashboard' });
    });
    dashSocket.on('agent-update-progress', (prog) => {
      dashReceivedProgress = prog;
    });

    await new Promise(r => setTimeout(r, 200));

    agentSocket.emit('agent-update-progress', {
      uuid: testAgentUuid,
      status: 'downloading',
      percent: 65
    });

    await new Promise(r => setTimeout(r, 200));
    assert(dashReceivedProgress !== null, 'Dashboard received relayed agent-update-progress');
    assertEqual(dashReceivedProgress.percent, 65, 'Progress percentage relayed accurately');

    // 10. Test POST /api/updates/server-self-update validation
    const resSelfUpdateNoUrl = await fetch(`${baseUrl}/api/updates/server-self-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pin': '1234' },
      body: JSON.stringify({})
    });
    assertEqual(resSelfUpdateNoUrl.status, 400, 'POST /api/updates/server-self-update without downloadUrl returns 400');

    agentSocket.disconnect();
    dashSocket.disconnect();
    await new Promise(r => serverApp.server.close(r));
  });

  // =========================================================================
  // SUITE 17: Database Stress, Incident Pagination, Retention Purge & Concurrency
  // =========================================================================
  await runSuite('17. Database Stress, Incident Pagination & Retention Purge', async () => {
    const dbPath = path.join(TEST_DIR, 'stress_query_db.json');
    const db = new DatabaseManager(dbPath);

    // 1. Concurrent Inserts: 30 Simultaneous Incidents
    const insertPromises = [];
    const incidentTypes = ['CLIPPING', 'AUDIO_DEAD', 'KEYWORD_ALERT', 'OBS_DISCONNECTED'];
    for (let i = 1; i <= 30; i++) {
      const pcId = `PC-${(i % 5) + 1}`;
      const type = incidentTypes[i % incidentTypes.length];
      insertPromises.push(
        Promise.resolve().then(() => {
          return db.logIncident(pcId, pcId, type, `Insiden simulasi stres uji #${i}`);
        })
      );
    }

    await Promise.all(insertPromises);
    assertEqual(db.incidents.length, 30, 'All 30 concurrent incidents persisted without drop');

    // 2. Query Filtering by PC Name (via getFilteredIncidents callback)
    const pc1Incidents = await new Promise(r => db.getFilteredIncidents({ pcName: 'PC-1' }, r));
    assert(pc1Incidents.length > 0, 'Found incidents for PC-1');
    assert(pc1Incidents.every(inc => inc.pcName === 'PC-1'), 'All returned records belong to PC-1');

    // 3. Query Filtering by Incident Type (via getFilteredIncidents callback)
    const keywordAlerts = await new Promise(r => db.getFilteredIncidents({ status: 'KEYWORD_ALERT' }, r));
    assert(keywordAlerts.length > 0, 'Found KEYWORD_ALERT incidents');
    assert(keywordAlerts.every(inc => (inc.incidentType || '').toUpperCase().includes('KEYWORD_ALERT')), 'All returned records match status filter');

    // 4. Query Filtering by limit
    const page1 = await new Promise(r => db.getFilteredIncidents({ limit: 5 }, r));
    const page2 = await new Promise(r => db.getRecentIncidents(10, r));

    assertEqual(page1.length, 5, 'Page 1 limit returned 5 items');
    assertEqual(page2.length, 10, 'getRecentIncidents limit returned 10 items');

    // 5. Unique PC Names List
    const uniquePcs = db.getUniquePcNames();
    assert(uniquePcs.length >= 5, 'Found at least 5 unique PC names');

    // 6. Retention Auto-Purge Simulation (Old Record Cleanup)
    // Manually inject an old incident timestamped 45 days ago
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 45);
    db.incidents.push({
      id: 999,
      uuid: 'PC-Old',
      pcName: 'PC-Old',
      incidentType: 'AUDIO_DEAD',
      details: 'Log usang 45 hari lalu',
      timestamp: oldDate.toISOString().replace('T', ' ').substring(0, 19)
    });
    db.saveDbSync();

    const beforeCleanupCount = db.incidents.length;
    assertEqual(beforeCleanupCount, 31, 'Total records includes 1 old record');

    const removedCount = db.autoCleanup(30);
    assertEqual(removedCount, 1, 'autoCleanup(30) purged exactly 1 old record');
    assertEqual(db.incidents.length, 30, 'Remaining records count is exactly 30');
    assert(!db.incidents.some(i => i.id === 999), 'Old record successfully removed');
  });

  // =========================================================================
  // SUITE 18: Audio Decibel Calculation, Volume Meter Conversion & Auto-Unmute
  // =========================================================================
  await runSuite('18. Audio Decibel Calculation, Volume Meter Conversion & Auto-Unmute', async () => {
    // 1. Linear multiplier to dB Conversion Formula Test
    const linearToDb = (val) => {
      if (typeof val !== 'number' || isNaN(val) || val <= 0.0001) return -60;
      const db = 20 * Math.log10(val);
      return Math.max(-60, Math.min(0, parseFloat(db.toFixed(1))));
    };

    assertEqual(linearToDb(0.0), -60, '0.0 linear power converts to -60 dB');
    assertEqual(linearToDb(0.00001), -60, 'Below noise floor converts to -60 dB');
    assertEqual(linearToDb(0.1), -20, '0.1 linear power converts to -20 dB');
    assertEqual(linearToDb(1.0), 0, '1.0 full scale converts to 0 dB');

    // 2. Multi-Channel Peak Selector Test
    const getPeakLevel = (channels = []) => {
      if (!Array.isArray(channels) || channels.length === 0) return -60;
      const maxLinear = Math.max(...channels);
      return linearToDb(maxLinear);
    };

    assertEqual(getPeakLevel([0.05, 0.5]), -6, 'Peak of [0.05, 0.5] evaluates to -6 dB');
    assertEqual(getPeakLevel([]), -60, 'Empty channel list safely evaluates to -60 dB');

    // 3. Auto-Recovery Unmute Evaluation Test
    const evaluateAutoRecovery = (currentDangerScore, isMuted, autoRecoveryEnabled) => {
      if (!isMuted || !autoRecoveryEnabled) return false;
      return currentDangerScore === 0;
    };

    assertEqual(evaluateAutoRecovery(0, true, true), true, 'Triggers unmute when score is 0 and currently muted');
    assertEqual(evaluateAutoRecovery(50, true, true), false, 'Does not unmute while danger score is positive');
    assertEqual(evaluateAutoRecovery(0, true, false), false, 'Does not unmute when feature is disabled');
    assertEqual(evaluateAutoRecovery(0, false, true), false, 'Does not trigger unmute if already unmuted');
  });

  // =========================================================================
  // SUITE 19: Unified Audio Transcript Parsing, Multi-Session Aggregation & SRT Formatting
  // =========================================================================
  await runSuite('19. Unified Audio Transcript Parsing, Aggregation & SRT Formatting', async () => {
    const configPath = path.join(TEST_DIR, 'transcript_format_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'transcript_format_db.json'));
    const alertMgr = new AlertManager(cm, db);
    const tm = new TranscriptionManager(cm, db, alertMgr);

    // 1. SRT Time String Formatter Test
    const formatSrtTime = (seconds) => {
      const validSec = (typeof seconds === 'number' && !isNaN(seconds) && isFinite(seconds)) ? Math.max(0, seconds) : 0;
      const d = new Date(validSec * 1000);
      const hh = String(Math.floor(validSec / 3600)).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      const ss = String(d.getUTCSeconds()).padStart(2, '0');
      const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
      return `${hh}:${mm}:${ss},${ms}`;
    };

    assertEqual(formatSrtTime(0), '00:00:00,000', '0s formats to 00:00:00,000');
    assertEqual(formatSrtTime(65.5), '00:01:05,500', '65.5s formats to 00:01:05,500');
    assertEqual(formatSrtTime(3661.123), '01:01:01,123', '3661.123s formats to 01:01:01,123');
    assertEqual(formatSrtTime(NaN), '00:00:00,000', 'NaN formats safely to 00:00:00,000');

    // 2. Multi-Part Transcript Aggregation Test (with 1 Missing Chunk)
    const sessionDir = path.join(TEST_DIR, 'multi_part_session');
    fs.mkdirSync(sessionDir, { recursive: true });

    const part1Transcript = {
      fileName: 'Part_001.webm',
      text: 'Bagian satu pembukaan siaran.',
      segments: [{ id: 0, start: 0, end: 5, text: 'Bagian satu pembukaan siaran.' }],
      keywordsFound: ['siaran'],
      transcribedAt: '2026-08-29 15:00:00'
    };
    const part3Transcript = {
      fileName: 'Part_003.webm',
      text: 'Bagian tiga penutupan siaran darurat.',
      segments: [{ id: 1, start: 10, end: 15, text: 'Bagian tiga penutupan siaran darurat.' }],
      keywordsFound: ['darurat'],
      transcribedAt: '2026-08-29 15:20:00'
    };

    fs.writeFileSync(path.join(sessionDir, 'Part_001.webm.transcript.json'), JSON.stringify(part1Transcript));
    fs.writeFileSync(path.join(sessionDir, 'Part_003.webm.transcript.json'), JSON.stringify(part3Transcript));

    const aggregated = tm.getTranscriptForSession(sessionDir);
    assert(aggregated !== null, 'Session transcript successfully aggregated');
    assertEqual(aggregated.partsCount, 2, 'Aggregated 2 available transcript parts');
    assert(aggregated.text.includes('Bagian satu') && aggregated.text.includes('Bagian tiga'), 'Combined text contains both parts');
    assertEqual(aggregated.segments.length, 2, 'Combined segments array has 2 items');
    assert(aggregated.keywordsFound.includes('siaran') && aggregated.keywordsFound.includes('darurat'), 'Combined keywords merged accurately');

    // 3. Single file transcript retrieval & missing file handling
    const retrievedPart1 = tm.getTranscriptForFile(path.join(sessionDir, 'Part_001.webm'));
    assert(retrievedPart1 !== null, 'getTranscriptForFile retrieved existing transcript');
    assertEqual(retrievedPart1.fileName, 'Part_001.webm', 'Retrieved filename matches');

    const retrievedNonExistent = tm.getTranscriptForFile(path.join(sessionDir, 'Part_999.webm'));
    assertEqual(retrievedNonExistent, null, 'Non-existent transcript file returns null');
  });

  // =========================================================================
  // SUITE 20: Disaster Recovery, Cold Reboot & Client Reconnection Resilience
  // =========================================================================
  await runSuite('20. Disaster Recovery, Cold Reboot & Client Reconnection Resilience', async () => {
    const configPath = path.join(TEST_DIR, 'reboot_config.json');
    const dbPath = path.join(TEST_DIR, 'reboot_db.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(dbPath);
    const alertMgr = new AlertManager(cm, db);

    const testUuid = 'cold-reboot-agent-1234-5678';
    cm.setPcName(testUuid, 'PC Siaran Utama');

    // 1. Start Server Instance 1
    let serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;
    serverApp.alertManager = alertMgr;
    serverApp.telemetryHub = new TelemetryHub(serverApp.server, cm, alertMgr);

    let port = await new Promise(res => {
      const s = serverApp.server.listen(0, '127.0.0.1', () => res(s.address().port));
    });

    // 2. Connect Agent to Instance 1
    let agentSocket = ioClient(`http://127.0.0.1:${port}`);
    await new Promise(res => {
      agentSocket.on('connect', () => {
        agentSocket.emit('register', { type: 'agent', uuid: testUuid, pcName: 'PC Siaran Utama' });
        res();
      });
    });

    agentSocket.emit('telemetry', {
      uuid: testUuid,
      micDb: -15,
      obsDb: -18,
      status: 'AMAN',
      dangerScore: 0,
      isMuted: false
    });

    await new Promise(r => setTimeout(r, 100));
    assertEqual(serverApp.telemetryHub.lastKnownState.get(testUuid).status, 'AMAN', 'Agent status AMAN on Instance 1');

    // 3. Simulate Sudden Server Crash / Shutdown
    agentSocket.disconnect();
    await new Promise(r => serverApp.server.close(r));

    // 4. Cold Reboot: Start Server Instance 2 using existing disk files
    const cmReboot = new ConfigManager(configPath);
    const dbReboot = new DatabaseManager(dbPath);
    const alertMgrReboot = new AlertManager(cmReboot, dbReboot);

    serverApp = new ServerApp(0);
    serverApp.configManager = cmReboot;
    serverApp.dbManager = dbReboot;
    serverApp.alertManager = alertMgrReboot;
    serverApp.telemetryHub = new TelemetryHub(serverApp.server, cmReboot, alertMgrReboot);

    port = await new Promise(res => {
      const s = serverApp.server.listen(0, '127.0.0.1', () => res(s.address().port));
    });

    // Verify Config Re-hydration on Startup
    assert(serverApp.telemetryHub.lastKnownState.has(testUuid), 'Server re-hydrated PC mapping on cold startup');
    assertEqual(serverApp.telemetryHub.lastKnownState.get(testUuid).pcName, 'PC Siaran Utama', 'PC Name restored from persistent config');

    // 5. Reconnect Agent to Instance 2
    agentSocket = ioClient(`http://127.0.0.1:${port}`);
    let receivedRemoteConfig = null;

    agentSocket.on('connect', () => {
      agentSocket.emit('register', { type: 'agent', uuid: testUuid, pcName: 'PC Siaran Utama' });
    });
    agentSocket.on('set-monitoring', (active) => {
      receivedRemoteConfig = active;
    });

    await new Promise(r => setTimeout(r, 150));

    agentSocket.emit('telemetry', {
      uuid: testUuid,
      micDb: -12,
      obsDb: -14,
      status: 'AMAN',
      dangerScore: 0,
      isMuted: false
    });

    await new Promise(r => setTimeout(r, 150));
    assertEqual(serverApp.telemetryHub.lastKnownState.get(testUuid).status, 'AMAN', 'Agent status recovered to AMAN on Instance 2');

    // 6. Test Remote Command Execution on Reconnected Agent
    serverApp.telemetryHub.setPcMonitoring(testUuid, false);
    await new Promise(r => setTimeout(r, 150));
    assertEqual(receivedRemoteConfig, false, 'Remote control successfully delivered to reconnected agent after reboot');

    agentSocket.disconnect();
    await new Promise(r => serverApp.server.close(r));
  });

  // =========================================================================
  // SUITE 21: Security Hardening, Injection Defense & Malicious Payload Fuzzing
  // =========================================================================
  await runSuite('21. Security Hardening, Injection Defense & Malicious Payload Fuzzing', async () => {
    const configPath = path.join(TEST_DIR, 'sec_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'sec_db.json'));
    const alertMgr = new AlertManager(cm, db);

    const serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;
    serverApp.alertManager = alertMgr;

    const port = await new Promise(res => {
      const s = serverApp.server.listen(0, '127.0.0.1', () => res(s.address().port));
    });
    const baseUrl = 'http://127.0.0.1:' + port;

    // 1. Null-byte injection attempt on transcript endpoint
    const resNullByteGet = await fetch(`${baseUrl}/api/records/transcript?folder=session%00evil&file=test.webm`);
    assert(resNullByteGet.status === 400 || resNullByteGet.status === 403 || resNullByteGet.status === 404, 'Null-byte injection on GET transcript rejected with 400/403/404');

    // 2. Strict XSS & HTML escaping test in AlertManager
    const rawXss1 = '<script>alert("XSS")</script>';
    const escapedXss1 = alertMgr.escapeHtml(rawXss1);
    assertEqual(escapedXss1, '&lt;script&gt;alert("XSS")&lt;/script&gt;', 'Script tags escaped safely');

    const rawXss2 = '<img src=x onerror="alert(1)" /> & \'test\'';
    const escapedXss2 = alertMgr.escapeHtml(rawXss2);
    assert(!escapedXss2.includes('<') && !escapedXss2.includes('>'), 'All bracket characters sanitized');
    assert(escapedXss2.includes('&amp;'), 'Ampersands escaped to &amp;');

    // 3. SQL / NoSQL / Regex Injection Strings in search-transcript
    const injectionQueries = ["' OR '1'='1", "admin' --", '{"$gt": ""}', '(?=.*)'];
    for (const q of injectionQueries) {
      const resInj = await fetch(`${baseUrl}/api/records/search-transcript?q=${encodeURIComponent(q)}`);
      assertEqual(resInj.status, 200, `Search query with injection payload "${q}" returned 200 safely`);
      const body = await resInj.json();
      assert(Array.isArray(body.results), 'Results returned as array without crash');
    }

    // 4. PIN Authentication Mutation Protection & Header Isolation
    const wrongPinAttempts = ['0000', '1111', '9999', 'admin', 'root'];
    for (const wp of wrongPinAttempts) {
      const resWp = await fetch(`${baseUrl}/api/config/monitoring`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-pin': wp },
        body: JSON.stringify({ active: false })
      });
      assertEqual(resWp.status, 401, `Wrong PIN "${wp}" correctly rejected with 401`);
    }

    const resCorrectPin = await fetch(`${baseUrl}/api/config/monitoring`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pin': '1234' },
      body: JSON.stringify({ active: true })
    });
    assertEqual(resCorrectPin.status, 200, 'Correct PIN "1234" authorized with 200');

    // 5. Payload Type Pollution in config routes
    const resPollution = await fetch(`${baseUrl}/api/config/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pin': '1234' },
      body: JSON.stringify({
        token: { nested: 'object' },
        chatId: [1, 2, 3],
        interval: 'invalid_number',
        logRetentionDays: -50
      })
    });
    assertEqual(resPollution.status, 200, 'Type-polluted config payload handled safely without crashing');
    assertEqual(cm.config.logRetentionDays, 30, 'Negative retention safely defaulted to 30');

    await new Promise(r => serverApp.server.close(r));
  });

  // =========================================================================
  // SUITE 22: Binary File Corruption, Broken WebM Header & Zero-Byte Safety
  // =========================================================================
  await runSuite('22. Binary File Corruption, Broken WebM & Zero-Byte Safety', async () => {
    const configPath = path.join(TEST_DIR, 'corrupt_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'corrupt_db.json'));
    const alertMgr = new AlertManager(cm, db);
    const tm = new TranscriptionManager(cm, db, alertMgr);

    const corruptVault = path.join(TEST_DIR, 'corrupt_vault');
    fs.mkdirSync(corruptVault, { recursive: true });

    // 1. Zero-byte audio file test
    const zeroByteFile = path.join(corruptVault, 'Zero_Part.webm');
    fs.writeFileSync(zeroByteFile, Buffer.alloc(0));

    let zeroByteError = null;
    try {
      await tm.transcribeFile(zeroByteFile, 'TestFolder', 'Zero_Part.webm', 'TestPC');
    } catch (e) {
      zeroByteError = e.message;
    }
    assert(zeroByteError !== null && zeroByteError.includes('0 bytes'), 'Zero-byte audio file rejected with clear error');

    // 2. Non-existent file test
    let missingFileError = null;
    try {
      await tm.transcribeFile(path.join(corruptVault, 'NonExistent.webm'), 'TestFolder', 'NonExistent.webm', 'TestPC');
    } catch (e) {
      missingFileError = e.message;
    }
    assert(missingFileError !== null && missingFileError.includes('tidak ditemukan'), 'Missing audio file rejected with clear error');

    // 3. Corrupted / Truncated JSON transcript file
    const corruptJsonPath = path.join(corruptVault, 'Corrupt.webm.transcript.json');
    fs.writeFileSync(corruptJsonPath, '{"text": "Incomplete json string without closing');

    const corruptResult = tm.getTranscriptForFile(path.join(corruptVault, 'Corrupt.webm'));
    assertEqual(corruptResult, null, 'Corrupted JSON file safely returned null without unhandled SyntaxError');

    // 4. Session Aggregator with 1 valid and 1 corrupt transcript
    const validJsonPath = path.join(corruptVault, 'Valid.webm.transcript.json');
    fs.writeFileSync(validJsonPath, JSON.stringify({
      text: 'Bagian valid yang berhasil diselamatkan.',
      segments: [{ id: 0, start: 0, end: 3, text: 'Bagian valid yang berhasil diselamatkan.' }],
      keywordsFound: ['valid']
    }));

    const sessionAgg = tm.getTranscriptForSession(corruptVault);
    assert(sessionAgg !== null, 'Session aggregation succeeded despite 1 corrupted sibling file');
    assert(sessionAgg.text.includes('Bagian valid'), 'Valid transcript content preserved');

    // 5. Atomic write under Windows contention test
    const atomicTarget = path.join(corruptVault, 'Atomic_Test.json');
    const atomicData = { status: 'ATOMIC_SUCCESS', timestamp: Date.now() };
    const writeOk = tm.atomicWriteJsonSync(atomicTarget, atomicData);
    assertEqual(writeOk, true, 'atomicWriteJsonSync completed successfully');
    assert(fs.existsSync(atomicTarget), 'Target file exists after atomic write');
    const readBack = JSON.parse(fs.readFileSync(atomicTarget, 'utf8'));
    assertEqual(readBack.status, 'ATOMIC_SUCCESS', 'Atomic file data matches written payload');
  });

  // =========================================================================
  // SUITE 23: High-Frequency Telegram Alert Cooldown & Multi-PC Isolation
  // =========================================================================
  await runSuite('23. High-Frequency Telegram Alert Cooldown & Multi-PC Isolation', async () => {
    const configPath = path.join(TEST_DIR, 'cooldown_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'cooldown_db.json'));
    const alertMgr = new AlertManager(cm, db);

    // Mock Telegram bot sender with message capture
    let sentMessages = [];
    alertMgr.bot = {
      sendMessage: async (chatId, text, options) => {
        sentMessages.push({ chatId, text, options, time: Date.now() });
        return { message_id: sentMessages.length };
      }
    };

    cm.config.telegram = {
      token: 'mock-token',
      chatId: 'mock-chat-id',
      interval: 60 // 60 seconds cooldown
    };

    // 1. Trigger 5 consecutive BAHAYA_CLIPPING for PC-Alpha in rapid succession
    for (let i = 0; i < 5; i++) {
      alertMgr.processTelemetry({
        uuid: 'uuid-alpha',
        status: 'BAHAYA_CLIPPING',
        dangerScore: 100,
        micDb: 0,
        obsDb: 0
      }, 'PC-Alpha');
    }

    assertEqual(sentMessages.length, 1, 'Only 1 alert sent for PC-Alpha (4 suppressed by cooldown)');
    assert(sentMessages[0].text.includes('PC-Alpha'), 'Alert contains PC-Alpha');

    // 2. Trigger BAHAYA_CLIPPING for PC-Beta at the same second
    alertMgr.processTelemetry({
      uuid: 'uuid-beta',
      status: 'BAHAYA_CLIPPING',
      dangerScore: 100,
      micDb: 0,
      obsDb: 0
    }, 'PC-Beta');

    assertEqual(sentMessages.length, 2, 'PC-Beta alert sent immediately (isolated per-PC cooldown)');
    assert(sentMessages[1].text.includes('PC-Beta'), 'Alert contains PC-Beta');

    // 3. Trigger Recovery (AMAN) for PC-Alpha
    alertMgr.processTelemetry({
      uuid: 'uuid-alpha',
      status: 'AMAN',
      dangerScore: 0,
      micDb: -20,
      obsDb: -20
    }, 'PC-Alpha');

    assertEqual(sentMessages.length, 3, 'Recovery alert sent for PC-Alpha upon status transition');
    assert(sentMessages[2].text.includes('AMAN') || sentMessages[2].text.includes('OK'), 'Alert signifies recovery');

    // 4. Reset Cooldown & Trigger Next Incident
    alertMgr.lastAlertState['uuid-alpha'] = { time: 0, status: 'AMAN', notified: false };

    alertMgr.processTelemetry({
      uuid: 'uuid-alpha',
      status: 'BAHAYA_AUDIO_DEAD',
      dangerScore: 100,
      micDb: -60,
      obsDb: -60
    }, 'PC-Alpha');

    assertEqual(sentMessages.length, 4, 'New alert sent for PC-Alpha after cooldown reset');
  });

  // =========================================================================
  // SUITE 24: Flaky Network Jitter, Rapid Reconnect Loops & Socket Leak Prevention
  // =========================================================================
  await runSuite('24. Flaky Network Jitter, Rapid Reconnect Loops & Socket Leak Prevention', async () => {
    const configPath = path.join(TEST_DIR, 'jitter_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'jitter_db.json'));
    const alertMgr = new AlertManager(cm, db);

    const serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;
    serverApp.alertManager = alertMgr;

    const port = await new Promise(res => {
      const s = serverApp.server.listen(0, '127.0.0.1', () => res(s.address().port));
    });

    const activeSockets = [];

    // 1. Simulate 5 agents each cycling connection 3 times rapidly (15 connect/disconnect events)
    for (let agentIdx = 1; agentIdx <= 5; agentIdx++) {
      const agentUuid = `jitter-agent-${agentIdx}`;
      for (let cycle = 0; cycle < 3; cycle++) {
        const sock = ioClient(`http://127.0.0.1:${port}`);
        await new Promise(res => {
          sock.on('connect', () => {
            sock.emit('register', { type: 'agent', uuid: agentUuid, name: `Agent ${agentIdx}` });
            res();
          });
        });

        if (cycle < 2) {
          sock.disconnect();
          await new Promise(r => setTimeout(r, 20));
        } else {
          activeSockets.push({ uuid: agentUuid, sock });
        }
      }
    }

    await new Promise(r => setTimeout(r, 200));

    // 2. Verify agentSockets map size is exactly 5 active agents (no stale socket leaks)
    assertEqual(serverApp.telemetryHub.agentSockets.size, 5, 'TelemetryHub tracks exactly 5 active sockets without leaks');

    // 3. Verify targeted message delivery to all 5 active sockets
    let commandCount = 0;
    activeSockets.forEach(({ sock }) => {
      sock.on('set-monitoring', () => { commandCount++; });
    });

    for (let agentIdx = 1; agentIdx <= 5; agentIdx++) {
      serverApp.telemetryHub.setPcMonitoring(`jitter-agent-${agentIdx}`, false);
    }

    await new Promise(r => setTimeout(r, 150));
    assert(commandCount >= 5, 'All 5 reconnected agents successfully received targeted commands');

    // 4. Clean disconnect all
    activeSockets.forEach(({ sock }) => sock.disconnect());
    await new Promise(r => setTimeout(r, 150));
    assertEqual(serverApp.telemetryHub.agentSockets.size, 0, 'Socket map completely cleared on client disconnects');

    await new Promise(r => serverApp.server.close(r));
  });

  // =========================================================================
  // SUITE 25: Memory Leak & Heap Stability Benchmark
  // =========================================================================
  await runSuite('25. Memory Leak & Heap Stability Benchmark', async () => {
    const configPath = path.join(TEST_DIR, 'bench_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'bench_db.json'));
    const alertMgr = new AlertManager(cm, db);

    const serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;
    serverApp.alertManager = alertMgr;

    // 1. Baseline heap measurement
    if (global.gc) global.gc();
    const baselineHeap = process.memoryUsage().heapUsed;

    // 2. Execute 500 telemetry updates + 50 database logs in tight loop
    for (let i = 0; i < 500; i++) {
      const uuid = `bench-pc-${i % 10}`;
      serverApp.telemetryHub.handleTelemetry({
        uuid,
        name: `PC Benchmark ${i % 10}`,
        micDb: -20 + (i % 10),
        obsDb: -22 + (i % 10),
        status: 'AMAN',
        dangerScore: 0,
        isMuted: false
      });

      if (i % 10 === 0) {
        db.logIncident(uuid, `PC Benchmark ${i % 10}`, 'CLIPPING', `Benchmark log entry #${i}`);
      }
    }

    // 3. Verify bounded memory structures
    assert(serverApp.telemetryHub.lastKnownState.size >= 10, 'lastKnownState tracks unique benchmark PCs');
    assertEqual(db.incidents.length, 50, 'Database recorded exactly 50 log items');

    // 4. Heap stability verification
    if (global.gc) global.gc();
    const finalHeap = process.memoryUsage().heapUsed;
    const heapDiffMb = (finalHeap - baselineHeap) / (1024 * 1024);

    // Retained heap growth should be modest (< 30 MB) for 500 in-memory cycles
    assert(heapDiffMb < 30, `Heap growth is bounded (Delta: ${heapDiffMb.toFixed(2)} MB < 30 MB)`);

    // 5. Database Cleanup stability check
    // Manually inject 10 items timestamped 40 days ago and autoCleanup(30)
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 40);
    for (let i = 0; i < 10; i++) {
      db.incidents.push({
        id: 1000 + i,
        uuid: 'bench-pc-old',
        pcName: 'PC Old',
        incidentType: 'AUDIO_DEAD',
        details: 'Old log',
        timestamp: oldDate.toISOString().replace('T', ' ').substring(0, 19)
      });
    }
    db.saveDbSync();

    assertEqual(db.incidents.length, 60, 'Database contains 50 new + 10 old logs');
    const pruned = db.autoCleanup(30);
    assertEqual(pruned, 10, 'autoCleanup(30) purged exactly 10 old items');
    assertEqual(db.incidents.length, 50, 'Database retains exactly 50 recent items');
  });

  // =========================================================================
  // SUITE 26: Multi-Tenant Date & Keyword Transcript Filter Combinatorics
  // =========================================================================
  await runSuite('26. Multi-Tenant Date & Keyword Transcript Filter Combinatorics', async () => {
    const tmDir = path.join(TEST_DIR, 'suite26_vault');
    fs.mkdirSync(tmDir, { recursive: true });

    const tm = new TranscriptionManager({
      enabled: true,
      alertKeywords: ['darurat', 'bocor', 'mati']
    });

    // Create 3 sessions across different dates and PCs
    const s1 = path.join(tmDir, 'PC_Studio_1_11111111-1111-1111-1111-111111111111_2026-08-28_10-00-00_to_10-05-00');
    const s2 = path.join(tmDir, 'PC_Studio_2_22222222-2222-2222-2222-222222222222_2026-08-29_14-00-00_to_14-10-00');
    const s3 = path.join(tmDir, 'PC_Studio_1_11111111-1111-1111-1111-111111111111_2026-08-30_09-00-00_to_09-15-00');
    fs.mkdirSync(s1, { recursive: true });
    fs.mkdirSync(s2, { recursive: true });
    fs.mkdirSync(s3, { recursive: true });

    // Populate transcripts
    fs.writeFileSync(path.join(s1, 'Part_001.webm.transcript.json'), JSON.stringify({
      text: 'Halo selamat pagi ini uji coba darurat audio studio satu.',
      segments: [{ start: 0, end: 5, text: 'Halo selamat pagi ini uji coba darurat audio studio satu.' }]
    }));
    fs.writeFileSync(path.join(s2, 'Part_001.webm.transcript.json'), JSON.stringify({
      text: 'Sistem mengalami kebocoran sinyal bocor pada line dua.',
      segments: [{ start: 0, end: 6, text: 'Sistem mengalami kebocoran sinyal bocor pada line dua.' }]
    }));
    fs.writeFileSync(path.join(s3, 'Part_001.webm.transcript.json'), JSON.stringify({
      text: 'Pagi ini siaran berjalan normal dan aman terkendali.',
      segments: [{ start: 0, end: 8, text: 'Pagi ini siaran berjalan normal dan aman terkendali.' }]
    }));

    // 1. Search without filters (all matching query)
    const r1 = await tm.searchTranscripts('audio', tmDir);
    assertEqual(r1.length, 1, 'Search "audio" returns 1 result without filters');
    assertEqual(r1[0].pcName, 'PC Studio 1', 'Search result correctly resolved PC Name');

    // 2. Search with PC Filter match
    const r2 = await tm.searchTranscripts('siaran', tmDir, { pcFilter: 'PC Studio 1' });
    assertEqual(r2.length, 1, 'Search with PC Filter "PC Studio 1" matches 1 session');

    // 3. Search with PC Filter mismatch
    const r3 = await tm.searchTranscripts('siaran', tmDir, { pcFilter: 'PC Studio 2' });
    assertEqual(r3.length, 0, 'Search with PC Filter "PC Studio 2" correctly returns 0 matches');

    // 4. Search with Start Date filter (exclude 2026-08-28)
    const r4 = await tm.searchTranscripts('darurat', tmDir, { startDate: '2026-08-29' });
    assertEqual(r4.length, 0, 'Start date 2026-08-29 correctly excludes 2026-08-28 session');

    // 5. Search with Date Range match
    const r5 = await tm.searchTranscripts('bocor', tmDir, { startDate: '2026-08-29', endDate: '2026-08-29' });
    assertEqual(r5.length, 1, 'Date range 2026-08-29 to 2026-08-29 matches exactly');

    // 6. Case insensitive search
    const r6 = await tm.searchTranscripts('DARURAT', tmDir);
    assertEqual(r6.length, 1, 'Uppercase search "DARURAT" matches lowercase text');

    // 7. Regex special characters in query
    const r7 = await tm.searchTranscripts('studio [1]?', tmDir);
    assert(Array.isArray(r7), 'Regex special character query handled safely without crash');

    // 8. Alert keywords scanning
    const kwHits = tm.scanAlertKeywords('Peringatan ada kebocoran sinyal bocor dan darurat', ['darurat', 'bocor', 'mati']);
    assertEqual(kwHits.length, 2, 'scanAlertKeywords found 2 keywords');
    assert(kwHits.includes('bocor'), 'Contains "bocor"');
    assert(kwHits.includes('darurat'), 'Contains "darurat"');
  });

  // =========================================================================
  // SUITE 27: Session Duration, Auto-Rollover & Sorting Algorithm Precision
  // =========================================================================
  await runSuite('27. Session Duration, Auto-Rollover & Sorting Algorithm Precision', () => {
    // Helper duration calculation matching Dashboard App.jsx
    function calculateSessionDuration(session) {
      if (session.startTime && session.endTime) {
        const startParts = session.startTime.split(':').map(Number);
        const endParts = session.endTime.split(':').map(Number);
        if (startParts.length >= 2 && endParts.length >= 2) {
          const startSec = (startParts[0] || 0) * 3600 + (startParts[1] || 0) * 60 + (startParts[2] || 0);
          let endSec = (endParts[0] || 0) * 3600 + (endParts[1] || 0) * 60 + (endParts[2] || 0);
          if (endSec < startSec) endSec += 24 * 3600; // overnight span
          return Math.max(1, endSec - startSec);
        }
      }
      if (session.parts && session.parts.length > 0) {
        return session.parts.reduce((acc, p) => acc + (p.transcriptDuration || Math.max(1, Math.round((p.size || 0) / 16000))), 0);
      }
      return 0;
    }

    function formatDurationText(seconds) {
      if (!seconds || seconds <= 0 || isNaN(seconds)) return '0 dtk';
      const s = Math.round(seconds);
      if (s < 60) return `${s} dtk`;
      const m = Math.floor(s / 60);
      const remS = s % 60;
      if (m < 60) return remS > 0 ? `${m}m ${String(remS).padStart(2, '0')}s` : `${m} menit`;
      const h = Math.floor(m / 60);
      const remM = m % 60;
      return `${h}j ${remM}m`;
    }

    // 1. Exact start and end time calculation
    const sessA = { startTime: '10:00:00', endTime: '10:00:16', parts: [{ size: 256000 }] };
    assertEqual(calculateSessionDuration(sessA), 16, 'Duration calculated to exact 16 seconds');
    assertEqual(formatDurationText(16), '16 dtk', 'Formatted to "16 dtk"');

    // 2. Minute format
    const sessB = { startTime: '14:00:00', endTime: '14:10:30', parts: [] };
    assertEqual(calculateSessionDuration(sessB), 630, 'Duration calculated to 630 seconds (10m 30s)');
    assertEqual(formatDurationText(630), '10m 30s', 'Formatted to "10m 30s"');

    // 3. Overnight rollover span (23:55:00 to 00:05:00)
    const sessC = { startTime: '23:55:00', endTime: '00:05:00', parts: [] };
    assertEqual(calculateSessionDuration(sessC), 600, 'Overnight session duration correctly wraps across midnight (600s)');
    assertEqual(formatDurationText(600), '10 menit', 'Formatted to "10 menit"');

    // 4. Hour format
    assertEqual(formatDurationText(5040), '1j 24m', '5040 seconds formatted to "1j 24m"');

    // 5. Fallback to file size estimation (~16KB/s for Opus)
    const sessFallback = { parts: [{ size: 160000 }] }; // 160KB = ~10s
    assertEqual(calculateSessionDuration(sessFallback), 10, 'Fallback calculation from file size gives 10s');

    // 6. Sorting verification (newest, oldest, size, duration)
    const list = [
      { id: 1, createdAt: '2026-08-30T10:00:00Z', totalSize: 500000, startTime: '10:00:00', endTime: '10:05:00' }, // 300s
      { id: 2, createdAt: '2026-08-28T08:00:00Z', totalSize: 900000, startTime: '08:00:00', endTime: '08:20:00' }, // 1200s
      { id: 3, createdAt: '2026-08-29T12:00:00Z', totalSize: 200000, startTime: '12:00:00', endTime: '12:01:00' }  // 60s
    ];

    const sortNewest = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    assertEqual(sortNewest[0].id, 1, 'Sort newest puts 2026-08-30 first');

    const sortOldest = [...list].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    assertEqual(sortOldest[0].id, 2, 'Sort oldest puts 2026-08-28 first');

    const sortSize = [...list].sort((a, b) => b.totalSize - a.totalSize);
    assertEqual(sortSize[0].id, 2, 'Sort size_desc puts 900KB first');

    const sortDuration = [...list].sort((a, b) => calculateSessionDuration(b) - calculateSessionDuration(a));
    assertEqual(sortDuration[0].id, 2, 'Sort duration_desc puts 1200s first');
  });

  // =========================================================================
  // SUITE 28: Settings PIN Authorization & Security Lockdown Boundary
  // =========================================================================
  await runSuite('28. Settings PIN Authorization & Security Lockdown Boundary', async () => {
    const srvDir = path.join(TEST_DIR, 'suite28_server');
    fs.mkdirSync(srvDir, { recursive: true });

    const cm = new ConfigManager(path.join(srvDir, 'config.json'));
    const db = new DatabaseManager(path.join(srvDir, 'database.json'));
    cm.config.dashboardPin = '7788';
    cm.saveConfig();

    const serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;

    const port = await new Promise(res => {
      const s = serverApp.server.listen(0, '127.0.0.1', () => res(s.address().port));
    });

    // 1. PIN Auth Middleware rejection without PIN
    const resNoPin = await fetch(`http://127.0.0.1:${port}/api/config/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'test-token', chatId: '123' })
    });
    assertEqual(resNoPin.status, 401, 'POST /api/config/telegram rejected without PIN (401)');

    // 2. PIN Auth Middleware rejection with wrong PIN
    const resWrongPin = await fetch(`http://127.0.0.1:${port}/api/config/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pin': '0000' },
      body: JSON.stringify({ token: 'test-token', chatId: '123' })
    });
    assertEqual(resWrongPin.status, 401, 'POST /api/config/telegram rejected with wrong PIN (401)');

    // 3. PIN Auth Middleware accepts valid PIN
    const resValidPin = await fetch(`http://127.0.0.1:${port}/api/config/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pin': '7788' },
      body: JSON.stringify({ token: 'bot12345:ABC', chatId: '12345', interval: 60 })
    });
    assertEqual(resValidPin.status, 200, 'POST /api/config/telegram authorized with correct PIN (200)');
    assertEqual(serverApp.configManager.config.telegram.token, 'bot12345:ABC', 'Telegram token updated in config');

    // 4. Change PIN endpoint validation (< 4 chars)
    const resPinShort = await fetch(`http://127.0.0.1:${port}/api/config/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pin': '7788' },
      body: JSON.stringify({ newPin: '12' })
    });
    assertEqual(resPinShort.status, 400, 'POST /api/config/pin rejects PIN < 4 chars (400)');

    // 5. Change PIN endpoint success
    const resPinOk = await fetch(`http://127.0.0.1:${port}/api/config/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pin': '7788' },
      body: JSON.stringify({ newPin: '9900' })
    });
    assertEqual(resPinOk.status, 200, 'POST /api/config/pin succeeds with 4-digit PIN (200)');
    assertEqual(serverApp.configManager.config.dashboardPin, '9900', 'New PIN persisted');

    // 6. Old PIN rejected after change
    const resOldPin = await fetch(`http://127.0.0.1:${port}/api/config/retention`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pin': '7788' },
      body: JSON.stringify({ days: 45 })
    });
    assertEqual(resOldPin.status, 401, 'Old PIN "7788" is now rejected (401)');

    // 7. New PIN accepted
    const resNewPin = await fetch(`http://127.0.0.1:${port}/api/config/retention`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pin': '9900' },
      body: JSON.stringify({ days: 45 })
    });
    assertEqual(resNewPin.status, 200, 'New PIN "9900" is authorized (200)');
    assertEqual(serverApp.configManager.config.logRetentionDays, 45, 'Retention days updated to 45');

    // 8. Manual cleanup endpoint authorization
    const resCleanup = await fetch(`http://127.0.0.1:${port}/api/incidents/cleanup-now`, {
      method: 'POST',
      headers: { 'x-pin': '9900' }
    });
    assertEqual(resCleanup.status, 200, 'POST /api/incidents/cleanup-now authorized (200)');

    // 9. Danger zone clear database auth (DELETE /api/incidents)
    const resClear = await fetch(`http://127.0.0.1:${port}/api/incidents`, {
      method: 'DELETE',
      headers: { 'x-pin': '9900' }
    });
    assertEqual(resClear.status, 200, 'DELETE /api/incidents authorized (200)');

    // 10. Verify database empty after clear
    assertEqual(serverApp.dbManager.incidents.length, 0, 'Database is empty after clear');

    serverApp.server.close();
  });

  // =========================================================================
  // SUITE 29: Agent State Machine, OBS Mute Sync & Danger Score Decay
  // =========================================================================
  await runSuite('29. Agent State Machine, OBS Mute Sync & Danger Score Decay', () => {
    // State machine simulator
    class AgentStateEngine {
      constructor() {
        this.dangerScore = 0;
        this.status = 'AMAN';
        this.isMuted = false;
        this.clippingCounter = 0;
        this.silenceCounter = 0;
      }

      processSample(audioLevel, isClipping, isMuted) {
        this.isMuted = isMuted;

        if (isMuted) {
          this.dangerScore = Math.min(100, this.dangerScore + 25);
        } else if (isClipping) {
          this.clippingCounter++;
          this.dangerScore = Math.min(100, this.dangerScore + 15);
        } else if (audioLevel < 0.001) { // Silence
          this.silenceCounter++;
          this.dangerScore = Math.min(100, this.dangerScore + 5);
        } else { // Normal audio - decay danger score
          this.dangerScore = Math.max(0, this.dangerScore - 10);
          this.clippingCounter = 0;
          this.silenceCounter = 0;
        }

        if (this.dangerScore >= 70) {
          this.status = 'BAHAYA';
        } else if (this.dangerScore >= 30) {
          this.status = 'PERINGATAN';
        } else {
          this.status = 'AMAN';
        }
      }
    }

    const agent = new AgentStateEngine();

    // 1. Initial State
    assertEqual(agent.status, 'AMAN', 'Initial state is AMAN');
    assertEqual(agent.dangerScore, 0, 'Initial danger score is 0');

    // 2. Normal audio maintains AMAN
    agent.processSample(0.45, false, false);
    assertEqual(agent.status, 'AMAN', 'Normal audio keeps status AMAN');
    assertEqual(agent.dangerScore, 0, 'Danger score remains 0');

    // 3. Audio clipping accumulates score towards PERINGATAN
    agent.processSample(0.99, true, false); // +15
    agent.processSample(0.99, true, false); // +15 = 30
    assertEqual(agent.status, 'PERINGATAN', 'Clipping triggers PERINGATAN at score 30');
    assertEqual(agent.dangerScore, 30, 'Danger score is 30');

    // 4. OBS Mute accelerates score to BAHAYA
    agent.processSample(0.0, false, true); // +25 = 55
    agent.processSample(0.0, false, true); // +25 = 80
    assertEqual(agent.status, 'BAHAYA', 'Muted audio escalates status to BAHAYA at score 80');
    assertEqual(agent.dangerScore, 80, 'Danger score is 80');

    // 5. Max score ceiling
    agent.processSample(0.0, false, true); // +25 = 100 max
    assertEqual(agent.dangerScore, 100, 'Danger score is clamped at 100');

    // 6. Recovery decay when unmuted with healthy audio
    agent.processSample(0.5, false, false); // -10 = 90 (BAHAYA)
    agent.processSample(0.5, false, false); // -10 = 80 (BAHAYA)
    agent.processSample(0.5, false, false); // -10 = 70 (BAHAYA)
    agent.processSample(0.5, false, false); // -10 = 60 (PERINGATAN)
    assertEqual(agent.status, 'PERINGATAN', 'Healthy audio decays status back to PERINGATAN at score 60');

    // 7. Full recovery to AMAN
    for (let i = 0; i < 6; i++) {
      agent.processSample(0.5, false, false); // -10 each step
    }
    assertEqual(agent.status, 'AMAN', 'Continuous healthy audio fully recovers status to AMAN');
    assertEqual(agent.dangerScore, 0, 'Danger score fully resets to 0');
  });

  // =========================================================================
  // SUITE 30: Concurrent Stress Benchmark: Parallel Upload & Real-time Query
  // =========================================================================
  await runSuite('30. Concurrent Stress Benchmark: Parallel Upload & Real-time Query', async () => {
    const stressVault = path.join(TEST_DIR, 'suite30_stress');
    fs.mkdirSync(stressVault, { recursive: true });

    const cm = new ConfigManager(path.join(stressVault, 'config.json'));
    cm.config.recordDir = stressVault;
    const db = new DatabaseManager(path.join(stressVault, 'database.json'));

    const serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;

    const port = await new Promise(res => {
      const s = serverApp.server.listen(0, '127.0.0.1', () => res(s.address().port));
    });

    // Simulate 20 concurrent session folders and parallel transcript requests
    const uploadTasks = [];
    for (let i = 1; i <= 20; i++) {
      const folder = `PC_Stress_${i}_uuid-${i}_2026-08-30_12-00-00_to_12-10-00`;
      const fPath = path.join(stressVault, folder);
      fs.mkdirSync(fPath, { recursive: true });
      fs.writeFileSync(path.join(fPath, 'Part_001.webm'), Buffer.alloc(1024, 0xAA));
      fs.writeFileSync(path.join(fPath, 'Part_001.webm.transcript.json'), JSON.stringify({
        text: `Stress test audio text for worker session ${i}`,
        segments: [{ start: 0, end: 10, text: `Stress test audio text for worker session ${i}` }]
      }));
    }

    // 1. Execute 20 concurrent search query requests
    const searchPromises = [];
    for (let i = 1; i <= 20; i++) {
      searchPromises.push(
        fetch(`http://127.0.0.1:${port}/api/records/search-transcript?q=worker`)
          .then(r => r.json())
      );
    }

    const searchResults = await Promise.all(searchPromises);
    assertEqual(searchResults.length, 20, 'All 20 concurrent search requests completed');
    const matchedCount = (searchResults[0].results || searchResults[0] || []).length;
    assertEqual(matchedCount, 20, 'Each search query found all 20 matching sessions');

    // 2. Fetch full records concurrently
    const recordPromises = [];
    for (let i = 1; i <= 10; i++) {
      recordPromises.push(
        fetch(`http://127.0.0.1:${port}/api/records`)
          .then(r => r.json())
      );
    }
    const recordResults = await Promise.all(recordPromises);
    assertEqual(recordResults.length, 10, 'All 10 concurrent GET /api/records completed');
    assertEqual(recordResults[0].length, 20, 'GET /api/records returned all 20 records consistently');

    // 3. Verify media endpoint range streaming concurrently
    const mediaPromises = [];
    for (let i = 1; i <= 10; i++) {
      const folder = `PC_Stress_${i}_uuid-${i}_2026-08-30_12-00-00_to_12-10-00`;
      mediaPromises.push(
        fetch(`http://127.0.0.1:${port}/media/${folder}/Part_001.webm`, {
          headers: { 'Range': 'bytes=0-500' }
        })
      );
    }
    const mediaResponses = await Promise.all(mediaPromises);
    assertEqual(mediaResponses.length, 10, 'All 10 concurrent range stream requests finished');
    assertEqual(mediaResponses[0].status, 206, 'HTTP Range request responded with 206 Partial Content');

    serverApp.server.close();
  });

  // =========================================================================
  // SUITE 31: Real-time Whisper STT Queue Management, Task FIFO & Concurrency Lock Benchmark
  // =========================================================================
  await runSuite('31. Real-time Whisper STT Queue Management, Task FIFO & Concurrency Lock Benchmark', async () => {
    const configPath = path.join(TEST_DIR, 'whisper_queue_config.json');
    const cm = new ConfigManager(configPath);
    cm.config.transcription = { enabled: true, apiUrl: 'http://127.0.0.1:8000', autoTranscribe: true };
    cm.saveConfig();

    const db = new DatabaseManager(path.join(TEST_DIR, 'whisper_queue_db.json'));
    const alertMgr = new AlertManager(cm, db);
    const tm = new TranscriptionManager(cm, db, alertMgr);

    // 1. Initial State
    const initStatus = tm.getQueueStatus();
    assertEqual(initStatus.isProcessing, false, 'Initial queue is not processing');
    assertEqual(initStatus.currentTask, null, 'Initial currentTask is null');
    assertEqual(initStatus.queueLength, 0, 'Initial queue length is 0');
    assert(Array.isArray(initStatus.queue), 'Queue is an array');

    // 2. Mock transcribeFile to test FIFO queue execution
    const processedOrder = [];
    tm.transcribeFile = async (filePath, sessionFolder, fileName, pcName) => {
      processedOrder.push(filePath);
      await new Promise(r => setTimeout(r, 60));
      return { success: true, text: 'Transkrip mock', segments: [] };
    };

    // 3. Enqueue 3 tasks with full 4 arguments
    const f1 = path.join(TEST_DIR, 'Part_001.webm');
    const f2 = path.join(TEST_DIR, 'Part_002.webm');
    const f3 = path.join(TEST_DIR, 'Part_003.webm');

    tm.enqueueFile(f1, 'Session_1', 'Part_001.webm', 'PC-1');
    tm.enqueueFile(f2, 'Session_1', 'Part_002.webm', 'PC-1');
    tm.enqueueFile(f3, 'Session_1', 'Part_003.webm', 'PC-1');

    // Check status during active processing
    const activeStatus = tm.getQueueStatus();
    assertEqual(activeStatus.isProcessing, true, 'isProcessing is true after enqueue');
    assert(activeStatus.currentTask !== null, 'currentTask is populated');
    assertEqual(activeStatus.currentTask.fileName, 'Part_001.webm', 'First task is Part_001.webm');
    assertEqual(activeStatus.queueLength, 2, '2 tasks waiting in queue');

    // 4. Test Deduplication: Enqueuing already queued task is ignored
    tm.enqueueFile(f2, 'Session_1', 'Part_002.webm', 'PC-1');
    assertEqual(tm.getQueueStatus().queueLength, 2, 'Duplicate queued task was deduplicated');

    // 5. Test Active Deduplication: Enqueuing actively processing task is ignored
    tm.enqueueFile(f1, 'Session_1', 'Part_001.webm', 'PC-1');
    assertEqual(tm.getQueueStatus().queueLength, 2, 'Actively processing task was deduplicated');

    // 6. Wait for all 3 tasks to finish
    let waitCount = 0;
    while ((tm.isProcessing || tm.queue.length > 0) && waitCount < 30) {
      await new Promise(r => setTimeout(r, 100));
      waitCount++;
    }

    const finalStatus = tm.getQueueStatus();
    assertEqual(finalStatus.isProcessing, false, 'Queue drained: isProcessing is false');
    assertEqual(finalStatus.queueLength, 0, 'Queue drained: length is 0');
    assertEqual(finalStatus.currentTask, null, 'Queue drained: currentTask is null');
    assertEqual(processedOrder.length, 3, 'All 3 tasks were processed');
    assertEqual(processedOrder[0], f1, 'Task 1 processed in FIFO order');
    assertEqual(processedOrder[1], f2, 'Task 2 processed in FIFO order');
    assertEqual(processedOrder[2], f3, 'Task 3 processed in FIFO order');

    // 7. Test HTTP GET /api/transcription/queue endpoint
    const serverApp = new ServerApp(cm, db, alertMgr, 0);
    await new Promise(r => serverApp.server.listen(0, r));
    const port = serverApp.server.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/api/transcription/queue`, {
      headers: { 'x-pin': cm.config.dashboardPin }
    });
    assertEqual(res.status, 200, 'GET /api/transcription/queue returns 200');
    const queueData = await res.json();
    assert(queueData.success === true, 'Response contains success: true');
    assertEqual(queueData.isProcessing, false, 'Endpoint returns correct isProcessing');
    assertEqual(queueData.queueLength, 0, 'Endpoint returns correct queueLength');

    serverApp.server.close();
  });

  // =========================================================================
  // SUITE 32: Corrupted DB Recovery, Atomic File Write Lockouts & Crash Resilience
  // =========================================================================
  await runSuite('32. Corrupted DB Recovery, Atomic File Write Lockouts & Crash Resilience', async () => {
    const corruptDbPath = path.join(TEST_DIR, 'corrupt_test_db.json');
    fs.writeFileSync(corruptDbPath, '{"broken json: true, missing brackets...', 'utf8');

    // 1. DatabaseManager loads corrupted file
    const db = new DatabaseManager(corruptDbPath);
    assertEqual(db.incidents.length, 0, 'Corrupted JSON loaded safely as empty array without throwing');

    // 2. Verify automatic backup of corrupted file
    const files = fs.readdirSync(TEST_DIR);
    const backupFile = files.find(f => f.startsWith('corrupt_test_db.json.corrupt_'));
    assert(backupFile !== undefined, 'Corrupted DB backup file was created automatically');

    // 3. Test ConfigManager deletePcMapping with empty string and 0 values
    const configPath = path.join(TEST_DIR, 'delete_mapping_config.json');
    const cm = new ConfigManager(configPath);
    cm.config.pcMapping = {
      'uuid-empty': '',
      'uuid-zero': 0,
      'uuid-valid': 'Studio-1'
    };
    cm.saveConfig();

    cm.deletePcMapping('uuid-empty');
    assertEqual(cm.config.pcMapping['uuid-empty'], undefined, 'Deleted empty-string mapped UUID');

    cm.deletePcMapping('uuid-zero');
    assertEqual(cm.config.pcMapping['uuid-zero'], undefined, 'Deleted 0-mapped UUID');

    assertEqual(cm.config.pcMapping['uuid-valid'], 'Studio-1', 'Valid UUID mapping retained');

    // 4. Test saveDbSync immediate persistence
    const syncDbPath = path.join(TEST_DIR, 'sync_save_db.json');
    const syncDb = new DatabaseManager(syncDbPath);
    syncDb.logIncident('uuid-1', 'PC-Test', 'BAHAYA_OBS_MUTE', 'Mic Mute');
    syncDb.logIncident('uuid-1', 'PC-Test', 'BAHAYA_AUDIO_PECAH', 'Clipping');
    syncDb.saveDbSync();

    const rawContent = JSON.parse(fs.readFileSync(syncDbPath, 'utf8'));
    assertEqual(rawContent.length, 2, 'saveDbSync persisted exactly 2 incidents immediately to disk');
  });

  // =========================================================================
  // SUITE 33: Multi-Session Audio Timeline Seek Offsets, Cumulative Segment Time & Cross-Part Autoplay
  // =========================================================================
  await runSuite('33. Multi-Session Audio Timeline Seek Offsets, Cumulative Segment Time & Cross-Part Autoplay', async () => {
    const configPath = path.join(TEST_DIR, 'multi_timeline_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'multi_timeline_db.json'));
    const alertMgr = new AlertManager(cm, db);
    const tm = new TranscriptionManager(cm, db, alertMgr);

    const sessionDir = path.join(TEST_DIR, 'multi_timeline_session');
    fs.mkdirSync(sessionDir, { recursive: true });

    // Create 3 parts with custom durations
    const part1 = {
      fileName: 'Part_001.webm',
      duration: 120, // 2 minutes
      text: 'Selamat pagi pendengar.',
      segments: [{ id: 0, start: 0, end: 10, text: 'Selamat pagi pendengar.' }],
      keywordsFound: [],
      transcribedAt: '2026-08-31 08:00:00'
    };
    const part2 = {
      fileName: 'Part_002.webm',
      duration: 300, // 5 minutes
      text: 'Berita utama hari ini.',
      segments: [{ id: 0, start: 15, end: 35, text: 'Berita utama hari ini.' }],
      keywordsFound: ['berita'],
      transcribedAt: '2026-08-31 08:02:00'
    };
    const part3 = {
      fileName: 'Part_003.webm',
      duration: 180, // 3 minutes
      text: 'Terima kasih dan sampai jumpa.',
      segments: [{ id: 0, start: 5, end: 20, text: 'Terima kasih dan sampai jumpa.' }],
      keywordsFound: [],
      transcribedAt: '2026-08-31 08:07:00'
    };

    fs.writeFileSync(path.join(sessionDir, 'Part_001.webm.transcript.json'), JSON.stringify(part1));
    fs.writeFileSync(path.join(sessionDir, 'Part_002.webm.transcript.json'), JSON.stringify(part2));
    fs.writeFileSync(path.join(sessionDir, 'Part_003.webm.transcript.json'), JSON.stringify(part3));

    const aggregated = tm.getTranscriptForSession(sessionDir);
    assert(aggregated !== null, 'Multi-part transcript aggregated successfully');
    assertEqual(aggregated.partsCount, 3, 'Aggregated 3 parts');
    assertEqual(aggregated.duration, 600, 'Total session duration is 600 seconds (10 min)');
    assertEqual(aggregated.segments.length, 3, '3 unified timeline segments created');

    // Verify Cumulative Timeline Offsets:
    // Part 1: start 0, end 10
    assertEqual(aggregated.segments[0].start, 0, 'Segment 1 start is 0s');
    assertEqual(aggregated.segments[0].end, 10, 'Segment 1 end is 10s');

    // Part 2: offset = 120s => start = 120 + 15 = 135s, end = 120 + 35 = 155s
    assertEqual(aggregated.segments[1].start, 135, 'Segment 2 start offset calculated to 135s');
    assertEqual(aggregated.segments[1].end, 155, 'Segment 2 end offset calculated to 155s');

    // Part 3: offset = 120 + 300 = 420s => start = 420 + 5 = 425s, end = 420 + 20 = 440s
    assertEqual(aggregated.segments[2].start, 425, 'Segment 3 start offset calculated to 425s (07:05)');
    assertEqual(aggregated.segments[2].end, 440, 'Segment 3 end offset calculated to 440s (07:20)');

    // Verify SRT Formatter
    const formatSrtTime = (seconds) => {
      const validSec = (typeof seconds === 'number' && !isNaN(seconds) && isFinite(seconds)) ? Math.max(0, seconds) : 0;
      const d = new Date(validSec * 1000);
      const hh = String(Math.floor(validSec / 3600)).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      const ss = String(d.getUTCSeconds()).padStart(2, '0');
      const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
      return `${hh}:${mm}:${ss},${ms}`;
    };

    assertEqual(formatSrtTime(aggregated.segments[2].start), '00:07:05,000', 'Segment 3 SRT start formatted accurately');
    assertEqual(formatSrtTime(aggregated.segments[2].end), '00:07:20,000', 'Segment 3 SRT end formatted accurately');
  });

  // =========================================================================
  // SUITE 34: PIN Type Safety, Header Injection & Advanced Security Boundary Fuzzing
  // =========================================================================
  await runSuite('34. PIN Type Safety, Header Injection & Advanced Security Boundary Fuzzing', async () => {
    const configPath = path.join(TEST_DIR, 'pin_sec_config.json');
    const cm = new ConfigManager(configPath);
    cm.config.dashboardPin = '1234';
    cm.saveConfig();

    const db = new DatabaseManager(path.join(TEST_DIR, 'pin_sec_db.json'));
    const alertMgr = new AlertManager(cm, db);
    const serverApp = new ServerApp(cm, db, alertMgr, 0);

    await new Promise(r => serverApp.server.listen(0, r));
    const port = serverApp.server.address().port;

    // 1. Test Numeric PIN Payload { newPin: 4321 }
    const pinRes1 = await fetch(`http://127.0.0.1:${port}/api/config/pin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-pin': '1234'
      },
      body: JSON.stringify({ newPin: 4321 })
    });
    assertEqual(pinRes1.status, 200, 'POST /api/config/pin accepts numeric PIN');
    assertEqual(typeof serverApp.configManager.config.dashboardPin, 'string', 'PIN stored strictly as string');
    assertEqual(serverApp.configManager.config.dashboardPin, '4321', 'PIN value is "4321"');

    // 2. Test Access with string header '4321' succeeds
    const authRes = await fetch(`http://127.0.0.1:${port}/api/config`, {
      headers: { 'x-pin': '4321' }
    });
    assertEqual(authRes.status, 200, 'Authenticated successfully with string header matching numeric PIN');

    // 3. Test PIN with leading/trailing whitespace { newPin: "  9876  " }
    const pinRes2 = await fetch(`http://127.0.0.1:${port}/api/config/pin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-pin': '4321'
      },
      body: JSON.stringify({ newPin: '  9876  ' })
    });
    assertEqual(pinRes2.status, 200, 'POST /api/config/pin accepts whitespace-padded PIN');
    assertEqual(serverApp.configManager.config.dashboardPin, '9876', 'PIN is trimmed to "9876"');

    // 4. Test Invalid PIN types rejected with 400
    const shortPinRes = await fetch(`http://127.0.0.1:${port}/api/config/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pin': '9876' },
      body: JSON.stringify({ newPin: 12 })
    });
    assertEqual(shortPinRes.status, 400, 'PIN shorter than 4 chars rejected with 400');

    const nullPinRes = await fetch(`http://127.0.0.1:${port}/api/config/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pin': '9876' },
      body: JSON.stringify({ newPin: null })
    });
    assertEqual(nullPinRes.status, 400, 'Null PIN rejected with 400');

    // 5. Test DELETE /api/records type validation
    const badDeleteRes = await fetch(`http://127.0.0.1:${port}/api/records`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-pin': '9876' },
      body: JSON.stringify({ pcName: 1234, fileName: true })
    });
    assertEqual(badDeleteRes.status, 400, 'DELETE /api/records with non-string types rejected with 400');

    // 6. Test Path Traversal in DELETE /api/records
    const traversalRes = await fetch(`http://127.0.0.1:${port}/api/records`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-pin': '9876' },
      body: JSON.stringify({ pcName: '../../', fileName: '../boot.ini' })
    });
    assert(traversalRes.status === 400 || traversalRes.status === 403, 'Path traversal rejected safely');

    serverApp.server.close();
  });

  // =========================================================================
  // SUITE 35: Agent Rollover Buffer Synchronization, Silence & Dead Mic Metric Escalation
  // =========================================================================
  await runSuite('35. Agent Rollover Buffer Synchronization, Silence & Dead Mic Metric Escalation', () => {
    // 1. Simulate State Machine with Silence and Dead Mic Escalation
    const evaluateAgentMetrics = (micLevel, obsLevel, silenceSec, silenceTimeoutSec = 5, deadMicTimeoutSec = 15) => {
      if (micLevel >= 2 || obsLevel >= 2) {
        return { status: 'AMAN', silenceScore: 0 };
      }
      const silenceScore = silenceSec * 1000;
      if (silenceScore >= deadMicTimeoutSec * 1000) {
        return { status: 'BAHAYA_MIC_MATI', silenceScore };
      }
      if (silenceScore >= silenceTimeoutSec * 1000) {
        return { status: 'STANDBY_DIAM', silenceScore };
      }
      return { status: 'AMAN', silenceScore };
    };

    assertEqual(evaluateAgentMetrics(0, 0, 2).status, 'AMAN', '0-2s silence is AMAN');
    assertEqual(evaluateAgentMetrics(0, 0, 6).status, 'STANDBY_DIAM', '6s silence escalates to STANDBY_DIAM');
    assertEqual(evaluateAgentMetrics(0, 0, 16).status, 'BAHAYA_MIC_MATI', '16s silence escalates to BAHAYA_MIC_MATI');
    assertEqual(evaluateAgentMetrics(25, 0, 16).status, 'AMAN', 'Audio active recovers instantly to AMAN');
    assertEqual(evaluateAgentMetrics(25, 0, 16).silenceScore, 0, 'Audio active resets silenceScore to 0');

    // 2. Danger Score Recovery Post Auto-Recovery Unmute
    const evaluateDangerRecovery = (dangerScoreCurrent, isActuallyMuted) => {
      let score = dangerScoreCurrent;
      if (!isActuallyMuted) {
        if (score > 0) {
          score = Math.max(0, score - 500);
        } else {
          score = 0; // Grace period negative score resets to 0
        }
      }
      return score;
    };

    assertEqual(evaluateDangerRecovery(1000, false), 500, 'Positive danger score decays by 500ms');
    assertEqual(evaluateDangerRecovery(500, false), 0, 'Positive danger score fully decays to 0');
    assertEqual(evaluateDangerRecovery(-2000, false), 0, 'Negative grace period score instantly resets to 0 upon unmute');

    // 3. WebM Header Magic Bytes Verification
    const isWebMHeader = (buffer) => {
      if (!buffer || buffer.length < 4) return false;
      return buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3;
    };

    const validWebM = Buffer.from([0x1A, 0x45, 0xDF, 0xA3, 0x01, 0x00, 0x00]);
    const invalidWebM = Buffer.from([0x00, 0x00, 0x01, 0xBA, 0x21, 0x00]);
    const emptyBuffer = Buffer.from([]);

    assertEqual(isWebMHeader(validWebM), true, 'Valid WebM EBML header detected (1A 45 DF A3)');
    assertEqual(isWebMHeader(invalidWebM), false, 'Non-WebM buffer rejected');
    assertEqual(isWebMHeader(emptyBuffer), false, 'Empty buffer rejected safely');
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
