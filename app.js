// --- CONFIGURATION ---
const ui = {
    overlay: document.getElementById('start-overlay'),
    app: document.getElementById('app'),
    pages: { home: document.getElementById('home'), lobby: document.getElementById('lobby'), call: document.getElementById('call') },
    creatorView: document.getElementById('creator-view'),
    joinerView: document.getElementById('joiner-view'),
    linkDisplay: document.getElementById('link-display'),
    status: document.getElementById('status-txt'),
    toast: document.getElementById('toast')
};

const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    iceCandidatePoolSize: 10 // Pre-fetch candidates for speed
};

const audioConstraints = {
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        latency: 0, // Request lowest possible latency
        sampleRate: 48000
    },
    video: false
};

// --- STATE ---
let socket, pc, localStream;
let roomID = null;
let isCreator = false;
let micOn = true;
let candidateQueue = []; // THE FIX: Queue for storing ICE candidates

// --- 1. INITIALIZATION ---
// Auto-detect secure socket
const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
socket = new WebSocket(`${protocol}//${location.host}`);

// Start Visualizer immediately (Idle mode)
initLiquid();

// Button: Enter Fullscreen App
document.getElementById('enter-app-btn').onclick = async () => {
    try {
        if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
        else if (document.documentElement.webkitRequestFullscreen) await document.documentElement.webkitRequestFullscreen();
        // Keep screen awake
        if('wakeLock' in navigator) await navigator.wakeLock.request('screen');
    } catch(e){}

    ui.overlay.classList.add('hidden');
    ui.app.classList.remove('hidden');
    
    // Check URL for room
    const params = new URLSearchParams(window.location.search);
    if (params.has('room')) {
        roomID = params.get('room');
        isCreator = false;
        showPage('lobby');
        ui.creatorView.classList.add('hidden');
        ui.joinerView.classList.remove('hidden');
    } else {
        showPage('home');
    }
};

function showPage(name) {
    Object.values(ui.pages).forEach(p => p.classList.remove('active'));
    ui.pages[name].classList.add('active');
}

// --- 2. USER ACTIONS ---

// Create Room
document.getElementById('create-btn').onclick = () => {
    roomID = Math.random().toString(36).substr(2, 6);
    isCreator = true;
    
    const newUrl = `${window.location.origin}${window.location.pathname}?room=${roomID}`;
    window.history.pushState({path: newUrl}, '', newUrl);

    ui.linkDisplay.innerText = newUrl;
    showPage('lobby');
    ui.creatorView.classList.remove('hidden');
    ui.joinerView.classList.add('hidden');
};

// Copy Link
document.getElementById('copy-btn').onclick = () => {
    navigator.clipboard.writeText(ui.linkDisplay.innerText);
    ui.toast.classList.add('show');
    setTimeout(() => ui.toast.classList.remove('show'), 2000);
};

// Join Room
document.getElementById('join-btn').onclick = async () => {
    ui.joinerView.innerHTML = "<p>Connecting...</p>";
    showPage('call');
    ui.status.innerText = "Initializing Audio...";
    
    await startAudio();
    createPeerConnection();
    send({ type: "ready" }); // Tell creator we are ready
};

// --- 3. WEBRTC ENGINE (The Robust Part) ---

async function startAudio() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia(audioConstraints);
    } catch (e) {
        alert("Audio Access Denied. Cannot call.");
        throw e;
    }
}

function createPeerConnection() {
    pc = new RTCPeerConnection(rtcConfig);

    // Add local tracks
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    // Handle Remote Stream (The Voice)
    pc.ontrack = (event) => {
        const audio = document.createElement('audio');
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
        audio.playsInline = true; // Crucial for iOS
        document.body.appendChild(audio);
        
        ui.status.innerText = "Connected • Live";
        
        // Connect Remote Audio to Visualizer
        connectAudioToLiquid(event.streams[0]);
    };

    // Send ICE candidates immediately
    pc.onicecandidate = (event) => {
        if (event.candidate) send({ type: "candidate", candidate: event.candidate });
    };
}

// --- 4. SIGNALING (Fixed Logic) ---

