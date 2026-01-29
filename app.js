const intro = document.getElementById("intro");
const connect = document.getElementById("connect");
const callPage = document.getElementById("call");
const controls = document.getElementById("controls");

// 1. Splash Screen
setTimeout(() => {
    intro.classList.remove("active");
    connect.classList.add("active");
}, 2000);

// 2. Setup WebSocket & Room
const socket = new WebSocket("wss://v-calls.onrender.com");
const room = location.hash.replace("#", "") || crypto.randomUUID();
location.hash = room;

let pc;
let localStream;
let micOn = true;
let isStarted = false;

// 3. WebRTC Configuration
const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

// 4. Start Button Logic
document.getElementById("start").onclick = async () => {
    if (isStarted) return;
    isStarted = true;

    // UI Updates
    connect.classList.remove("active");
    callPage.classList.add("active");

    // Initialize Audio & Visuals (Must be after user interaction)
    await initAudioAndVisuals();

    // Setup Peer Connection
    pc = new RTCPeerConnection(rtcConfig);

    // Add Local Tracks to PC
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    // Handle Remote Stream
    pc.ontrack = e => {
        const audio = document.createElement("audio");
        audio.srcObject = e.streams[0];
        audio.autoplay = true;
        document.body.appendChild(audio);
    };

    // Handle ICE Candidates
    pc.onicecandidate = e => {
        if (e.candidate) {
            sendSignal({ type: "candidate", candidate: e.candidate });
        }
    };

    // Announce presence
    sendSignal({ type: "join" });
};

// 5. Signaling Handler
socket.onmessage = async (e) => {
    const data = JSON.parse(e.data);
    
    // Filter: Ignore messages from other rooms or yourself
    if (data.room !== room) return;

    if (!pc) return; // Ignore if we haven't clicked start yet

    try {
        if (data.type === "join") {
            // Someone joined, I will create the offer
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendSignal({ type: "offer", sdp: offer });
        }
        else if (data.type === "offer") {
            await pc.setRemoteDescription(data.sdp);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSignal({ type: "answer", sdp: answer });
        }
        else if (data.type === "answer") {
            await pc.setRemoteDescription(data.sdp);
        }
        else if (data.type === "candidate") {
            await pc.addIceCandidate(data.candidate);
        }
    } catch (err) {
        console.error(err);
    }
};

function sendSignal(data) {
    data.room = room; // Tag every message with room ID
    socket.send(JSON.stringify(data));
}

// 6. UI Controls
document.body.addEventListener("click", () => {
    controls.classList.add("show");
    clearTimeout(window.hideUI);
    window.hideUI = setTimeout(() => controls.classList.remove("show"), 4000);
});

document.getElementById("mute").onclick = () => {
    micOn = !micOn;
    localStream.getAudioTracks()[0].enabled = micOn;
    document.getElementById("mute").innerText = micOn ? "🎙️" : "🔇";
};

document.getElementById("end").onclick = () => location.reload();

// 7. Visualizer Logic (Wrapped to init on click)
async function initAudioAndVisuals() {
    // Get Mic
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Three.js Setup
    const canvas = document.getElementById("bg");
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true });
    
    renderer.setSize(innerWidth, innerHeight);
    camera.position.z = 5;

    // Visualizer Data Source
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(localStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    // Objects
    const group = new THREE.Group();
    const geo = new THREE.SphereGeometry(0.06, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: 0x6366f1 });

    for (let i = 0; i < 400; i++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(
            (Math.random() - 0.5) * 8,
            (Math.random() - 0.5) * 8,
            (Math.random() - 0.5) * 8
        );
        group.add(mesh);
    }
    scene.add(group);

    // Animation Loop
    function animate() {
        requestAnimationFrame(animate);
        analyser.getByteFrequencyData(dataArray);
        
        // Use average frequency for scale
        const avg = dataArray[0] / 255;
        group.scale.setScalar(1 + avg * 0.5);
        group.rotation.y += 0.002;
        
        renderer.render(scene, camera);
    }
    animate();

    // Resize Handler
    window.addEventListener("resize", () => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
    });

    // Mobile Gyro
    window.addEventListener("deviceorientation", e => {
        if(e.gamma) scene.rotation.y = e.gamma * 0.002;
        if(e.beta) scene.rotation.x = e.beta * 0.002;
    });
}
