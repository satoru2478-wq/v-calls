const socket = new WebSocket("wss://YOUR_RENDER_URL");

const room =
  location.hash.replace("#", "") ||
  crypto.randomUUID();

location.hash = room;

let pc;
let localStream;

document.getElementById("start").onclick = async () => {
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  localStream.getTracks().forEach(track =>
    pc.addTrack(track, localStream)
  );

  pc.ontrack = e => {
    const audio = document.createElement("audio");
    audio.srcObject = e.streams[0];
    audio.autoplay = true;
  };

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.send(JSON.stringify(e.candidate));
    }
  };

  socket.onmessage = async e => {
    const data = JSON.parse(e.data);

    if (data.type === "offer") {
      await pc.setRemoteDescription(data);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.send(JSON.stringify(answer));
    }

    if (data.type === "answer") {
      await pc.setRemoteDescription(data);
    }

    if (data.candidate) {
      await pc.addIceCandidate(data);
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.send(JSON.stringify(offer));
};
