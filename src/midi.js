import { state } from './state.js';

function calcRolandChecksum(bytes) {
  const sum = bytes.reduce((acc, val) => acc + val, 0);
  const remainder = sum % 128;
  return remainder === 0 ? 0 : 128 - remainder;
}

export async function connectGT1B() {
  if (!navigator.requestMIDIAccess) {
    throw new Error('Web MIDI is not supported in this browser.');
  }
  const midi = await navigator.requestMIDIAccess({ sysex: true });
  for (const output of midi.outputs.values()) {
    if (output.name.toUpperCase().includes('GT-1')) {
      state.midiOutput = output;
      return output.name;
    }
  }
  throw new Error('Boss GT-1B not found. Check USB cable & Boss driver.');
}

export function selectGT1BPatch(patchNumber) {
  if (!state.midiOutput) {
    console.warn('[GT-1B] Pedal not connected; skipping patch switch.');
    return false;
  }

  // 1. Enable GT-1B Editor Mode
  state.midiOutput.send([
    0xF0, 0x41, 0x00, 0x00, 0x00, 0x00, 0x3E, 0x12,
    0x7F, 0x00, 0x00, 0x01, 0x01, 0x7F, 0xF7
  ]);

  // 2. Select User Patch (U01 = index 0, U99 = index 98)
  const patchIndex = Math.max(0, Math.min(98, Number(patchNumber) - 1));
  const payload = [0x00, 0x01, 0x00, 0x00, 0x00, patchIndex];
  const checksum = calcRolandChecksum(payload);

  state.midiOutput.send([
    0xF0, 0x41, 0x00, 0x00, 0x00, 0x00, 0x3E, 0x12,
    ...payload, checksum, 0xF7
  ]);

  console.log(`[GT-1B] Switched pedal to U${String(patchNumber).padStart(2, '0')}`);
  return true;
}
