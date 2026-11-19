# feedBack-plugin-gt1b

A plugin for **fee[dB]ack** that automatically switches User Patches (`U01`–`U99`) on a **Boss GT-1B** bass multi-effects processor over USB whenever a song loads or starts playing.

## Features
- **Automatic Patch Switching:** Listens to fee[dB]ack's `song:loaded` and `playback:ready` events and sends Roland SysEx commands over USB MIDI to switch your GT-1B patch automatically.
- **Full Library Search & Assignment:** Browse or search your entire fee[dB]ack song library and map any track to a GT-1B User Patch (`1`–`99`) with custom tone labels.
- **Setlist Integration:** View your fee[dB]ack playlists alongside their assigned GT-1B patches and test tones with one click.
- **Auto-Connect:** Automatically reconnects to your Boss GT-1B on startup once USB MIDI access is granted.

## Prerequisites
1. **Official BOSS GT-1B USB Driver:** The GT-1B is not USB class-compliant. Install the official [BOSS GT-1B USB Driver](https://boss.info) for Windows or macOS before connecting.
2. **USB Connection:** Connect your Boss GT-1B directly to your computer via USB.

## Installation
1. Clone or download this repository into your fee[dB]ack `plugins/` directory (or your `FEEDBACK_PLUGINS_DIR` folder) as `gt1b-setlist`:
   ```bash
   git clone: https://github.com/Ender3D/feedBack-plugin-gt1b.git
   ```
2. Restart **fee[dB]ack**.
3. Open the **GT-1B** tab in the navigation menu and click **Connect Boss GT-1B** (grant MIDI/SysEx permission if prompted).
4. Select a song, assign a patch number (`1`–`99`), click **Save**, and launch the song to see your GT-1B switch automatically.
