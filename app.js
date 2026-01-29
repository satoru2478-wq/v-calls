// --- DOM ELEMENTS ---
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
    iceCandidatePoolSize: 10
};

// --- STATE ---
let socket, pc, localStream;
let roomID = null;
let isCreator = false;
let micOn = true;
let candidateQueue = [];

// Initialize Socket
const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
socket = new WebSocket(`${protocol}//${location.host}`);

// Start Liquid Background Immediately
initLiquid();

// --- BUTTON LOGIC (Fixed) ---

// 1. ENTER APP (The Fix: Works even if Fullscreen fails)
document.getElementById('enter-app-btn').onclick = async () => {
    try {
        if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
        else if (document.documentElement.webkitRequestFullscreen) await document.documentElement.webkitRequestFullscreen();
    } catch(e) {
        console.log("Fullscreen skipped"); // Ignore error, keep working
    }

    // Always show app
    ui.overlay.classList.add('hidden');
    ui.app.classList.remove('hidden');

    // Routing Logic
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

// 2. CREATE LINK
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

// 3. COPY LINK
document.getElementById('copy-btn').onclick = () => {
    navigator.clipboard.writeText(ui.linkDisplay.innerText);
    ui.toast.classList.add('show');
    setTimeout(() => ui.toast.classList.remove('show'), 2000);
};

// 4. JOIN CALL
document.getElementById('join-btn').onclick = async () => {
    showPage('call');
    ui.status.innerText = "Initializing...";
    await startAudio();
    createPeerConnection();
    send({ type: "ready" });
};

// --- WEBRTC CORE ---

async function startAudio() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true, noiseSuppression: true, latency: 0 } 
        });
    } catch (e) {
        alert("Mic Error. Check Permissions.");
    }
}

function createPeerConnection() {
    pc = new RTCPeerConnection(rtcConfig);
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.ontrack = (event) => {
        const aud = document.createElement('audio');
        aud.srcObject = event.streams[0];
        aud.autoplay = true;
        aud.playsInline = true;
        document.body.appendChild(aud);
        ui.status.innerText = "Connected • Live";
        
        // Connect Remote Audio to Visualizer
        connectAudioToLiquid(event.streams[0]);
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) send({ type: "candidate", candidate: event.candidate });
    };
}

// --- SIGNALING ---

socket.onmessage = async (e) => {
    const msg = JSON.parse(e.data);
    if (msg.room !== roomID) return;

    if (msg.type === "ready" && isCreator) {
        showPage('call');
        ui.status.innerText = "Connecting...";
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

async function processQueue() {
    while(candidateQueue.length) await pc.addIceCandidate(candidateQueue.shift());
}

function send(d) { d.room = roomID; socket.send(JSON.stringify(d)); }

// --- UI UTILS ---
document.getElementById('mute-btn').onclick = function() {
    micOn = !micOn;
    localStream.getAudioTracks()[0].enabled = micOn;
    this.classList.toggle('red', !micOn);
};
document.getElementById('end-btn').onclick = () => location.href = location.origin;

// --- 3D LIQUID VISUALIZER ---
let analyser, dataArray;

function initLiquid() {
    const cvs = document.getElementById('liquid-canvas');
    const ren = new THREE.WebGLRenderer({ canvas: cvs, alpha: true, antialias: true });
    ren.setSize(window.innerWidth, window.innerHeight);
    ren.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 100);
    cam.position.z = 3;

    // Light
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const pl = new THREE.PointLight(0xffffff, 1);
    pl.position.set(5,5,5);
    scene.add(pl);

    // Liquid Blob
    const geo = new THREE.IcosahedronGeometry(1.2, 10);
    const mat = new THREE.MeshPhongMaterial({ 
        color: 0x22a6b3, 
        shininess: 100,
        specular: 0xffffff,
        transparent: true,
        opacity: 0.9
    });
    const blob = new THREE.Mesh(geo, mat);
    scene.add(blob);

    function anim() {
        requestAnimationFrame(anim);
        let boost = 0;
        if(analyser) {
            analyser.getByteFrequencyData(dataArray);
            boost = (dataArray[4]/255) * 0.5;
        }

        const t = performance.now() * 0.001;
        blob.rotation.y = t * 0.2;
        blob.rotation.z = t * 0.1;

        // Blob Movement
        const pos = geo.attributes.position;
        const v = new THREE.Vector3();
        for(let i=0; i<pos.count; i++){
            v.fromBufferAttribute(pos, i);
            v.normalize();
            const wave = 0.2 * Math.sin(v.x*4 + t + boost*5) + 0.2 * Math.cos(v.y*4 + t);
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
