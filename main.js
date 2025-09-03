const statusEl = document.getElementById("status");
const hudEl = document.getElementById("hud");
const phoneEl = document.getElementById("phone");
const startBtn = document.getElementById("start");

// CSS transform implementing R = Rz(yaw) * Rx(pitch) * Ry(roll)
// (Z-X-Y / yaw-pitch-roll) so that pitching the device (lifting from table to portrait)
// corresponds to rotation about the device X axis without being mis-attributed to roll.
// Note: CSS applies right-to-left.
function cssFromYPR(yawDeg, pitchDeg, rollDeg) {
  // Map world yaw (about Up) to rotateY so spinning upright uses vertical axis,
  // then apply pitch about X, and roll about Z (screen normal) last.
  return `rotateY(${-yawDeg}deg) rotateX(${pitchDeg}deg) rotateZ(${rollDeg}deg) rotateY(180deg)`; // final flip so front face matches screen
}

// Quaternion [x, y, z, w] -> row-major 3x3 (device -> world ENU)
function quatToMat3(qx, qy, qz, qw) {
  const xx = qx * qx, yy = qy * qy, zz = qz * qz;
  const xy = qx * qy, xz = qx * qz, yz = qy * qz;
  const wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz),     2 * (xz + wy),
    2 * (xy + wz),     1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy),     2 * (yz + wx),     1 - 2 * (xx + yy),
  ];
}

// Extract yaw/pitch/roll for R = Rz(yaw)*Rx(pitch)*Ry(roll) (Z-X-Y Tait-Bryan)
// This sequence makes a pure lift (device x-axis rotation) map cleanly to pitch.
function mat3ToYPR(R) {
  const r00 = R[0], r01 = R[1], r02 = R[2];
  const r10 = R[3], r11 = R[4], r12 = R[5];
  const r20 = R[6], r21 = R[7], r22 = R[8];

  // pitch = asin(r21) (clamp for safety)
  const sp = Math.max(-1, Math.min(1, r21));
  const pitch = Math.asin(sp);

  let yaw, roll;
  // Check for gimbal lock (|cos(pitch)| ~ 0)
  if (Math.abs(Math.cos(pitch)) > 1e-6) {
    roll = Math.atan2(-r20, r22); // from -cp*sr, cp*cr
    yaw = Math.atan2(r10, r00);   // standard
  } else {
    // Gimbal lock: set roll = 0, derive yaw from alternative elements
    roll = 0;
    yaw = Math.atan2(-r01, r11);
  }

  return [
    yaw * 180 / Math.PI,
    pitch * 180 / Math.PI,
    roll * 180 / Math.PI,
  ];
}

