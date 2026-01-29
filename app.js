window.addEventListener('DOMContentLoaded', () => {
    // --- UTILS: FULLSCREEN & WAKE LOCK ---
    const goFullscreen = async () => {
        try {
            if (document.documentElement.requestFullscreen) {
                await document.documentElement.requestFullscreen();
            } else if (document.documentElement.webkitRequestFullscreen) {
                await document.documentElement.webkitRequestFullscreen();
            }
            // Keep screen on if possible
            if ('wakeLock' in navigator) {
                try { await navigator.wakeLock.request('screen'); } catch(e){}
            }
        } catch (e) { console.log("Fullscreen denied"); }
    };

    // --- DOM ELEMENTS ---
    const ui = {
        pages: { home: document.getElementById('home'), lobby: document.getElementById('lobby'), call: document.getElementById('call') },
        creator: document.getElementById('creator-ui'),
        joiner: document.getElementById('joiner-ui'),
        linkBox: document.getElementById('link-box'),
        status: document.getElementById('status-txt'),
        chatBox: document.getElementById('chat-box'),
        controls: document.getElementById('controls')
    };

    // --- LOGIC ---
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}`);
    let roomID, isCreator = false, pc, localStream, micOn = true, timer;

    // Routing
    const hash = location.hash.replace('#', '');
    if (hash.length > 3) {
        roomID = hash;
        isCreator = false;
        showPage('lobby');
        ui.creator.classList.add('hidden');
        ui.joiner.classList.remove('hidden');
    } else {
        showPage('home');
    }

    function showPage(key) {
        Object.values(ui.pages).forEach(p => p.classList.remove('active'));
        ui.pages[key].classList.add('active');
    }

    // --- BUTTONS ---
    document.getElementById('create-btn').onclick = () => {
        goFullscreen(); // FORCE FULLSCREEN
        roomID = Math.random().toString(36).substr(2, 9);
        isCreator = true;
        location.hash = roomID;
        ui.linkBox.value = location.href;
        showPage('lobby');
        ui.creator.classList.remove('hidden');
        ui.joiner.classList.add('hidden');
    };

    document.getElementById('copy-btn').onclick = () => {
        navigator.clipboard.writeText(ui.linkBox.value);
        alert("Link copied!");
    };

    document.getElementById('join-btn').onclick = async () => {
        goFullscreen(); // FORCE FULLSCREEN
        showPage('call');
        await initCall();
        send({ type: "ready" });
    };

    // --- WEBRTC ---
    async function initCall() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
            });
            
            pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
            localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

            pc.ontrack = e => {
                const aud = document.createElement('audio');
                aud.srcObject = e.streams[0];
                aud.autoplay = true;
                document.body.appendChild(aud);
                ui.status.innerText = "Connected & Live";
                startVisualizer(e.streams[0]); // Visualize Remote Audio
            };

            pc.onicecandidate = e => { if (e.candidate) send({ type: "candidate", candidate: e.candidate }); };

        } catch (e) { alert("Mic Error: " + e.message); }
    }

    // --- SOCKET ---
    socket.onmessage = async (e) => {
        const d = JSON.parse(e.data);
        if (d.room !== roomID) return;

        if (d.type === "ready" && isCreator) {
            showPage('call');
            await initCall();
            const off = await pc.createOffer();
            await pc.setLocalDescription(off);
            send({ type: "offer", sdp: off });
        }
        else if (d.type === "offer" && !isCreator) {
            await pc.setRemoteDescription(d.sdp);
            const ans = await pc.createAnswer();
            await pc.setLocalDescription(ans);
            send({ type: "answer", sdp: ans });
        }
        else if (d.type === "answer") await pc.setRemoteDescription(d.sdp);
        else if (d.type === "candidate") await pc.addIceCandidate(d.candidate);
        else if (d.type === "chat") addMsg(d.text, false);
    };

    function send(msg) { msg.room = roomID; socket.send(JSON.stringify(msg)); }

    // --- UI INTERACTIONS ---
    document.body.onclick = (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
        ui.controls.classList.add('show');
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (ui.chatBox.classList.contains('hidden')) ui.controls.classList.remove('show');
        }, 4000);
    };

    document.getElementById('mute-btn').onclick = function() {
        micOn = !micOn;
        localStream.getAudioTracks()[0].enabled = micOn;
        this.innerText = micOn ? "🎙️" : "🔇";
        this.classList.toggle('red', !micOn);
    };

    document.getElementById('end-btn').onclick = () => location.href = location.origin;
    document.getElementById('chat-toggle').onclick = () => ui.chatBox.classList.toggle('hidden');

    document.getElementById('chat-input').onkeypress = (e) => {
        if (e.key === 'Enter' && e.target.value) {
            send({ type: "chat", text: e.target.value });
            addMsg(e.target.value, true);
            e.target.value = '';
        }
    };

    function addMsg(txt, me) {
        const d = document.createElement('div');
        d.className = me ? 'msg me' : 'msg';
        d.innerText = txt;
        document.getElementById('messages').appendChild(d);
        document.getElementById('messages').scrollTop = 9999;
    }

    // --- 3D VISUALIZER ---
    startVisualizer(null); 

    function startVisualizer(stream) {
        const cvs = document.getElementById('liquid-canvas');
        if (!cvs) return;

        let analyser, data;
        if (stream) {
            const actx = new (window.AudioContext || window.webkitAudioContext)();
            const src = actx.createMediaStreamSource(stream);
            analyser = actx.createAnalyser();
            analyser.fftSize = 64;
            src.connect(analyser);
            data = new Uint8Array(analyser.frequencyBinCount);
        }

        const scene = new THREE.Scene();
        const cam = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 1000);
        const ren = new THREE.WebGLRenderer({ canvas: cvs, alpha: true });
        ren.setSize(innerWidth, innerHeight);
        cam.position.z = 2.2;

        const geo = new THREE.IcosahedronGeometry(1, 10);
        const mat = new THREE.MeshNormalMaterial({ wireframe: true });
        const blob = new THREE.Mesh(geo, mat);
        scene.add(blob);

        function anim() {
            requestAnimationFrame(anim);
            let boost = 0;
            if (analyser) {
                analyser.getByteFrequencyData(data);
                boost = (data[4] / 255) * 0.6;
            }
            
            const time = Date.now() * 0.002;
            blob.rotation.y = time * 0.2;
            
            // Wobble
            const pos = blob.geometry.attributes.position;
            const v = new THREE.Vector3();
            for (let i = 0; i < pos.count; i++) {
                v.fromBufferAttribute(pos, i);
                const n = Math.sin(v.x*3 + time) * Math.cos(v.y*3 + time);
                const scale = 1 + (n * (0.1 + boost));
                v.normalize().multiplyScalar(scale);
                pos.setXYZ(i, v.x, v.y, v.z);
            }
            pos.needsUpdate = true;
            ren.render(scene, cam);
        }
        anim();
        window.onresize = () => { ren.setSize(innerWidth, innerHeight); cam.aspect = innerWidth/innerHeight; cam.updateProjectionMatrix(); };
    }
});
