const statusEl = document.getElementById("status");
const hudEl = document.getElementById("hud");
// 3D North arrow elements
const anchorEl = document.getElementById("anchor");
const northArrowEl = document.getElementById("northArrow");
const northArrowShadowEl = document.getElementById("northArrowShadow");
const startBtn = document.getElementById("start");

// Only need yaw heading -> North. Arrow graphic points upward (0deg = North)

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

// Compute device->world matrix (already) then build world-North vector in device frame: n_dev = R^T * (0,1,0) = (r10,r11,r12)
// Align base +Y (0,1,0) to n_dev via axis-angle.
function northVectorDevice(R){ return [ R[3], R[4], R[5] ]; }
function normalize(v){ const m=Math.hypot(v[0],v[1],v[2]); return m? [v[0]/m,v[1]/m,v[2]/m]:[0,1,0]; }
function rotationFromYTo(v){
  const b = normalize(v);
  const dot = b[1]; // (0,1,0)·b = b_y
  if (dot > 0.9995) return {axis:[0,1,0], angleDeg:0};
  if (dot < -0.9995) return {axis:[1,0,0], angleDeg:180};
  // axis = a x b where a=(0,1,0)
  const axis = [ b[2], 0, -b[0] ];
  const axisLen = Math.hypot(axis[0],axis[1],axis[2]);
  const ax = axis[0]/axisLen, ay=0, az=axis[2]/axisLen;
  const angleRad = Math.atan2(Math.hypot(axis[0],axis[2]), dot);
  return {axis:[ax,ay,az], angleDeg: angleRad * 180/Math.PI };
}
// (Removed inversion) Arrow points toward true North in world frame.
function cssRotateAxisAngle(axis, angleDeg){ return `rotate3d(${axis[0]},${axis[1]},${axis[2]},${angleDeg}deg)`; }

// No face relabeling needed now.

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
  const R = quatToMat3(q[0], q[1], q[2], q[3]);
      const nDev = northVectorDevice(R);
  const rot = rotationFromYTo(nDev); // toward North
  const t = cssRotateAxisAngle(rot.axis, rot.angleDeg);
    northArrowEl.style.transform = t + ' translateZ(10px)';
    northArrowShadowEl.style.transform = t + ' translateZ(0px)';
      hudEl.textContent = `northDev=(${nDev.map(v=>v.toFixed(2)).join(',')})`;
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
  const nDev = northVectorDevice(R);
  const rot = rotationFromYTo(nDev);
  const t = cssRotateAxisAngle(rot.axis, rot.angleDeg);
    northArrowEl.style.transform = t + ' translateZ(10px)';
    northArrowShadowEl.style.transform = t + ' translateZ(0px)';
  hudEl.textContent = `rel northDev=(${nDev.map(v=>v.toFixed(2)).join(',')})`;
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