socket.onmessage = async (e) => {
    const msg = JSON.parse(e.data);
    if (msg.room !== roomID) return;

    try {
        // A. CREATOR FLOW
        if (msg.type === "ready" && isCreator) {
            showPage('call');
            ui.status.innerText = "Connecting...";
            await startAudio();
            createPeerConnection();
            
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            send({ type: "offer", sdp: offer });
        }

        // B. JOINER FLOW
        else if (msg.type === "offer" && !isCreator) {
            if (!pc) createPeerConnection(); // Safeguard
            
            await pc.setRemoteDescription(msg.sdp);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            send({ type: "answer", sdp: answer });
            
            processCandidateQueue(); // Apply any queued candidates
        }

        // C. ANSWER HANDLING
        else if (msg.type === "answer" && isCreator) {
            await pc.setRemoteDescription(msg.sdp);
            processCandidateQueue(); // Apply any queued candidates
        }

        // D. ICE CANDIDATE HANDLING (With Queue)
        else if (msg.type === "candidate") {
            if (pc && pc.remoteDescription) {
                await pc.addIceCandidate(msg.candidate);
            } else {
                // If remote desc isn't ready, QUEUE IT.
                // This prevents "failed to set remote candidate" errors.
                candidateQueue.push(msg.candidate);
            }
        }

    } catch (err) {
        console.error("Signaling Error:", err);
    }
};

async function processCandidateQueue() {
    if (!pc) return;
    while (candidateQueue.length > 0) {
        const cand = candidateQueue.shift();
        try { await pc.addIceCandidate(cand); } catch(e) {}
    }
}

function send(data) {
    data.room = roomID;
    socket.send(JSON.stringify(data));
}

// --- 5. UI UTILS ---
document.getElementById('mute-btn').onclick = function() {
    micOn = !micOn;
    localStream.getAudioTracks()[0].enabled = micOn;
    this.innerText = micOn ? "🎙️" : "🔇";
    this.classList.toggle('red', !micOn);
};

document.getElementById('end-btn').onclick = () => window.location = window.location.origin;

// --- 6. 3D LIQUID VISUALIZER ---
let analyser, dataArray;

function initLiquid() {
    const canvas = document.getElementById('liquid-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 100);
    camera.position.z = 3.5;

    // Dramatic Lighting for 3D look
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);
    
    const light1 = new THREE.PointLight(0x00ffff, 2, 50);
    light1.position.set(5, 5, 5);
    scene.add(light1);

    const light2 = new THREE.PointLight(0xff00ff, 2, 50);
    light2.position.set(-5, -5, 5);
    scene.add(light2);

    // Liquid Material
    const geo = new THREE.IcosahedronGeometry(1.4, 30);
    const mat = new THREE.MeshPhysicalMaterial({
        color: 0x333333,
        roughness: 0,
        metalness: 0.2,
        transmission: 0.1,
        clearcoat: 1,
        clearcoatRoughness: 0,
        emissive: 0x111111
    });

    const blob = new THREE.Mesh(geo, mat);
    scene.add(blob);

    function animate() {
        requestAnimationFrame(animate);

        let freq = 0;
        if (analyser) {
            analyser.getByteFrequencyData(dataArray);
            freq = dataArray[4] / 255; // React to bass
        }

        const time = performance.now() * 0.001;
        blob.rotation.y = time * 0.15;
        blob.rotation.z = time * 0.1;

        // Wave Distortion
        const pos = geo.attributes.position;
        const v = new THREE.Vector3();
        
        for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i);
            v.normalize();
            
            // Dynamic Wave Math
            const wave = 0.2 * Math.sin(v.x * 3 + time + freq * 4) +
                         0.2 * Math.cos(v.y * 3 + time + freq * 4);
            
            // Pulse on Audio
            const scale = 1.4 + wave + (freq * 0.3);
            
            v.multiplyScalar(scale);
            pos.setXYZ(i, v.x, v.y, v.z);
        }
        
        geo.computeVertexNormals();
        pos.needsUpdate = true;
        
        // Color Shift based on audio
        if(freq > 0.1) {
            blob.material.emissive.setHSL((time * 0.1) % 1, 0.8, freq * 0.5);
        }

        renderer.render(scene, camera);
    }
    animate();

    window.onresize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
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
