const { OBSWebSocket } = require('obs-websocket-js');

async function test() {
  const obs = new OBSWebSocket();
  try {
    await obs.connect('ws://localhost:4455', 'password123'); // assuming default or no password, let's just try to connect
    const { inputs } = await obs.call('GetInputList');
    console.log("Inputs:", inputs);
    
    for (const input of inputs) {
      if (input.inputKind.includes('audio') || input.inputKind.includes('wasapi')) {
        const settings = await obs.call('GetInputSettings', { inputName: input.inputName });
        console.log(`\nSettings for ${input.inputName} (${input.inputKind}):`);
        console.log(settings.inputSettings);
      }
    }
    
    // Also try SpecialInputs
    const special = await obs.call('GetSpecialInputs');
    console.log("\nSpecial Inputs:", special);
    
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await obs.disconnect();
  }
}

test();
