(() => {
  const state = {
    midiOutput: null,
    mappings: {},
  };

  let librarySongs = [];
  let playlists = [];
  let selectedPlaylist = null;
  let lastTriggeredSong = null;

  function calcRolandChecksum(bytes) {
    const sum = bytes.reduce((acc, val) => acc + val, 0);
    const remainder = sum % 128;
    return remainder === 0 ? 0 : 128 - remainder;
  }

  async function connectGT1B() {
    if (!navigator.requestMIDIAccess) {
      throw new Error('Web MIDI is not supported in this runtime.');
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

  function selectGT1BPatch(patchNumber) {
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
//part 2
  async function loadMappings() {
    try {
      const res = await fetch('/api/plugins/gt1b-setlist/mappings');
      const list = await res.json();
      state.mappings = {};
      for (const item of list) {
        state.mappings[item.song_filename] = item;
      }
    } catch (err) {
      console.error('[GT-1B] Failed to load mappings:', err);
    }
  }

  async function searchLibrary(query = '') {
    try {
      let page = 0;
      let all = [];
      while (true) {
        const url = `/api/library?q=${encodeURIComponent(query)}&page=${page}&size=100&sort=artist`;
        const res = await fetch(url);
        const data = await res.json();
        const batch = data.songs || [];
        all = all.concat(batch);
        if (all.length >= (data.total || 0) || batch.length < 100) break;
        page += 1;
      }
      librarySongs = all;
    } catch (err) {
      console.error('[GT-1B] Library fetch error:', err);
    }
  }

  async function loadPlaylists() {
    try {
      const res = await fetch('/api/playlists');
      playlists = await res.json();
    } catch (err) {
      console.error('[GT-1B] Playlists fetch error:', err);
    }
  }

  async function selectPlaylistById(pid) {
    if (!pid) {
      selectedPlaylist = null;
      renderSetlistUI();
      return;
    }
    try {
      const res = await fetch(`/api/playlists/${pid}`);
      selectedPlaylist = await res.json();
      renderSetlistUI();
    } catch (err) {
      console.error('[GT-1B] Playlist detail error:', err);
    }
  }

  function triggerPatchForSong(filename) {
    if (!filename) return;
    const decoded = decodeURIComponent(filename);
    const mapping = state.mappings[decoded] || state.mappings[filename];
    const token = `${decoded}:${Date.now() >> 11}`;
    if (mapping && lastTriggeredSong !== token) {
      lastTriggeredSong = token;
      const padNum = String(mapping.patch_number).padStart(2, '0');
      console.log(`[GT-1B] Song (${decoded}) -> U${padNum}`);
      selectGT1BPatch(mapping.patch_number);
    }
  }

  function extractSongFilename(payload) {
    if (!payload) return '';
    if (typeof payload === 'string') return payload;
    return payload.filename || payload.song?.filename || payload.detail?.filename || '';
  }

  function installAutoPatchHooks() {
    // 1. Official fee[dB]ack event bus (same events rig_builder uses!)
    if (window.feedBack?.on && !window._gt1bEventsHooked) {
      const handleEvent = (payload) => {
        const fn = extractSongFilename(payload);
        if (fn) triggerPatchForSong(fn);
      };
      window.feedBack.on('song:loaded', handleEvent);
      window.feedBack.on('playback:ready', handleEvent);
      window._gt1bEventsHooked = true;
    }

    // 2. Fallback: wrap window.playSong if defined later
    if (typeof window.playSong === 'function' && !window.playSong._gt1bWrapped) {
      const origPlaySong = window.playSong;
      window.playSong = function (...args) {
        const fn = extractSongFilename(args[0]);
        if (fn) triggerPatchForSong(fn);
        return origPlaySong.apply(this, args);
      };
      window.playSong._gt1bWrapped = true;
    }
  }



//part 3a
  function escHtml(str) {
    return String(str || '').replace(/"/g, '&quot;');
  }

  function buildPlaylistSection(subBtnStyle) {
    if (!selectedPlaylist || !Array.isArray(selectedPlaylist.songs)) return '';

    const rows = selectedPlaylist.songs.map((s, idx) => {
      const m = state.mappings[s.filename];
      const display = s.artist ? `${s.artist} — ${s.title}` : (s.title || s.filename);
      const padNum = m ? String(m.patch_number).padStart(2, '0') : '';

      const badge = m
        ? `<span style="color:#38bdf8;font-weight:600;">U${padNum} (${m.patch_label || 'Custom'})</span>`
        : `<span style="color:#64748b;">No patch assigned</span>`;

      const actionBtn = m
        ? `<button data-patch="${m.patch_number}" class="gt1b-test-btn" style="${subBtnStyle}">Test U${padNum}</button>`
        : `<button data-assign-fn="${escHtml(s.filename)}" data-assign-title="${escHtml(display)}" class="gt1b-quick-assign" style="${subBtnStyle}">+ Assign</button>`;

      return `
        <li style="padding:10px;border-bottom:1px solid #1e293b;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="color:#64748b;margin-right:8px;">${idx + 1}.</span>
            <strong style="color:#f8fafc;">${display}</strong>
            <div style="margin-left:22px;font-size:13px;">${badge}</div>
          </div>
          ${actionBtn}
        </li>`;
    }).join('');

    return `
      <div style="margin-top:16px;background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:16px;">
        <h3 style="margin:0 0 12px 0;color:#f8fafc;">Setlist: ${selectedPlaylist.name}</h3>
        <ul style="list-style:none;padding:0;margin:0;">
          ${rows || '<li style="color:#64748b;">No songs in this playlist yet.</li>'}
        </ul>
      </div>`;
  }

  function renderSetlistUI() {
    const container = document.getElementById('gt1b-setlist-ui');
    if (!container) return;

    const statusEl = document.getElementById('gt1b-midi-status');
    if (statusEl && state.midiOutput) {
      statusEl.textContent = `MIDI Status: Connected to ${state.midiOutput.name}`;
      statusEl.style.color = '#4caf50';
    }

    const inputStyle = 'background:#161b26;color:#f0f4f8;border:1px solid #334155;border-radius:6px;padding:8px;font-size:14px;';
    const btnStyle = 'background:#2563eb;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-weight:600;cursor:pointer;';
    const subBtnStyle = 'background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:6px 12px;cursor:pointer;';

    const songOptions = librarySongs.map((s) => {
      const label = s.artist ? `${s.artist} — ${s.title || s.filename}` : (s.title || s.filename);
      return `<option value="${escHtml(s.filename)}" data-title="${escHtml(label)}">${label}</option>`;
    }).join('');

    const playlistOptions = playlists.map((p) => {
      const sel = selectedPlaylist?.id === p.id ? 'selected' : '';
      return `<option value="${p.id}" ${sel}>${p.name}</option>`;
    }).join('');

    container.innerHTML = `
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:16px;margin-bottom:20px;">
        <h3 style="margin:0 0 12px 0;color:#f8fafc;">Assign GT-1B Patch to a Song (${librarySongs.length} songs)</h3>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <input id="gt1b-search-input" placeholder="Filter by artist or title..." style="${inputStyle}flex:1;" />
          <button id="gt1b-search-btn" style="${subBtnStyle}">Search</button>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <select id="gt1b-song-select" style="${inputStyle}flex:2;min-width:200px;">
            <option value="">-- Select a song --</option>
            ${songOptions}
          </select>
          <input id="gt1b-patch-input" type="number" min="1" max="99" value="1" style="${inputStyle}width:75px;text-align:center;" />
          <input id="gt1b-label-input" placeholder="Tone label" style="${inputStyle}flex:1;min-width:120px;" />
          <button id="gt1b-save-btn" style="${btnStyle}">Save</button>
        </div>
      </div>

      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:16px;margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <h3 style="margin:0;color:#f8fafc;">Setlist Builder (Playlists)</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <select id="gt1b-playlist-select" style="${inputStyle}min-width:180px;">
              <option value="">-- Choose a Setlist --</option>
              ${playlistOptions}
            </select>
            <button id="gt1b-new-pl-btn" style="${subBtnStyle}">+ New Setlist</button>
            <button id="gt1b-add-to-pl-btn" style="${subBtnStyle}">+ Add Selected Song</button>
          </div>
        </div>
        ${buildPlaylistSection(subBtnStyle)}
      </div>

      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:16px;">
        <h3 style="margin:0 0 12px 0;color:#f8fafc;">Saved Song Patch Mappings</h3>
        <ul id="gt1b-mapping-list" style="list-style:none;padding:0;margin:0;"></ul>
      </div>`;

    const listEl = document.getElementById('gt1b-mapping-list');
    const entries = Object.values(state.mappings);
    if (entries.length === 0) {
      listEl.innerHTML = '<li style="color:#64748b;padding:8px;">No patch mappings saved yet.</li>';
      return;
    }

    entries.forEach((m) => {
      const padNum = String(m.patch_number).padStart(2, '0');
      const li = document.createElement('li');
      li.style.cssText = 'padding:10px;border-bottom:1px solid #1e293b;display:flex;justify-content:space-between;align-items:center;';
      li.innerHTML = `
        <div>
          <strong style="color:#f8fafc;">${m.song_title || m.song_filename}</strong>
          <span style="color:#38bdf8;margin-left:8px;font-weight:600;">→ U${padNum}</span>
          <span style="color:#94a3b8;margin-left:6px;">(${m.patch_label || 'Custom'})</span>
        </div>
        <div style="display:flex;gap:8px;">
          <button data-patch="${m.patch_number}" class="gt1b-test-btn" style="${subBtnStyle}">Test</button>
          <button data-delete-fn="${escHtml(m.song_filename)}" class="gt1b-del-btn" style="background:#7f1d1d;color:#fecaca;border:1px solid #991b1b;border-radius:6px;padding:6px 10px;cursor:pointer;">Del</button>
        </div>`;
      listEl.appendChild(li);
    });
  }
//part 3b
  async function refreshAll() {
    await Promise.all([loadMappings(), searchLibrary(), loadPlaylists()]);
    renderSetlistUI();
  }

  function init() {
    installAutoPatchHooks();
    connectGT1B().then(renderSetlistUI).catch(() => {});
    refreshAll();

    if (window.feedBack?.on) {
      window.feedBack.on('screen:changed', (screen) => {
        if (screen === 'gt1b-setlist') refreshAll();
      });
    }

    document.addEventListener('change', (e) => {
      if (e.target?.id === 'gt1b-playlist-select') {
        selectPlaylistById(e.target.value);
      }
    });

    document.addEventListener('click', async (e) => {
      if (e.target?.id === 'gt1b-connect-btn') {
        const statusEl = document.getElementById('gt1b-midi-status');
        try {
          const name = await connectGT1B();
          statusEl.textContent = `MIDI Status: Connected to ${name}`;
          statusEl.style.color = '#4caf50';
        } catch (err) {
          statusEl.textContent = `MIDI Error: ${err.message}`;
          statusEl.style.color = '#f44336';
        }
      }

      if (e.target?.id === 'gt1b-search-btn') {
        const q = document.getElementById('gt1b-search-input').value.trim();
        await searchLibrary(q);
        renderSetlistUI();
        document.getElementById('gt1b-search-input').value = q;
      }

      if (e.target?.id === 'gt1b-save-btn') {
        const selectEl = document.getElementById('gt1b-song-select');
        const song_filename = selectEl.value;
        const opt = selectEl.options[selectEl.selectedIndex];
        const song_title = opt?.dataset?.title || song_filename;
        const patch_number = Number(document.getElementById('gt1b-patch-input').value);
        const patch_label = document.getElementById('gt1b-label-input').value.trim();
        if (!song_filename) return;

        await fetch('/api/plugins/gt1b-setlist/mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ song_filename, song_title, patch_number, patch_label }),
        });
        await loadMappings();
        renderSetlistUI();
      }

      if (e.target?.id === 'gt1b-new-pl-btn') {
        const name = prompt('Enter new setlist name:');
        if (!name || !name.trim()) return;
        const res = await fetch('/api/playlists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        });
        const created = await res.json();
        await loadPlaylists();
        if (created?.id) await selectPlaylistById(created.id);
      }

      if (e.target?.id === 'gt1b-add-to-pl-btn') {
        const fn = document.getElementById('gt1b-song-select')?.value;
        if (!selectedPlaylist?.id) return alert('Select or create a setlist first!');
        if (!fn) return alert('Select a song from the library dropdown first!');
        await fetch(`/api/playlists/${selectedPlaylist.id}/songs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: fn }),
        });
        await selectPlaylistById(selectedPlaylist.id);
      }

      if (e.target?.classList.contains('gt1b-quick-assign')) {
        const fn = e.target.dataset.assignFn;
        const title = e.target.dataset.assignTitle;
        const selectEl = document.getElementById('gt1b-song-select');
        if (selectEl) {
          if (![...selectEl.options].some((o) => o.value === fn)) {
            const opt = document.createElement('option');
            opt.value = fn;
            opt.dataset.title = title;
            opt.textContent = title;
            selectEl.appendChild(opt);
          }
          selectEl.value = fn;
          document.getElementById('gt1b-patch-input')?.focus();
        }
      }

      if (e.target?.classList.contains('gt1b-test-btn')) {
        selectGT1BPatch(Number(e.target.dataset.patch));
      }

      if (e.target?.classList.contains('gt1b-del-btn')) {
        const fn = e.target.dataset.deleteFn;
        await fetch(`/api/plugins/gt1b-setlist/mappings/${encodeURIComponent(fn)}`, {
          method: 'DELETE',
        });
        await loadMappings();
        renderSetlistUI();
      }
    });
  }

  init();
})();

