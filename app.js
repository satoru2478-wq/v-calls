// --- DOM ELEMENTS ---
const ui = {
    overlay: document.getElementById('start-overlay'),
    app: document.getElementById('app'),
    pages: { home: document.getElementById('home'), lobby: document.getElementById('lobby'), call: document.getElementById('call') },
    creator: document.getElementById('creator-view'),
    joiner: document.getElementById('joiner-view'),
    linkTxt: document.getElementById('link-txt'),
    status: document.getElementById('status'),
    chatMsgs: document.getElementById('chat-msgs'),
    chatInput: document.getElementById('chat-input'),
    toast: document.getElementById('toast')
};

// --- CONFIG ---
const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
let socket, pc, localStream, roomID, isCreator = false;
let candidateQueue = [];

// --- 1. ENTER APP ---
document.getElementById('enter-btn').onclick = async () => {
    try {
        if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
        else if (document.documentElement.webkitRequestFullscreen) await document.documentElement.webkitRequestFullscreen();
    } catch(e) {} // Ignore fullscreen errors

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

    // START THE WATER VISUALIZER
    initWaterVisualizer();
};

function showPage(name) {
    Object.values(ui.pages).forEach(p => p.classList.remove('active'));
    ui.pages[name].classList.add('active');
}

// --- 2. LOGIC ---
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

// --- 3. CHAT ---
document.getElementById('send-btn').onclick = sendChat;
ui.chatInput.onkeypress = (e) => { if(e.key === 'Enter') sendChat(); };

function sendChat() {
    const txt = ui.chatInput.value;
    if(!txt) return;
    send({ type: "chat", text: txt });
    addMsg(txt, true);
    ui.chatInput.value = "";
}

function addMsg(txt, isMe) {
    const d = document.createElement('div');
    d.className = isMe ? "msg me" : "msg them";
    d.innerText = txt;
    ui.chatMsgs.appendChild(d);
    ui.chatMsgs.scrollTop = ui.chatMsgs.scrollHeight;
}

// --- 4. WEBRTC & SIGNALING ---
async function startAudio() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: true, noiseSuppression: true } 
        });
    } catch(e) { alert("Mic Error"); }
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
            while(candidateQueue.length) await pc.addIceCandidate(candidateQueue.shift());
        }
        else if (msg.type === "answer" && isCreator) {
            await pc.setRemoteDescription(msg.sdp);
            while(candidateQueue.length) await pc.addIceCandidate(candidateQueue.shift());
        }
        else if (msg.type === "candidate") {
            if (pc && pc.remoteDescription) await pc.addIceCandidate(msg.candidate);
            else candidateQueue.push(msg.candidate);
        }
        else if (msg.type === "chat") {
            addMsg(msg.text, false);
        }
    };
}

function send(d) { d.room = roomID; socket.send(JSON.stringify(d)); }

// --- 5. UI UTILS ---
document.getElementById('mute-btn').onclick = function() {
    let track = localStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    this.innerText = track.enabled ? "🎙️" : "🔇";
};
document.getElementById('end-btn').onclick = () => location.href = location.origin;


// --- 6. "WATER DROPLET" VISUALIZER ---
let analyser, dataArray;

function initWaterVisualizer() {
    const canvas = document.getElementById('liquid-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(65, window.innerWidth/window.innerHeight, 0.1, 100);
    camera.position.z = 4;

    // --- LIGHTING (Crucial for Glass Look) ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    // Main White Highlights
    const light1 = new THREE.DirectionalLight(0xffffff, 1.5);
    light1.position.set(5, 10, 7);
    scene.add(light1);

    // Teal/Cyan Accents (From Image Reference)
    const light2 = new THREE.PointLight(0x00bcd4, 2, 50); // Cyan
    light2.position.set(-5, -2, 5);
    scene.add(light2);

    const light3 = new THREE.PointLight(0x009688, 2, 50); // Teal
    light3.position.set(5, -5, 2);
    scene.add(light3);

    // --- MATERIAL: LIQUID GLASS ---
    // Using MeshPhysicalMaterial for real transmission (water/glass effect)
    const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,       // Base white
        roughness: 0,          // Perfectly smooth
        metalness: 0,          // Dielectric (like water)
        transmission: 1,       // Fully transparent
        thickness: 1.5,        // Refraction depth
        ior: 1.5,              // Index of Refraction (Water/Glass)
        clearcoat: 1,          // Shiny coating
        clearcoatRoughness: 0
    });

    // --- GEOMETRY ---
    const group = new THREE.Group();
    scene.add(group);

    // 1. Main Big Droplet
    const mainGeo = new THREE.IcosahedronGeometry(1.2, 20);
    const mainDroplet = new THREE.Mesh(mainGeo, glassMat);
    group.add(mainDroplet);

    // 2. Satellite Droplet 1 (Medium)
    const sat1 = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 32), glassMat);
    sat1.position.set(1.5, 0.5, 0.5);
    group.add(sat1);

    // 3. Satellite Droplet 2 (Small)
    const sat2 = new THREE.Mesh(new THREE.SphereGeometry(0.25, 32, 32), glassMat);
    sat2.position.set(-1.4, -0.8, 0.8);
    group.add(sat2);

    // 4. Satellite Droplet 3 (Tiny)
    const sat3 = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 32), glassMat);
    sat3.position.set(0.5, 1.6, -0.5);
    group.add(sat3);

    // --- ANIMATION LOOP ---
    function animate() {
        requestAnimationFrame(animate);
        
        // 1. Get Audio Data
        let bass = 0, mid = 0;
        if(analyser) {
            analyser.getByteFrequencyData(dataArray);
            bass = dataArray[4] / 255;  // Low freq
            mid = dataArray[20] / 255; // Mid freq
        }

        const t = performance.now() * 0.001;

        // 2. Rotate Group slowly
        group.rotation.y = t * 0.15;
        group.rotation.z = Math.sin(t * 0.2) * 0.1;

        // 3. Orbit Satellites (Floating feel)
        sat1.position.y = 0.5 + Math.sin(t + bass*2) * 0.3;
        sat2.position.x = -1.4 + Math.cos(t * 0.8) * 0.2;
        sat3.position.y = 1.6 + Math.sin(t * 1.5) * 0.2;

        // 4. Morph Main Droplet (Liquid Effect)
        // We modify vertices based on Noise + Audio
        const pos = mainGeo.attributes.position;
        const v = new THREE.Vector3();
        
        for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i);
            v.normalize(); // Start from sphere shape
            
            // Perlin-ish Noise Calculation
            const waveX = Math.sin(v.x * 2 + t);
            const waveY = Math.cos(v.y * 2 + t);
            const waveZ = Math.sin(v.z * 2 + t);
            
            // Audio Boost (Punch)
            const audioDistort = bass * 0.4;
            
            // Combine
            const distance = 1.2 + (waveX + waveY + waveZ) * 0.08 + audioDistort;
            
            v.multiplyScalar(distance);
            pos.setXYZ(i, v.x, v.y, v.z);
        }
        
        mainGeo.computeVertexNormals();
        pos.needsUpdate = true;

        // 5. Render
        renderer.render(scene, camera);
    }
    animate();

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function connectAudioToLiquid(stream) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    src.connect(analyser);
    dataArray = new Uint8Array(analyser.frequencyBinCount);
}
