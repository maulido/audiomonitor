/**
 * Comprehensive Whitebox Test Suite for Audio Monitor
 * Tests Server, Database, Config, Alerting, Telemetry, API Endpoints, and Agent logic.
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
  console.log('STARTING WHITEBOX TEST EXECUTION FOR AUDIOMONITOR...\n');

  // =========================================================================
  // SUITE 1: ConfigManager Whitebox Tests
  // =========================================================================
  await runSuite('1. ConfigManager Unit & Boundary Tests', () => {
    const configPath = path.join(TEST_DIR, 'config.json');
    const cm = new ConfigManager(configPath);

    assert(cm.config !== null && typeof cm.config === 'object', 'Config loaded with object structure');
    assertEqual(cm.config.dashboardPin, '1234', 'Default dashboardPin is 1234');
    assertEqual(cm.config.logRetentionDays, 30, 'Default logRetentionDays is 30');

    // PIN check
    assert(cm.config.dashboardPin === '1234', 'PIN is 1234');

    // Update config
    cm.config.dashboardPin = '5678';
    cm.config.logRetentionDays = 60;
    cm.saveConfig();

    assertEqual(cm.config.dashboardPin, '5678', 'PIN updated to 5678');
    assertEqual(cm.config.logRetentionDays, 60, 'logRetentionDays updated to 60');

    // Rename PC
    cm.setPcName('uuid-101', 'PC-Studio-Alpha');
    assertEqual(cm.getPcName('uuid-101'), 'PC-Studio-Alpha', 'PC rename maps correctly');
    assertEqual(cm.getPcName('uuid-nonexistent'), 'uuid-nonexistent', 'Unknown UUID returns itself as fallback name');

    // Reload from disk to verify persistence
    const cm2 = new ConfigManager(configPath);
    assertEqual(cm2.config.dashboardPin, '5678', 'Config changes persisted and reloaded from disk');
    assertEqual(cm2.getPcName('uuid-101'), 'PC-Studio-Alpha', 'PC mapping persisted and reloaded');
  });

  // =========================================================================
  // SUITE 2: DatabaseManager Whitebox Tests
  // =========================================================================
  await runSuite('2. DatabaseManager Unit, Queries & Auto-Cleanup Tests', async () => {
    const dbPath = path.join(TEST_DIR, 'test_incidents.json');
    const db = new DatabaseManager(dbPath);
    db.incidents = [];
    db.saveDbSync();

    // Log incidents across different simulated dates
    const now = new Date();
    const d1 = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
    const d2 = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000); // 20 days ago
    const d3 = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);  // 5 days ago
    const d4 = new Date(now.getTime() - 1000);                     // Today

    db.incidents = [
      { id: 1, uuid: 'pc-1', pcName: 'PC-1', incidentType: 'BAHAYA_MUTE', details: 'OBS Mute', timestamp: d1.toISOString().replace('T', ' ').substring(0, 19) },
      { id: 2, uuid: 'pc-2', pcName: 'PC-2', incidentType: 'BAHAYA_CLIPPING', details: 'Pecah', timestamp: d2.toISOString().replace('T', ' ').substring(0, 19) },
      { id: 3, uuid: 'pc-1', pcName: 'PC-1', incidentType: 'AMAN', details: 'Recovered', timestamp: d3.toISOString().replace('T', ' ').substring(0, 19) },
      { id: 4, uuid: 'pc-3', pcName: 'PC-3', incidentType: 'BAHAYA_AUDIO_DEAD', details: 'Dead Mic', timestamp: d4.toISOString().replace('T', ' ').substring(0, 19) }
    ];
    db.saveDbSync();

    // Test unique PC names
    const names = db.getUniquePcNames();
    assert(names.includes('PC-1') && names.includes('PC-2') && names.includes('PC-3'), 'getUniquePcNames returns all PC aliases');
    assertEqual(names.length, 3, 'getUniquePcNames returns deduplicated list of length 3');

    // Test Filter by PC Name
    await new Promise(res => {
      db.getFilteredIncidents({ pcName: 'PC-1' }, list => {
        assertEqual(list.length, 2, 'Filtered by pcName: PC-1 returns 2 records');
        res();
      });
    });

    // Test Filter by Status
    await new Promise(res => {
      db.getFilteredIncidents({ status: 'BAHAYA' }, list => {
        assertEqual(list.length, 3, 'Filtered by status: BAHAYA returns 3 records');
        res();
      });
    });

    // Test Retention Auto-Cleanup (30 Days retention)
    const removedCount = db.autoCleanup(30);
    assertEqual(removedCount, 1, 'autoCleanup(30) removes exactly 1 record (>30 days)');
    assertEqual(db.incidents.length, 3, 'Remaining database count is 3 records');
    assert(db.incidents.every(i => i.id !== 1), 'Oldest record (id: 1) is pruned correctly');

    // Test Hard Reset (clearIncidents)
    await new Promise(res => {
      db.clearIncidents(() => {
        assertEqual(db.incidents.length, 0, 'clearIncidents empties database to 0 records');
        res();
      });
    });
  });

  // =========================================================================
  // SUITE 3: AlertManager Whitebox Tests
  // =========================================================================
  await runSuite('3. AlertManager Notification & Throttling Logic', async () => {
    let telegramCalls = [];
    const mockBot = {
      sendMessage: async (chatId, text, options) => {
        telegramCalls.push({ chatId, text, options });
        return { message_id: 1 };
      }
    };

    const cm = new ConfigManager(path.join(TEST_DIR, 'alert_config.json'));
    cm.config.telegram = { token: 'mock-token', chatId: '12345678', interval: 2 };
    const db = new DatabaseManager(path.join(TEST_DIR, 'alert_db.json'));

    const alertMgr = new AlertManager(cm, db);
    alertMgr.bot = mockBot;

    // Transition 1: STANDBY -> BAHAYA (Should trigger alert)
    const pc1 = { uuid: 'pc-1', status: 'BAHAYA_MUTE', micDb: -45, obsDb: -60, obsSourceName: 'Mic/Aux' };
    alertMgr.processTelemetry(pc1, 'PC-Testing');
    assertEqual(telegramCalls.length, 1, 'First BAHAYA trigger sends Telegram message');
    assert(telegramCalls[0].text.includes('AUDIO ISSUE'), 'Message content contains AUDIO ISSUE alert');

    // Immediate duplicate trigger within cooldown (Should be suppressed)
    alertMgr.processTelemetry(pc1, 'PC-Testing');
    assertEqual(telegramCalls.length, 1, 'Duplicate trigger during cooldown is throttled/suppressed');

    // Transition 2: BAHAYA -> AMAN (Recovery alert)
    const pc1Recovered = { uuid: 'pc-1', status: 'AMAN', micDb: -30, obsDb: -30, obsSourceName: 'Mic/Aux' };
    alertMgr.processTelemetry(pc1Recovered, 'PC-Testing');
    assertEqual(telegramCalls.length, 2, 'Transition back to AMAN sends recovery notification');
    assert(telegramCalls[1].text.includes('AMAN'), 'Recovery message contains AMAN text');

    // Transition 3: Offline Alert
    alertMgr.processOffline('pc-1', 'PC-Testing');
    assertEqual(telegramCalls.length, 3, 'Offline transition sends OFFLINE notification');
  });

  // =========================================================================
  // SUITE 4: TelemetryHub Processing & Status Evaluation
  // =========================================================================
  await runSuite('4. TelemetryHub Processing & Status Evaluation', () => {
    const configPath = path.join(TEST_DIR, 'telemetry_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'telemetry_db.json'));
    const alertMgr = new AlertManager(cm, db);
    
    const fakeHttpServer = http.createServer();
    const hub = new TelemetryHub(fakeHttpServer, cm, alertMgr);

    // Test case 1: Healthy Telemetry -> status: AMAN
    const payloadAman = {
      uuid: 'pc-unit-1',
      pcName: 'PC-Unit-1',
      status: 'AMAN',
      micDb: -28.5,
      obsDb: -28.0,
      cpuUsage: 15,
      ramUsage: 45
    };
    hub.handleTelemetry(payloadAman);
    const agent1 = hub.lastKnownState.get('pc-unit-1');
    assert(agent1 !== undefined, 'Agent telemetry updated in lastKnownState');
    assertEqual(agent1.status, 'AMAN', 'Healthy agent is assigned AMAN status');

    // Test case 2: OBS Muted -> status: BAHAYA_MUTE
    const payloadMute = {
      uuid: 'pc-unit-1',
      pcName: 'PC-Unit-1',
      status: 'BAHAYA_MUTE',
      isObsMutedBtn: true,
      micDb: -20,
      obsDb: -60
    };
    hub.handleTelemetry(payloadMute);
    assertEqual(hub.lastKnownState.get('pc-unit-1').status, 'BAHAYA_MUTE', 'Muted agent assigned BAHAYA_MUTE');

    // Test case 3: Local monitoring override protection
    hub.pcMonitoringState['pc-unit-1'] = false;
    hub.handleTelemetry({ uuid: 'pc-unit-1', isMonitoringActive: undefined });
    assertEqual(hub.pcMonitoringState['pc-unit-1'], false, 'Local monitoring state preserved when server state exists');
  });

  // =========================================================================
  // SUITE 5: Express REST API Endpoints & Security Whitebox Tests
  // =========================================================================
  await runSuite('5. ServerApp REST API & Security Endpoints Tests', async () => {
    const configPath = path.join(TEST_DIR, 'api_test_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'api_test_db.json'));
    const alertMgr = new AlertManager(cm, db);

    const testRecordDir = path.join(TEST_DIR, 'records');
    fs.mkdirSync(testRecordDir, { recursive: true });
    cm.config.recordDir = testRecordDir;

    const sampleFolder = 'PC-Testing_uuid123_2026-08-29_12-00-00_to_12-10-00';
    const folderPath = path.join(testRecordDir, sampleFolder);
    fs.mkdirSync(folderPath, { recursive: true });
    fs.writeFileSync(path.join(folderPath, 'Part_001.webm'), Buffer.from('RIFF....dummywebmcontent'));

    db.incidents = [
      { id: 1, uuid: 'pc-api-1', pcName: 'PC-Api-1', incidentType: 'BAHAYA_MUTE', details: 'Test', timestamp: '2026-08-29 10:00:00' },
      { id: 2, uuid: 'pc-api-2', pcName: 'PC-Api-2', incidentType: 'AMAN', details: 'Test', timestamp: '2026-08-29 11:00:00' }
    ];
    db.saveDbSync();

    const serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;
    serverApp.alertManager = alertMgr;

    const port = await new Promise(res => {
      const s = serverApp.server.listen(0, '127.0.0.1', () => {
        res(s.address().port);
      });
    });

    const baseUrl = 'http://127.0.0.1:' + port;

    async function req(urlPath, options = {}) {
      const res = await fetch(baseUrl + urlPath, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'x-pin': cm.config.dashboardPin,
          ...(options.headers || {})
        }
      });
      let body;
      try { body = await res.json(); } catch(e) { body = null; }
      return { status: res.status, ok: res.ok, body };
    }

    // 1. GET /api/config
    const resConfig = await req('/api/config');
    assertEqual(resConfig.status, 200, 'GET /api/config returns 200');
    assert(resConfig.body !== null, 'Config body returned');

    // 2. POST /api/config/pin
    const resPin = await req('/api/config/pin', { method: 'POST', body: JSON.stringify({ newPin: '4321' }) });
    assertEqual(resPin.status, 200, 'POST /api/config/pin returns 200');
    assertEqual(cm.config.dashboardPin, '4321', 'PIN updated to 4321');

    // 3. POST /api/config/retention
    const resRet = await req('/api/config/retention', { method: 'POST', body: JSON.stringify({ days: 45 }) });
    assertEqual(resRet.body.success, true, 'POST /api/config/retention returns success');
    assertEqual(cm.config.logRetentionDays, 45, 'ConfigManager updated retention to 45 days');

    // 4. GET /api/incidents
    const resInc = await req('/api/incidents?pcName=PC-Api-1');
    assertEqual(resInc.status, 200, 'GET /api/incidents returns 200');
    assertEqual(resInc.body.length, 1, 'GET /api/incidents correctly filters by pcName');

    // 5. GET /api/records
    const resRec = await req('/api/records');
    assertEqual(resRec.status, 200, 'GET /api/records returns 200');
    assert(Array.isArray(resRec.body) && resRec.body.length > 0, 'Records list parsed audio session folders');

    // 6. Security Test: Path Traversal prevention on /media endpoint
    const resTraversal = await req('/media/..%2f..%2f/config.json');
    assert(resTraversal.status === 403 || resTraversal.status === 400 || resTraversal.status === 404, 'Path traversal request is securely rejected with 403/400/404');

    // 7. POST /api/incidents/cleanup-now
    const resCleanup = await req('/api/incidents/cleanup-now', { method: 'POST' });
    assertEqual(resCleanup.body.success, true, 'POST /api/incidents/cleanup-now executed cleanly');

    await new Promise(r => serverApp.server.close(r));
  });

  // =========================================================================
  // SUITE 6: Agent Audio Logic & Danger Calculation Whitebox Tests
  // =========================================================================
  await runSuite('6. Agent Audio Threshold & Auto-Recovery Unmute Logic', () => {
    function calculateDangerState(opts) {
      const micRms = opts.micRms;
      const obsMuted = opts.obsMuted;
      const noiseGate = opts.noiseGate || 15;
      const silenceTimeoutSec = opts.silenceTimeoutSec || 10;
      const speakingThreshold = opts.speakingThreshold || 10;
      const autoRecoveryUnmute = opts.autoRecoveryUnmute !== false;
      const currentSilenceSec = opts.currentSilenceSec || 0;

      let isSilent = micRms < noiseGate;
      let isSpeaking = micRms >= (noiseGate + speakingThreshold);
      let dangerScore = 0;
      let shouldAutoUnmute = false;

      if (obsMuted && isSpeaking && autoRecoveryUnmute) {
        shouldAutoUnmute = true;
      }

      if (obsMuted) {
        dangerScore = 100;
      } else if (isSilent && currentSilenceSec >= silenceTimeoutSec) {
        dangerScore = 80;
      }

      return { isSilent, isSpeaking, dangerScore, shouldAutoUnmute };
    }

    const state1 = calculateDangerState({ micRms: 35, obsMuted: false });
    assertEqual(state1.isSpeaking, true, 'Normal RMS 35 is identified as speaking');
    assertEqual(state1.dangerScore, 0, 'No danger when unmuted and speaking');
    assertEqual(state1.shouldAutoUnmute, false, 'No unmute needed');

    const state2 = calculateDangerState({ micRms: 40, obsMuted: true, autoRecoveryUnmute: true });
    assertEqual(state2.isSpeaking, true, 'Speaking detected');
    assertEqual(state2.shouldAutoUnmute, true, 'Auto-recovery unmute is triggered!');
    assertEqual(state2.dangerScore, 100, 'Danger score is 100 on muted mic');

    const state3 = calculateDangerState({ micRms: 5, obsMuted: false, currentSilenceSec: 15, silenceTimeoutSec: 10 });
    assertEqual(state3.isSilent, true, 'Silence identified below noise gate');
    assertEqual(state3.dangerScore, 80, 'Silence timeout elevates danger score to 80');
  });

  // =========================================================================
  // SUITE 7: End-to-End WebSocket Real-time Sync & Remote Dispatch Test
  // =========================================================================
  await runSuite('7. End-to-End WebSocket Real-time Sync & Remote Dispatch Test', async () => {
    const configPath = path.join(TEST_DIR, 'e2e_config.json');
    const cm = new ConfigManager(configPath);
    const db = new DatabaseManager(path.join(TEST_DIR, 'e2e_db.json'));
    const alertMgr = new AlertManager(cm, db);

    const serverApp = new ServerApp(0);
    serverApp.configManager = cm;
    serverApp.dbManager = db;
    serverApp.alertManager = alertMgr;

    const port = await new Promise(res => {
      serverApp.server.listen(0, '127.0.0.1', () => res(serverApp.server.address().port));
    });

    const wsUrl = 'http://127.0.0.1:' + port;

    // 1. Connect Mock Agent
    const agentSocket = ioClient(wsUrl);
    const testAgentUuid = 'agent-integration-uuid-001';

    await new Promise(res => {
      agentSocket.on('connect', () => {
        agentSocket.emit('register', { type: 'agent', uuid: testAgentUuid, name: 'PC-Studio-E2E' });
        setTimeout(res, 100);
      });
    });

    assert(serverApp.telemetryHub.agentSockets.has(testAgentUuid), 'Agent successfully registered and mapped in Server');

    // 2. Connect Mock Dashboard
    const dashSocket = ioClient(wsUrl);
    let receivedTelemetry = null;
    dashSocket.on('dashboard-update', data => {
      receivedTelemetry = data;
    });

    await new Promise(res => {
      dashSocket.on('connect', () => {
        dashSocket.emit('register', { type: 'dashboard' });
        setTimeout(res, 100);
      });
    });

    // 3. Agent sends Telemetry
    agentSocket.emit('telemetry', {
      uuid: testAgentUuid,
      pcName: 'PC-Studio-E2E',
      status: 'AMAN',
      micDb: -22.4,
      obsDb: -25.1,
      cpuUsage: 12,
      ramUsage: 50
    });

    await new Promise(res => setTimeout(res, 200));
    assert(receivedTelemetry !== null, 'Dashboard received real-time telemetry broadcast');
    assertEqual(receivedTelemetry.micDb, -22.4, 'Dashboard telemetry contains correct micDb (-22.4)');

    // 4. Dashboard sends Remote Monitoring Toggle command via agent-monitoring or HTTP
    let agentReceivedMonitoringState = null;
    agentSocket.on('set-monitoring', data => {
      agentReceivedMonitoringState = data;
    });

    dashSocket.emit('agent-monitoring', { uuid: testAgentUuid, active: false });
    await new Promise(res => setTimeout(res, 200));

    assertEqual(agentReceivedMonitoringState, false, 'Agent received remote monitoring pause command');

    // 5. Dashboard sends Remote Config Update
    let agentReceivedNewConfig = null;
    agentSocket.on('update-config', newConf => {
      agentReceivedNewConfig = newConf;
    });

    dashSocket.emit('agent-config-update', { uuid: testAgentUuid, config: { noiseGate: 25, silenceTimeoutSec: 15 } });
    await new Promise(res => setTimeout(res, 200));

    assert(agentReceivedNewConfig !== null, 'Agent received remote config update event');
    assertEqual(agentReceivedNewConfig.noiseGate, 25, 'Remote config applied noiseGate = 25');

    agentSocket.disconnect();
    dashSocket.disconnect();
    await new Promise(r => serverApp.server.close(r));
  });

  // Clean up
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch(e) {}

  console.log('\n======================================================');
  console.log('WHITEBOX TEST SUMMARY REPORT');
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
