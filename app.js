window.onload = function() {
    
    // --- DOM ---
    const ui = {
        overlay: document.getElementById('start-overlay'),
        enterBtn: document.getElementById('enter-btn'),
        app: document.getElementById('app'),
        pages: { home: document.getElementById('home'), lobby: document.getElementById('lobby'), call: document.getElementById('call') },
        creator: document.getElementById('creator-view'),
        joiner: document.getElementById('joiner-view'),
        linkTxt: document.getElementById('link-txt'),
        status: document.getElementById('status'),
        toast: document.getElementById('toast')
    };

    // --- CONFIG ---
    const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
    let socket, pc, localStream, roomID, isCreator = false;
    let candidateQueue = [];

    // --- 1. ENTER APP (Safeguarded) ---
    ui.enterBtn.onclick = async () => {
        // Attempt Fullscreen (Ignore error if it fails)
        try {
            if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
            else if (document.documentElement.webkitRequestFullscreen) await document.documentElement.webkitRequestFullscreen();
        } catch(e) {}

        ui.overlay.classList.add('hidden');
        ui.app.classList.remove('hidden');

        // Init Socket
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(`${protocol}//${location.host}`);
        setupSocket();

        // Check URL
        const params = new URLSearchParams(window.location.search);
        if (params.has('room')) {
            roomID = params.get('room');
            isCreator = false;
            showPage('lobby');
            ui.creator.classList.add('hidden');
            ui.joiner.classList.remove('hidden');
        } else {
            showPage('home');
        }

        // Start Visualizer
        initLiquid();
    };

    function showPage(name) {
        Object.values(ui.pages).forEach(p => p.classList.remove('active'));
        ui.pages[name].classList.add('active');
    }

    // --- 2. BUTTONS ---
    document.getElementById('create-btn').onclick = () => {
        roomID = Math.random().toString(36).substr(2, 6);
        isCreator = true;
        const url = `${location.origin}${location.pathname}?room=${roomID}`;
        history.pushState({path: url}, '', url);
        ui.linkTxt.innerText = url;
        
        showPage('lobby');
        ui.creator.classList.remove('hidden');
        ui.joiner.classList.add('hidden');
    };

    document.getElementById('copy-btn').onclick = () => {
        navigator.clipboard.writeText(ui.linkTxt.innerText);
        ui.toast.classList.add('show');
        setTimeout(() => ui.toast.classList.remove('show'), 2000);
    };

    document.getElementById('join-btn').onclick = async () => {
        showPage('call');
        ui.status.innerText = "Connecting...";
        await startAudio();
        createPeerConnection();
        send({ type: "ready" });
    };

    // --- 3. CONNECTION LOGIC ---
    async function startAudio() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: { echoCancellation: true, noiseSuppression: true, latency: 0 } 
            });
        } catch(e) { alert("Mic Access Denied"); }
    }

    function createPeerConnection() {
        pc = new RTCPeerConnection(rtcConfig);
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

        pc.ontrack = e => {
            const aud = document.createElement('audio');
            aud.srcObject = e.streams[0];
            aud.autoplay = true;
            document.body.appendChild(aud);
            ui.status.innerText = "Connected • Live";
            connectAudioToLiquid(e.streams[0]);
        };

        pc.onicecandidate = e => {
            if (e.candidate) send({ type: "candidate", candidate: e.candidate });
        };
    }

    // --- 4. SIGNALING ---
    function setupSocket() {
        socket.onmessage = async (e) => {
            const msg = JSON.parse(e.data);
            if (msg.room !== roomID) return;

            if (msg.type === "ready" && isCreator) {
                showPage('call');
                await startAudio();
                createPeerConnection();
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                send({ type: "offer", sdp: offer });
            }
            else if (msg.type === "offer" && !isCreator) {
                if (!pc) createPeerConnection();
                await pc.setRemoteDescription(msg.sdp);
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                send({ type: "answer", sdp: answer });
                processQueue();
            }
            else if (msg.type === "answer" && isCreator) {
                await pc.setRemoteDescription(msg.sdp);
                processQueue();
            }
            else if (msg.type === "candidate") {
                if (pc && pc.remoteDescription) await pc.addIceCandidate(msg.candidate);
                else candidateQueue.push(msg.candidate);
            }
        };
    }

    async function processQueue() {
        while(candidateQueue.length) await pc.addIceCandidate(candidateQueue.shift());
    }

    function send(d) { d.room = roomID; socket.send(JSON.stringify(d)); }

    // --- 5. UTILS ---
    document.getElementById('mute-btn').onclick = function() {
        let track = localStream.getAudioTracks()[0];
        track.enabled = !track.enabled;
        this.innerText = track.enabled ? "🎙️" : "🔇";
        this.classList.toggle('red', !track.enabled);
    };
    document.getElementById('end-btn').onclick = () => location.href = location.origin;

    // --- 6. 3D VISUALIZER ---
    let analyser, dataArray;
    function initLiquid() {
        const cvs = document.getElementById('liquid-canvas');
        if(!cvs) return;
        
        const ren = new THREE.WebGLRenderer({ canvas: cvs, alpha: true, antialias: true });
        ren.setSize(window.innerWidth, window.innerHeight);
        ren.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        const scene = new THREE.Scene();
        const cam = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 100);
        cam.position.z = 3;

        const light = new THREE.PointLight(0xffffff, 1);
        light.position.set(5, 5, 5);
        scene.add(light);
        scene.add(new THREE.AmbientLight(0xffffff, 0.5));

        const geo = new THREE.IcosahedronGeometry(1.2, 5);
        const mat = new THREE.MeshPhongMaterial({ 
            color: 0x00ffff, shininess: 100, opacity: 0.8, transparent: true 
        });
        const blob = new THREE.Mesh(geo, mat);
        scene.add(blob);

        function anim() {
            requestAnimationFrame(anim);
            const t = performance.now() * 0.001;
            blob.rotation.y = t * 0.2;
            
            // Audio Reaction
            let boost = 0;
            if (analyser) {
                analyser.getByteFrequencyData(dataArray);
                boost = (dataArray[4] / 255) * 0.4;
            }

            const pos = geo.attributes.position;
            const v = new THREE.Vector3();
            for(let i=0; i<pos.count; i++) {
                v.fromBufferAttribute(pos, i);
                v.normalize();
                const wave = 0.1 * Math.sin(v.x * 5 + t + boost * 5) + 0.1 * Math.cos(v.y * 5 + t);
                v.multiplyScalar(1.2 + wave + boost);
                pos.setXYZ(i, v.x, v.y, v.z);
            }
            pos.needsUpdate = true;
            geo.computeVertexNormals();
            ren.render(scene, cam);
        }
        anim();
        
        window.onresize = () => {
            ren.setSize(window.innerWidth, window.innerHeight);
            cam.aspect = window.innerWidth/window.innerHeight;
            cam.updateProjectionMatrix();
        };
    }

    function connectAudioToLiquid(stream) {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const src = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        src.connect(analyser);
        dataArray = new Uint8Array(analyser.frequencyBinCount);
    }
};