// Dynamic face labeling: for each phone face normal (device frame),
// compute which world direction (E,W,N,S,Up,Down) it points most toward.
const faces = {
  front:  [0, 0,  1],
  back:   [0, 0, -1],
  right:  [1, 0,  0],
  left:  [-1, 0,  0],
  top:    [0, 1,  0],
  bottom: [0,-1,  0],
};
const worldDirs = [
  { name: "East",  v: [ 1,  0,  0] },
  { name: "West",  v: [-1,  0,  0] },
  { name: "North", v: [ 0,  1,  0] },
  { name: "South", v: [ 0, -1,  0] },
  { name: "Up",    v: [ 0,  0,  1] },
  { name: "Down",  v: [ 0,  0, -1] },
];
function dot(a,b){ return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function mulMat3Vec3(R, v) {
  return [
    R[0]*v[0] + R[1]*v[1] + R[2]*v[2],
    R[3]*v[0] + R[4]*v[1] + R[5]*v[2],
    R[6]*v[0] + R[7]*v[1] + R[8]*v[2],
  ];
}
// Visualization note: we subtract 90° from pitch when rendering so that
// (Deprecated) Previous approach subtracted 90° from pitch. Now we instead
// apply a fixed post-rotation Rx(-90°) to the device->world matrix before
// Euler extraction so yaw stays about world Up when upright.
function mulMat3(A,B){
  return [
    A[0]*B[0]+A[1]*B[3]+A[2]*B[6], A[0]*B[1]+A[1]*B[4]+A[2]*B[7], A[0]*B[2]+A[1]*B[5]+A[2]*B[8],
    A[3]*B[0]+A[4]*B[3]+A[5]*B[6], A[3]*B[1]+A[4]*B[4]+A[5]*B[7], A[3]*B[2]+A[4]*B[5]+A[5]*B[8],
    A[6]*B[0]+A[7]*B[3]+A[8]*B[6], A[6]*B[1]+A[7]*B[4]+A[8]*B[7], A[6]*B[2]+A[7]*B[5]+A[8]*B[8],
  ];
}
// Rotate -90° about device X: Rx(-90) = [[1,0,0],[0,0,1],[0,-1,0]] (row-major)
const RX_NEG_90 = [
  1, 0, 0,
  0, 0, 1,
  0,-1, 0,
];
function relabelFaces(R) {
  for (const [cls, nDev] of Object.entries(faces)) {
    const nWorld = mulMat3Vec3(R, nDev); // device->world
    let best = worldDirs[0], bestDot = dot(nWorld, best.v);
    for (let i=1; i<worldDirs.length; i++) {
      const s = dot(nWorld, worldDirs[i].v);
      if (s > bestDot) { best = worldDirs[i]; bestDot = s; }
    }
    const el = document.querySelector(`.${cls}`);
    el.textContent = `${cls[0].toUpperCase()+cls.slice(1)} → ${best.name}`;
  }
}

async function start() {
  // Try to lock to portrait so device axes are consistent
  if (screen.orientation && screen.orientation.lock) {
    try { await screen.orientation.lock("portrait-primary"); } catch {}
  }

  statusEl.textContent = "Starting…";
  const freq = 60;
  try {
    const sensor = new AbsoluteOrientationSensor({ frequency: freq });
    sensor.addEventListener("reading", () => {
      const q = sensor.quaternion; // [x,y,z,w]
      if (!q) return;
  const R = quatToMat3(q[0], q[1], q[2], q[3]); // device -> world (ENU)
  const C = mulMat3(R, RX_NEG_90); // adjusted for visualization
  const [yawDeg, pitchDeg, rollDeg] = mat3ToYPR(C);

      // Apply rotation to phone box (portrait upright initially)
  phoneEl.style.transform = cssFromYPR(yawDeg, pitchDeg, rollDeg);

      // Update face labels with current world directions
  relabelFaces(R); // labels reflect true orientation

      hudEl.textContent = `yaw=${yawDeg.toFixed(1)}  pitch=${pitchDeg.toFixed(1)}  roll=${rollDeg.toFixed(1)} (deg)`;
      statusEl.textContent = "Live (Absolute)";
    });
    sensor.addEventListener("error", (e) => {
      statusEl.textContent = "AbsoluteOrientation error";
      console.error(e.error || e);
    });
    await sensor.start();
  } catch (absErr) {
    // Fallback to RelativeOrientationSensor (no absolute yaw; still useful for viz)
    try {
      const sensor = new RelativeOrientationSensor({ frequency: freq });
      sensor.addEventListener("reading", () => {
        const q = sensor.quaternion;
        if (!q) return;
  const R = quatToMat3(q[0], q[1], q[2], q[3]);
  const C = mulMat3(R, RX_NEG_90);
  const [yawDeg, pitchDeg, rollDeg] = mat3ToYPR(C);
  phoneEl.style.transform = cssFromYPR(yawDeg, pitchDeg, rollDeg);
  relabelFaces(R);
        hudEl.textContent = `rel yaw=${yawDeg.toFixed(1)} pitch=${pitchDeg.toFixed(1)} roll=${rollDeg.toFixed(1)} (deg)`;
        statusEl.textContent = "Live (Relative)";
      });
      await sensor.start();
    } catch (relErr) {
      statusEl.textContent = "Orientation sensors unavailable";
      console.error(absErr, relErr);
      alert("Orientation sensors unavailable on this device/browser.");
    }
  }
}

startBtn.onclick = () => start();