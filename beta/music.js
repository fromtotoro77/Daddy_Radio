/*
 * Daddy Radio — 음악 재생 (v3.1.0)
 * ------------------------------------------------------------
 * - 폰에서 음악 폴더를 하나 지정한다. 그 안의 하위 폴더(예: 트로트, 발라드)가 목록으로 나오고,
 *   하위 폴더를 열어 '순차 재생' 또는 '랜덤 재생'. 곡을 누르면 그 곡부터 순차 재생.
 *   (앱 저장소(IndexedDB)에 보관 → 앱을 다시 열어도 유지, '폴더 변경'으로 다른 폴더로 교체)
 * - 라디오와 같은 오디오 장치·재생 버튼·시각화를 함께 쓴다.
 *   라디오 쪽 전역(audio, playAudio, pauseAudio, loadToken, currentHls ...)은 index.html에 정의돼 있다.
 */
(() => {
    // ─── 저장소(IndexedDB) ─────────────────────────────────────
    // folder: 지정된 폴더 정보 1건 { id: 'current', name }
    // tracks: 그 폴더의 곡들 { id, name, group, blob }  group = 하위 폴더 이름
    let db = null;

    function openDB() {
        return new Promise((resolve, reject) => {
            const r = indexedDB.open('daddy-music', 1);
            r.onupgradeneeded = () => {
                const d = r.result;
                if (!d.objectStoreNames.contains('folder')) d.createObjectStore('folder', { keyPath: 'id' });
                if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks', { keyPath: 'id' });
            };
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
    }
    const asPromise = (r) => new Promise((resolve, reject) => {
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
    const done = (t) => new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); });
    const store = (name, mode = 'readonly') => db.transaction(name, mode).objectStore(name);
    const byName = (a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true });

    const getFolder = () => asPromise(store('folder').get('current'));
    const getAllTracks = async () => (await asPromise(store('tracks').getAll())).sort(byName);
    const getTracks = async (group) => (await getAllTracks()).filter((t) => t.group === group);
    const getTrack = (id) => asPromise(store('tracks').get(id));

    // ─── 상태 ───────────────────────────────────────────────────
    const M = {
        picking: false,   // '폴더 변경'을 눌러 고르는 화면을 보는 중
        group: null,      // 화면에 열어 둔 하위 폴더 (null이면 하위 폴더 목록)
        playGroup: null,  // 재생 중인 하위 폴더
        playlist: [],     // 재생 순서대로 늘어선 곡 id
        idx: -1,
        mode: 'seq',      // 'seq'(순차) | 'shuffle'(랜덤) | 'repeat'(한 곡 반복)
        active: false,    // 음악 모드 여부 (false면 라디오 모드)
        currentId: null,
        objUrl: null,
    };

    const view = document.getElementById('music-view');
    const fileInput = document.getElementById('music-file-input');    // 폴더째 고르기
    const filesInput = document.getElementById('music-files-input');  // 곡 직접 고르기

    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const ICON = {
        play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
        repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/><path d="M11.5 10.5 13 9.5v5"/></svg>',
        shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
        back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
        folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    };

    // ─── 화면 그리기 ────────────────────────────────────────────
    async function render() {
        if (!db) { view.innerHTML = '<div class="music-empty">음악 저장소를 열 수 없습니다.</div>'; return; }

        const folder = await getFolder();
        if (!folder || M.picking) {
            view.innerHTML = `
                <button class="music-add-card" data-act="pick">${ICON.folder}<span>폰 폴더 지정</span></button>
                <div class="music-hint">폴더 <b>안으로 들어간 뒤</b>, 파일은 누르지 말고<br>화면 아래 <b>'이 폴더 사용'</b> 버튼을 누르세요.</div>
                <button class="music-link-btn" data-act="pick-files">폴더 선택이 안 되면 곡 직접 고르기</button>
                ${folder ? '<button class="music-link-btn" data-act="cancel-pick">취소</button>' : ''}`;
            return;
        }

        const all = await getAllTracks();
        const groups = [...new Set(all.map((t) => t.group))].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
        // 하위 폴더가 하나뿐이면 목록을 건너뛰고 바로 연다
        const group = M.group !== null && groups.includes(M.group) ? M.group : (groups.length === 1 ? groups[0] : null);

        if (group === null) {
            view.innerHTML = `
                <div class="music-folder-head">
                    <span class="music-folder-icon">${ICON.folder}</span>
                    <h3 class="truncate">${esc(folder.name)}</h3>
                    <button class="music-change-btn" data-act="refresh">새 곡 반영</button>
                    <button class="music-change-btn" data-act="change">폴더 변경</button>
                </div>
                ${groups.map((g) => `
                    <div class="station-card ${g === M.playGroup && M.active ? 'active' : ''}" data-act="open" data-group="${esc(g)}">
                        <div class="station-badge">${all.filter((t) => t.group === g).length}</div>
                        <div class="flex-grow min-w-0">
                            <h3 class="font-semibold text-zinc-100 truncate">${esc(g)}</h3>
                        </div>
                    </div>`).join('')}`;
            return;
        }

        const tracks = all.filter((t) => t.group === group);
        view.innerHTML = `
            <div class="music-folder-head">
                ${groups.length > 1
                    ? `<button class="music-icon-btn" data-act="back" title="하위 폴더 목록">${ICON.back}</button>`
                    : `<span class="music-folder-icon">${ICON.folder}</span>`}
                <h3 class="truncate">${esc(group)}</h3>
                <button class="music-change-btn" data-act="refresh">새 곡 반영</button>
                <button class="music-change-btn" data-act="change">폴더 변경</button>
            </div>
            <div class="music-actions">
                ${[['seq', ICON.play, '순차 재생'], ['shuffle', ICON.shuffle, '랜덤 재생'], ['repeat', ICON.repeat, '반복 재생']].map(([m, icon, label]) => `
                <button class="music-action ${M.active && M.playGroup === group && M.mode === m ? 'on' : ''}" data-act="play-${m}" ${tracks.length ? '' : 'disabled'}>${icon}<span>${label}</span></button>`).join('')}
            </div>
            <div class="music-tracks">
                ${tracks.map((t, i) => {
                    const playing = t.id === M.currentId && M.active;
                    return `
                    <button class="music-track ${playing ? 'playing' : ''}" data-act="play-track" data-id="${t.id}">
                        <span class="music-track-no">${playing ? ICON.play : i + 1}</span>
                        <span class="music-track-name">${esc(t.name)}</span>
                    </button>`;
                }).join('')}
            </div>`;
    }

    // ─── 사용자 동작 ────────────────────────────────────────────
    view.addEventListener('click', (e) => {
        const el = e.target.closest('[data-act]');
        if (!el) return;
        const act = el.dataset.act;
        if (act === 'pick') fileInput.click();
        else if (act === 'pick-files') filesInput.click();
        else if (act === 'change') { M.picking = true; render(); }
        else if (act === 'refresh') refreshFolder();
        else if (act === 'cancel-pick') { M.picking = false; render(); }
        else if (act === 'open') { M.group = el.dataset.group; render(); }
        else if (act === 'back') { M.group = null; render(); }
        else if (act === 'play-seq') startPlay('seq');
        else if (act === 'play-shuffle') startPlay('shuffle');
        else if (act === 'play-repeat') startPlay('repeat');
        // 곡을 누르면 그 곡부터 재생 (한 곡 반복 중이면 누른 곡을 반복)
        else if (act === 'play-track') startPlay(M.active && M.mode === 'repeat' ? 'repeat' : 'seq', el.dataset.id);
    });

    // 폰 폴더 지정: 고른 폴더 안의 음원 파일을 통째로 저장 (이전 폴더는 교체)
    const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i;
    // 새 곡 반영: 폰 폴더에 곡을 넣은 뒤 같은 폴더를 다시 고르면 목록을 갱신한다
    // (웹 앱은 폰 폴더를 계속 지켜볼 수 없어서, 다시 골라 줘야 새 곡을 알 수 있음)
    async function refreshFolder() {
        const folder = await getFolder();
        if (!folder) return;
        showToast(folder.mode === 'files'
            ? `'${folder.name}'에 넣을 곡들을 다시 고르세요`
            : `'${folder.name}' 폴더를 다시 고르세요`);
        (folder.mode === 'files' ? filesInput : fileInput).click();
    }

    fileInput.addEventListener('change', () => importPicked(fileInput));
    filesInput.addEventListener('change', () => importPicked(filesInput));

    async function importPicked(input) {
        const picked = [...input.files];
        input.value = '';
        await ready;
        if (!db) { showToast('음악 저장소를 열 수 없습니다'); return; }
        const files = picked.filter((f) => (f.type || '').startsWith('audio/') || AUDIO_EXT.test(f.name));
        if (!files.length) { if (picked.length) showToast('이 폴더에는 음원 파일이 없습니다'); return; }

        // 폴더째 골랐으면 경로가 '지정폴더/하위폴더/.../곡.mp3'. 폴더 선택을 지원하지 않는 폰이면 이름을 물어본다.
        const rel = files[0].webkitRelativePath || '';
        let name = rel.includes('/') ? rel.split('/')[0] : '';
        if (!name) name = (prompt('이 곡들을 묶을 이름', '내 음악') || '').trim();
        if (!name) return;
        M.picking = false;

        try {
            if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); // 저장 공간이 임의로 지워지지 않게 요청
            if (M.active) stopMusic();
            const prevFolder = await getFolder();
            const key = (g, n) => `${g}/${n}`;
            const before = new Set((await getAllTracks()).map((x) => key(x.group, x.name)));
            const t = db.transaction(['folder', 'tracks'], 'readwrite');
            t.objectStore('tracks').clear();
            t.objectStore('folder').put({ id: 'current', name, mode: input === filesInput ? 'files' : 'folder' });
            files.forEach((f, i) => {
                const parts = (f.webkitRelativePath || '').split('/');
                // 지정 폴더 바로 아래 곡은 지정 폴더 이름으로, 그 밖은 첫 번째 하위 폴더 이름으로 묶는다
                const group = parts.length > 2 ? parts[1] : name;
                t.objectStore('tracks').put({ id: `${Date.now()}-${i}`, name: f.name.replace(/\.[^.]+$/, ''), group, blob: f });
            });
            await done(t);
            M.group = null;
            const skipped = picked.length - files.length;
            if (prevFolder && prevFolder.name === name) {
                // 같은 폴더를 다시 고름 → 바뀐 점만 알려줌
                const after = new Set((await getAllTracks()).map((x) => key(x.group, x.name)));
                const added = [...after].filter((k) => !before.has(k)).length;
                const removed = [...before].filter((k) => !after.has(k)).length;
                const parts = [];
                if (added) parts.push(`새 곡 ${added}곡 추가`);
                if (removed) parts.push(`${removed}곡 빠짐`);
                showToast(parts.length ? `${parts.join(', ')} · 총 ${files.length}곡` : `바뀐 곡이 없습니다 (총 ${files.length}곡)`);
            } else {
                showToast(`'${name}' ${files.length}곡${skipped ? ` (음원 아닌 파일 ${skipped}개 제외)` : ''}`);
            }
        } catch (err) {
            console.error(err);
            showToast('저장 공간이 부족해 폴더를 지정하지 못했습니다');
        }
        render();
    }

    // ─── 재생 ──────────────────────────────────────────────────
    // 지금 화면에 열려 있는 하위 폴더 (화면 머리줄의 제목과 같음)
    const currentGroup = () => {
        const h = view.querySelector('.music-folder-head h3');
        return M.group !== null ? M.group : (h ? h.textContent : null);
    };
    const shuffle = (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    };

    async function startPlay(mode, startId = null) {
        const group = currentGroup();
        const tracks = await getTracks(group);
        if (!tracks.length) return;
        M.playGroup = group;
        let ids = tracks.map((t) => t.id);
        if (mode === 'shuffle') ids = shuffle(ids);
        if (!startId) showToast({ seq: '순차 재생', shuffle: '랜덤 재생', repeat: '한 곡 반복' }[mode]);

        // 반복 재생: 이 폴더의 곡을 듣고 있었다면 그 곡을 끊지 않고 이어서 반복
        if (mode === 'repeat' && !startId && M.active && ids.includes(M.currentId)) {
            M.mode = 'repeat';
            M.playlist = ids;
            M.idx = ids.indexOf(M.currentId);
            audio.loop = true;
            freqDisplay.textContent = `${M.idx + 1}/${ids.length}`;
            render();
            return;
        }
        M.mode = mode;
        M.playlist = ids;
        audio.loop = mode === 'repeat'; // 한 곡 반복은 오디오 자체의 반복 기능을 사용(끊김 없음)
        playIndex(startId ? Math.max(0, ids.indexOf(startId)) : 0);
    }

    async function playIndex(i) {
        const n = M.playlist.length;
        if (!n) return stopMusic();
        M.idx = ((i % n) + n) % n;
        const t = await getTrack(M.playlist[M.idx]);
        if (!t) { M.playlist.splice(M.idx, 1); return playIndex(M.idx); }

        enterMusicMode();
        const old = M.objUrl;
        M.objUrl = URL.createObjectURL(t.blob);
        audio.src = M.objUrl;
        if (old) URL.revokeObjectURL(old);
        M.currentId = t.id;

        freqDisplay.textContent = `${M.idx + 1}/${n}`;
        nameDisplay.textContent = t.name;
        playAudio();
        updateMediaSession(t);
        render();
    }

    function next() {
        if (!M.active || !M.playlist.length) return;
        // 랜덤 재생이 한 바퀴 돌면 순서를 새로 섞는다
        if (M.mode === 'shuffle' && M.idx === M.playlist.length - 1) {
            M.playlist = shuffle(M.playlist);
            return playIndex(0);
        }
        playIndex(M.idx + 1);
    }

    function prev() {
        if (!M.active || !M.playlist.length) return;
        if (audio.currentTime > 3) { audio.currentTime = 0; return; } // 3초 넘게 들었으면 처음부터
        playIndex(M.idx - 1);
    }

    audio.addEventListener('ended', () => { if (M.active) next(); });

    // 재생할 수 없는 곡(예: 안드로이드가 못 여는 애플 무손실 m4a)은 알리고 다음 곡으로.
    // 폴더 전체가 재생 불가면 무한히 넘기지 않도록 연속 실패 횟수를 센다.
    let failStreak = 0;
    audio.addEventListener('playing', () => { if (M.active) failStreak = 0; });
    audio.addEventListener('error', () => {
        if (!M.active || !audio.src.startsWith('blob:')) return;
        failStreak++;
        const name = nameDisplay.textContent;
        if (failStreak >= M.playlist.length) {
            showToast('이 폴더의 곡을 재생할 수 없습니다 (지원하지 않는 형식)');
            failStreak = 0;
            return stopMusic();
        }
        showToast(`재생할 수 없는 파일: ${name}`);
        next();
    });
    document.getElementById('music-prev').addEventListener('click', prev);
    document.getElementById('music-next').addEventListener('click', next);

    // 라디오를 멈추고 음악 모드로 전환
    function enterMusicMode() {
        if (M.active) return;
        loadToken++;                       // 진행 중이던 라디오 연결 시도·재시도를 모두 무효화
        clearStallTimer();
        if (currentHls) { try { currentHls.destroy(); } catch (e) {} currentHls = null; }
        lastLoadedStation = null;          // 라디오 끊김 자동 재연결이 음악을 덮어쓰지 않게
        if (activeStationId !== null) { activeStationId = null; renderStations(); }
        M.active = true;
        document.body.classList.add('music-mode');
        setLampLabel('MUSIC');
        setMediaHandlers(true);
    }

    // 음악 모드 종료 (라디오 재생이 시작될 때 index.html의 loadStream에서 호출)
    function exitMusicMode() {
        if (!M.active) return;
        audio.loop = false; // 라디오에 반복 설정이 남지 않게
        M.active = false;
        M.currentId = null;
        M.idx = -1;
        document.body.classList.remove('music-mode');
        setLampLabel('ON AIR');
        setMediaHandlers(false);
        if (M.objUrl) { URL.revokeObjectURL(M.objUrl); M.objUrl = null; }
        render();
    }
    window.exitMusicMode = exitMusicMode;

    // 폴더를 바꿀 때 재생 중이던 음악을 멈춤
    function stopMusic() {
        if (!M.active) return;
        pauseAudio();
        audio.removeAttribute('src');
        audio.load();
        exitMusicMode();
        freqDisplay.textContent = '--.-';
        nameDisplay.textContent = '채널을 선택하세요';
    }

    function setLampLabel(text) {
        const lamp = document.getElementById('on-air');
        if (lamp && lamp.lastChild) lamp.lastChild.nodeValue = text;
    }

    // ─── 잠금화면·알림창 컨트롤 (안드로이드) ──────────────────────
    function updateMediaSession(t) {
        if (!('mediaSession' in navigator)) return;
        getFolder().then((folder) => {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: t.name,
                artist: M.playGroup || (folder ? folder.name : ''),
                album: 'Daddy Radio',
                artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
            });
        });
    }
    function setMediaHandlers(on) {
        if (!('mediaSession' in navigator)) return;
        const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, on ? fn : null); } catch (e) {} };
        set('play', playAudio);
        set('pause', pauseAudio);
        set('nexttrack', next);
        set('previoustrack', prev);
        if (!on) navigator.mediaSession.metadata = null;
    }

    // ─── 시작 ──────────────────────────────────────────────────
    // 저장소는 바로 열기 시작하고, 폴더 지정 등은 열릴 때까지 기다렸다 처리한다
    const ready = openDB().then((d) => { db = d; }).catch((e) => console.error('음악 저장소 열기 실패', e));
    window.addEventListener('load', () => { ready.then(render); });
})();
